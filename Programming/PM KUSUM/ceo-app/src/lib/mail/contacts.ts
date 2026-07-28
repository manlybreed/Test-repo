import { prisma } from "@/lib/prisma";
import { claudeJson, getAnthropic } from "@/lib/mail/ai/claude";

/**
 * Phase R2 — people/contact index.
 *
 * A per-account aggregate of who is in the mailbox (address, display-name
 * variants, how often they write, last seen, a few recent subjects). Lets
 * "who sent…" / recall resolve a name to an address without scanning every
 * message, and gives `recallPerson` a warm row to answer from.
 */

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function normAddress(address: string | null | undefined): string | null {
  const a = (address || "").trim().toLowerCase();
  return a && a.includes("@") ? a : null;
}

/**
 * Some senders' mail clients set their own From-header display name to
 * their own address ("himanshu@thebluridge.com" <himanshu@thebluridge.com>)
 * — real data, but it carries no identity beyond the address, so it
 * shouldn't count as a "known name" anywhere a real name is expected (e.g.
 * an AI draft's greeting). Exported so callers resolving "who is this" can
 * apply the same guard instead of trusting displayName blindly.
 */
export function isRealName(
  name: string | null | undefined,
  address: string,
): boolean {
  const n = name?.trim().toLowerCase();
  return Boolean(n) && n !== address.trim().toLowerCase();
}

// Local-parts that identify a role/mailbox, not a person — a match here
// means "no name", not a fabricated one (e.g. accounts@thebluridge.com is
// one of this account's own configured mailboxes, not a person named
// "Accounts").
const ROLE_LOCAL_PARTS = new Set([
  "info", "noreply", "no-reply", "donotreply", "do-not-reply", "support",
  "admin", "administrator", "accounts", "account", "sales", "contact",
  "billing", "hello", "hi", "team", "help", "office", "mail", "postmaster",
  "webmaster", "hostmaster", "marketing", "newsletter", "notifications",
  "notification", "alert", "alerts", "bot", "system", "security", "hr",
  "careers", "jobs", "press", "media", "feedback", "service", "services",
  "enquiry", "enquiries", "inquiry", "inquiries", "general", "reply",
  "mailer", "daemon", "root", "test", "subscriptions", "subscribe",
  "unsubscribe", "orders", "order", "shipping", "returns", "legal",
  "privacy", "abuse", "postbox", "inbox", "list", "lists", "digest",
]);

/**
 * Deterministic fallback for "what's this person's name" when no display
 * name was ever observed in a header: derive a plausible one straight from
 * the local-part of the address (himanshu@… -> "Himanshu", john.doe@… ->
 * "John Doe"). Returns null rather than guessing when the local-part looks
 * like a role/shared mailbox or has no letters at all — a missing name
 * fallback beats a confidently-wrong one. Pure and exported for testing.
 */
export function nameFromLocalPart(address: string): string | null {
  const at = address.indexOf("@");
  const local = (at >= 0 ? address.slice(0, at) : address).trim().toLowerCase();
  if (!local || ROLE_LOCAL_PARTS.has(local)) return null;

  const tokens = local
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 2 && !ROLE_LOCAL_PARTS.has(t));
  if (!tokens.length) return null;

  return tokens
    .slice(0, 3)
    .map((t) => t[0]!.toUpperCase() + t.slice(1))
    .join(" ");
}

export type ContactRow = {
  address: string;
  displayName: string | null;
  names: string[];
  messageCount: number;
  lastMessageAt: Date | null;
  sampleSubjects: string[];
};

/** Split a free-text person reference into lookup needles. Pure. */
export function personNeedles(query: string): string[] {
  const q = query.trim().toLowerCase();
  const tokens = q
    .split(/[^a-z0-9@.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return tokens.length ? tokens : q.length >= 2 ? [q] : [];
}

type RankableContact = {
  address: string;
  displayName: string | null;
  namesJson: string;
  messageCount: number;
  lastMessageAt: Date | null;
};

/**
 * Pure ranking of contact rows against needles: more token hits first, then
 * frequency, then recency. Drops rows with no hit. Exported for testing.
 */
export function rankContacts<T extends RankableContact>(
  rows: T[],
  needles: string[],
  limit: number,
): T[] {
  return rows
    .map((r) => {
      const hay = `${r.displayName || ""} ${r.address} ${r.namesJson}`.toLowerCase();
      const hits = needles.filter((t) => hay.includes(t)).length;
      return { r, hits };
    })
    .filter((x) => x.hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.r.messageCount - a.r.messageCount ||
        (b.r.lastMessageAt?.getTime() || 0) - (a.r.lastMessageAt?.getTime() || 0),
    )
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * Fold a freshly-imported message into the contact index. Upserts the sender
 * (primary "who sent" signal, bumps messageCount) and records recipients so
 * "who did I email about X" resolves too — recipients don't bump the count.
 */
export async function upsertContactsFromMessage(input: {
  accountId: string;
  fromAddress: string;
  fromName?: string | null;
  toAddresses?: { address?: string | null; name?: string | null }[];
  subject?: string | null;
  date: Date;
}): Promise<void> {
  const from = normAddress(input.fromAddress);
  const subject = (input.subject || "").trim();

  if (from) {
    await bumpContact({
      accountId: input.accountId,
      address: from,
      name: input.fromName,
      subject,
      date: input.date,
      sender: true,
    });
  }

  for (const to of input.toAddresses || []) {
    const addr = normAddress(to.address);
    if (!addr || addr === from) continue;
    await bumpContact({
      accountId: input.accountId,
      address: addr,
      name: to.name,
      subject: "",
      date: input.date,
      sender: false,
    });
  }
}

async function bumpContact(input: {
  accountId: string;
  address: string;
  name?: string | null;
  subject: string;
  date: Date;
  sender: boolean;
}): Promise<void> {
  const existing = await prisma.mailContact.findUnique({
    where: {
      accountId_address: { accountId: input.accountId, address: input.address },
    },
  });

  const name = (input.name || "").trim() || null;

  if (!existing) {
    await prisma.mailContact.create({
      data: {
        accountId: input.accountId,
        address: input.address,
        displayName: name,
        namesJson: JSON.stringify(name ? [name] : []),
        messageCount: input.sender ? 1 : 0,
        lastMessageAt: input.date,
        sampleSubjectsJson: JSON.stringify(
          input.subject ? [input.subject].slice(0, 5) : [],
        ),
      },
    });
    return;
  }

  const names = parseJsonArray(existing.namesJson);
  if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
    names.unshift(name);
  }
  const subjects = parseJsonArray(existing.sampleSubjectsJson);
  if (input.subject && !subjects.includes(input.subject)) {
    subjects.unshift(input.subject);
  }
  const newer =
    !existing.lastMessageAt || input.date > existing.lastMessageAt;

  await prisma.mailContact.update({
    where: { id: existing.id },
    data: {
      messageCount: existing.messageCount + (input.sender ? 1 : 0),
      // Prefer the most recent display name we've seen.
      displayName: newer && name ? name : existing.displayName || name,
      namesJson: JSON.stringify(names.slice(0, 8)),
      lastMessageAt: newer ? input.date : existing.lastMessageAt,
      sampleSubjectsJson: JSON.stringify(subjects.slice(0, 5)),
    },
  });
}

/**
 * One-time (idempotent) backfill from existing messages — group by sender,
 * seed count / last-seen / most-recent display name. Live upserts enrich
 * names + subjects going forward. Safe to re-run.
 */
export async function backfillContacts(accountId: string): Promise<number> {
  const rows = await prisma.$executeRawUnsafe(
    `
    INSERT INTO "MailContact"
      (id, "accountId", address, "displayName", "namesJson",
       "messageCount", "lastMessageAt", "sampleSubjectsJson", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      m."accountId",
      lower(m."fromAddress"),
      (array_agg(m."fromName" ORDER BY m.date DESC)
         FILTER (WHERE m."fromName" IS NOT NULL AND m."fromName" <> ''))[1],
      '[]',
      count(*)::int,
      max(m.date),
      '[]',
      now(), now()
    FROM "MailMessage" m
    WHERE m."accountId" = $1
      AND m."fromAddress" <> ''
      AND position('@' in m."fromAddress") > 0
    GROUP BY m."accountId", lower(m."fromAddress")
    ON CONFLICT ("accountId", address) DO UPDATE SET
      "messageCount"  = EXCLUDED."messageCount",
      "lastMessageAt" = EXCLUDED."lastMessageAt",
      "displayName"   = COALESCE("MailContact"."displayName", EXCLUDED."displayName");
    `,
    accountId,
  );
  return typeof rows === "number" ? rows : 0;
}

/**
 * Fuzzy person lookup: match query name tokens / email fragments against the
 * contact index. Returns best correspondents first (recent + frequent).
 * Lazily backfills the index the first time it's empty for the account.
 */
export async function findContacts(
  accountId: string,
  query: string,
  limit = 5,
): Promise<ContactRow[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const count = await prisma.mailContact.count({ where: { accountId } });
  if (count === 0) {
    await backfillContacts(accountId).catch(() => 0);
  }

  const needles = personNeedles(q);
  if (!needles.length) return [];

  const rows = await prisma.mailContact.findMany({
    where: {
      accountId,
      OR: needles.flatMap((t) => [
        { address: { contains: t, mode: "insensitive" as const } },
        { displayName: { contains: t, mode: "insensitive" as const } },
        { namesJson: { contains: t, mode: "insensitive" as const } },
      ]),
    },
    orderBy: [{ messageCount: "desc" }, { lastMessageAt: "desc" }],
    take: Math.max(limit * 3, 15),
  });

  return rankContacts(rows, needles, limit).map((r) => ({
    address: r.address,
    // A stored displayName that's just the address restated (see
    // isRealName) carries no identity — fall back to a name guessed from
    // the local-part instead of handing every caller the bare address.
    displayName: isRealName(r.displayName, r.address)
      ? r.displayName
      : nameFromLocalPart(r.address),
    names: parseJsonArray(r.namesJson),
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt,
    sampleSubjects: parseJsonArray(r.sampleSubjectsJson),
  }));
}

/**
 * Last-resort name discovery for when a contact has neither a real header-
 * observed display name nor a confident emailid-derived guess (e.g. a role-
 * looking local-part): read an actual message involving this address —
 * their own sign-off if they've sent mail, otherwise how someone else
 * greeted them — and ask Claude to pull out a name, only if one is
 * genuinely stated in the text. Persists a hit onto MailContact so this
 * (comparatively expensive) lookup only ever runs once per address; a
 * future real header name still overwrites it via bumpContact's normal
 * upsert, same as any other display-name update.
 */
export async function discoverContactName(
  accountId: string,
  address: string,
): Promise<string | null> {
  const addr = normAddress(address);
  if (!addr) return null;

  const existing = await prisma.mailContact.findUnique({
    where: { accountId_address: { accountId, address: addr } },
  });
  if (isRealName(existing?.displayName, addr)) return existing!.displayName!;
  if (!getAnthropic()) return null;

  const sent = await prisma.mailMessage.findFirst({
    where: { accountId, fromAddress: addr, bodyText: { not: null } },
    orderBy: { date: "desc" },
    select: { bodyText: true },
  });
  const received = sent
    ? null
    : await prisma.mailMessage.findFirst({
        where: {
          accountId,
          toAddresses: { contains: addr, mode: "insensitive" },
          bodyText: { not: null },
        },
        orderBy: { date: "desc" },
        select: { bodyText: true },
      });

  const body = sent?.bodyText || received?.bodyText;
  if (!body) return null;

  // Sign-offs live at the tail, greetings at the head — grab both ends
  // rather than guessing which applies to this message.
  const snippet = `${body.slice(0, 400)}\n...\n${body.slice(-400)}`;

  const raw = await claudeJson<{ name: string | null }>({
    model: "haiku",
    system: `This is an excerpt (start and end) of a real email ${sent ? "sent by" : "sent to"} ${addr}. Return JSON {name}.
- If ${
      sent
        ? `the sender signs off with their own name (e.g. a closing line like "Regards, X")`
        : `the greeting names this specific recipient (e.g. "Dear X,")`
    }, return that name, stripped of honorifics (ji, sir, madam, Mr., Mrs., Dr., etc.).
- Never guess a name from the email address itself — only from text that actually names the person.
- Return null if no such name is clearly present.`,
    user: snippet,
    maxTokens: 60,
  });

  const name = raw?.name?.trim() || null;
  if (!name || !isRealName(name, addr)) return null;

  // Persist regardless of whether a row already existed — a brand-new
  // recipient (never before a sender or an upserted "to") has no
  // MailContact row yet at all, and skipping creation here would silently
  // re-run this same AI lookup on every future draft to them.
  if (existing) {
    await prisma.mailContact
      .update({ where: { id: existing.id }, data: { displayName: name } })
      .catch(() => undefined);
  } else {
    await prisma.mailContact
      .create({
        data: {
          accountId,
          address: addr,
          displayName: name,
          namesJson: JSON.stringify([name]),
          messageCount: sent ? 1 : 0,
        },
      })
      .catch(() => undefined);
  }

  return name;
}

/** Resolve a free-text person reference to the single best address, if any. */
export async function resolvePersonAddress(
  accountId: string,
  person: string,
): Promise<string | null> {
  if (person.includes("@")) return person.trim().toLowerCase();
  const [top] = await findContacts(accountId, person, 1);
  return top?.address ?? null;
}
