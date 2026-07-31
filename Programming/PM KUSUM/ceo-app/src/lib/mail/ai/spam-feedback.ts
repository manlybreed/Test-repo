import { prisma } from "@/lib/prisma";

/**
 * AI-22 self-learning: accumulates Report-spam/Not-spam feedback per
 * sender-or-domain so triageThread's classification gets more confident
 * over time instead of re-litigating a conclusively-decided sender from
 * scratch on every pass — mirrors how MailLabelRule already lets a smart
 * -label correction stick for future mail (applySmartLabelCorrections in
 * triage.ts), just specialized to spam's binary case with a count-based
 * confidence dial instead of a substring-match rule.
 */

export type SpamFeedbackEvent =
  | { action: "spam"; source: "manual" | "auto" }
  | { action: "not_spam"; source: "manual" };

export type SpamFeedbackCounts = {
  addressManualSpamCount: number;
  addressAutoSpamCount: number;
  addressNotSpamCount: number;
  domainManualSpamCount: number;
  domainAutoSpamCount: number;
  domainNotSpamCount: number;
};

export const EMPTY_SPAM_FEEDBACK: SpamFeedbackCounts = {
  addressManualSpamCount: 0,
  addressAutoSpamCount: 0,
  addressNotSpamCount: 0,
  domainManualSpamCount: 0,
  domainAutoSpamCount: 0,
  domainNotSpamCount: 0,
};

export function hasSpamFeedbackSignal(c: SpamFeedbackCounts): boolean {
  return (
    c.addressManualSpamCount > 0 ||
    c.addressAutoSpamCount > 0 ||
    c.addressNotSpamCount > 0 ||
    c.domainManualSpamCount > 0 ||
    c.domainAutoSpamCount > 0 ||
    c.domainNotSpamCount > 0
  );
}

/**
 * Common free-mail providers — a single reported address on one of these
 * domains must never poison every other sender on that same domain, so
 * domain-scope feedback is never written or read for them.
 */
export const SHARED_DOMAIN_DENYLIST = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "yandex.com",
  "mail.com",
  "rediffmail.com",
  "zoho.com",
]);

export function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/** The most recent external (non-self) sender address among a thread's
 * messages — the identity feedback is recorded/looked up against. */
export function primaryExternalSender(
  fromAddresses: string[],
  myAddress: string,
): string | null {
  const mine = myAddress.toLowerCase();
  const external = fromAddresses.find((a) => a.toLowerCase() !== mine);
  return external ? external.toLowerCase() : null;
}

export const SPAM_FASTPATH_THRESHOLD = 2;

export type SpamFeedbackTier = "never_spam" | "hard_spam" | "none";

/**
 * Pure, DB-free — directly unit-testable. `never_spam` always wins,
 * comparing not-spam counts only against *manual* spam counts (auto
 * -apply's own past guesses never get to out-vote a human correction).
 * `hard_spam` only ever comes from address-scope counts — domain
 * aggregation may only ever push the *safe* direction (never_spam), never
 * force a spam verdict on its own, since a shared/rotated domain seeing
 * one bad actor shouldn't condemn every other sender on it.
 */
export function resolveSpamFeedbackTier(
  c: SpamFeedbackCounts,
): SpamFeedbackTier {
  const notSpamTotal = c.addressNotSpamCount + c.domainNotSpamCount;
  const manualSpamTotal = c.addressManualSpamCount + c.domainManualSpamCount;
  if (notSpamTotal > 0 && notSpamTotal >= manualSpamTotal) return "never_spam";

  if (
    c.addressNotSpamCount === 0 &&
    c.addressManualSpamCount + c.addressAutoSpamCount >= SPAM_FASTPATH_THRESHOLD
  ) {
    return "hard_spam";
  }

  return "none";
}

async function findFeedbackRow(accountId: string, key: string, scope: "address" | "domain") {
  return prisma.mailSenderFeedback.findUnique({
    where: { accountId_key_scope: { accountId, key, scope } },
  });
}

export async function getSpamFeedback(opts: {
  accountId: string;
  fromAddress: string;
}): Promise<SpamFeedbackCounts> {
  const address = opts.fromAddress.toLowerCase();
  const domain = domainOf(address);
  const domainScoped = domain && !SHARED_DOMAIN_DENYLIST.has(domain);

  const [addressRow, domainRow] = await Promise.all([
    findFeedbackRow(opts.accountId, address, "address"),
    domainScoped ? findFeedbackRow(opts.accountId, domain, "domain") : Promise.resolve(null),
  ]);

  return {
    addressManualSpamCount: addressRow?.manualSpamCount ?? 0,
    addressAutoSpamCount: addressRow?.autoSpamCount ?? 0,
    addressNotSpamCount: addressRow?.notSpamCount ?? 0,
    domainManualSpamCount: domainRow?.manualSpamCount ?? 0,
    domainAutoSpamCount: domainRow?.autoSpamCount ?? 0,
    domainNotSpamCount: domainRow?.notSpamCount ?? 0,
  };
}

function countDeltaFor(event: SpamFeedbackEvent) {
  if (event.action === "not_spam") {
    return { manualSpamCount: 0, autoSpamCount: 0, notSpamCount: 1 };
  }
  return event.source === "manual"
    ? { manualSpamCount: 1, autoSpamCount: 0, notSpamCount: 0 }
    : { manualSpamCount: 0, autoSpamCount: 1, notSpamCount: 0 };
}

async function upsertFeedbackRow(
  accountId: string,
  key: string,
  scope: "address" | "domain",
  event: SpamFeedbackEvent,
) {
  const delta = countDeltaFor(event);
  await prisma.mailSenderFeedback.upsert({
    where: { accountId_key_scope: { accountId, key, scope } },
    create: {
      accountId,
      key,
      scope,
      ...delta,
      lastAction: event.action,
      lastSource: event.source,
    },
    update: {
      manualSpamCount: { increment: delta.manualSpamCount },
      autoSpamCount: { increment: delta.autoSpamCount },
      notSpamCount: { increment: delta.notSpamCount },
      lastAction: event.action,
      lastSource: event.source,
    },
  });
}

export async function recordSpamFeedback(opts: {
  accountId: string;
  address: string;
  event: SpamFeedbackEvent;
}): Promise<void> {
  const address = opts.address.toLowerCase();
  const domain = domainOf(address);
  await upsertFeedbackRow(opts.accountId, address, "address", opts.event);
  if (domain && !SHARED_DOMAIN_DENYLIST.has(domain)) {
    await upsertFeedbackRow(opts.accountId, domain, "domain", opts.event);
  }
}

/** Resolves each thread's most recent inbound (non-self) sender and
 * records one feedback event per thread — used by the manual Report
 * -spam/Not-spam server actions, single or bulk. */
export async function recordSpamFeedbackForThreads(opts: {
  accountId: string;
  threadIds: string[];
  event: SpamFeedbackEvent;
}): Promise<void> {
  if (!opts.threadIds.length) return;
  const account = await prisma.mailAccount.findUnique({
    where: { id: opts.accountId },
    select: { address: true },
  });
  if (!account) return;

  for (const threadId of opts.threadIds) {
    const messages = await prisma.mailMessage.findMany({
      where: { threadId, accountId: opts.accountId },
      orderBy: { date: "desc" },
      select: { fromAddress: true },
    });
    const sender = primaryExternalSender(
      messages.map((m) => m.fromAddress),
      account.address,
    );
    if (!sender) continue;
    await recordSpamFeedback({
      accountId: opts.accountId,
      address: sender,
      event: opts.event,
    }).catch(() => undefined);
  }
}
