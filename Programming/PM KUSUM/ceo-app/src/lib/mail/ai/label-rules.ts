import { prisma } from "@/lib/prisma";
import { mergeSmartLabels, parseLabelsJson } from "@/lib/mail/ai/smart-labels";

export type LabelRuleMatch = { fromContains?: string; subjectContains?: string };

function parseRuleMatch(rule: { matchJson: string }): LabelRuleMatch {
  try {
    return JSON.parse(rule.matchJson) as LabelRuleMatch;
  } catch {
    return {};
  }
}

/**
 * Single source of truth for "does this rule match this from/subject
 * context" — used at ingest (below), for the triage-time correction
 * override, and mirrored (via parseRuleMatch, not this function directly —
 * see findMatchingExistingThreads) by the retroactive-apply DB query.
 */
export function matchesLabelRule(
  rule: { matchJson: string },
  ctx: { from: string; subject: string },
): boolean {
  const match = parseRuleMatch(rule);
  const fromOk =
    !match.fromContains ||
    ctx.from.toLowerCase().includes(match.fromContains.toLowerCase());
  const subOk =
    !match.subjectContains ||
    ctx.subject.toLowerCase().includes(match.subjectContains.toLowerCase());
  return fromOk && subOk;
}

/** AI-20: apply standing MailLabelRule rows on ingest. */
export async function applyStandingLabelRules(
  accountId: string,
  threadId: string,
  ctx: { from: string; subject: string },
) {
  const rules = await prisma.mailLabelRule.findMany({
    where: { accountId, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!rules.length) return;

  const thread = await prisma.mailThread.findUnique({ where: { id: threadId } });
  if (!thread) return;

  const labels = new Set(
    JSON.parse(thread.labelsJson || "[]") as string[],
  );

  for (const rule of rules) {
    if (matchesLabelRule(rule, ctx)) labels.add(rule.label);
  }

  await prisma.mailThread.update({
    where: { id: threadId },
    data: { labelsJson: JSON.stringify([...labels]) },
  });
}

const RETROACTIVE_CAP = 200;

export type MatchingThreadPreview = {
  id: string;
  subject: string;
  fromAddress: string | null;
  fromName: string | null;
};

/**
 * Existing threads matching a rule's criteria — used for both the live
 * preview shown before a user commits to a correction, and the retroactive
 * apply itself. This runs as a DB query rather than loading every thread's
 * messages and calling matchesLabelRule row-by-row, so it can't reuse that
 * function directly at scale — but it goes through the same parseRuleMatch,
 * so the two can never disagree about what a rule's fields *mean*, only
 * about how the check runs (in-memory boolean vs. SQL contains).
 */
export async function findMatchingExistingThreads(
  accountId: string,
  rule: { matchJson: string },
  opts?: { excludeThreadId?: string; limit?: number },
): Promise<MatchingThreadPreview[]> {
  const match = parseRuleMatch(rule);
  const limit = Math.min(Math.max(opts?.limit ?? RETROACTIVE_CAP, 1), RETROACTIVE_CAP);

  const and: Record<string, unknown>[] = [];
  if (match.fromContains) {
    and.push({
      messages: {
        some: { fromAddress: { contains: match.fromContains, mode: "insensitive" } },
      },
    });
  }
  if (match.subjectContains) {
    and.push({ subject: { contains: match.subjectContains, mode: "insensitive" } });
  }

  const threads = await prisma.mailThread.findMany({
    where: {
      accountId,
      ...(opts?.excludeThreadId ? { id: { not: opts.excludeThreadId } } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      messages: {
        orderBy: { date: "desc" },
        take: 1,
        select: { fromAddress: true, fromName: true },
      },
    },
  });

  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    fromAddress: t.messages[0]?.fromAddress ?? null,
    fromName: t.messages[0]?.fromName ?? null,
  }));
}

export type SmartLabelSnapshotItem = { threadId: string; previousLabelsJson: string };

/**
 * Retroactively apply a smart-label correction to existing matching
 * threads: replace their smart labels (mergeSmartLabels leaves any custom
 * labels on the same thread untouched) and bust each thread's TRIAGE cache
 * so a later re-triage doesn't fight the correction with stale cached
 * output. Custom-label retroactive application is a physical IMAP folder
 * move instead — handled by the caller via moveMailThreadsToFolder, since
 * that's IMAP-specific, not a labelsJson concern. This function only
 * covers the smart-label branch.
 */
export async function applyLabelRuleRetroactively(
  accountId: string,
  rule: { matchJson: string },
  opts: { label: string; excludeThreadId?: string; limit?: number },
): Promise<{ snapshot: SmartLabelSnapshotItem[] }> {
  const candidates = await findMatchingExistingThreads(accountId, rule, opts);
  const snapshot: SmartLabelSnapshotItem[] = [];

  for (const c of candidates) {
    const thread = await prisma.mailThread.findUnique({
      where: { id: c.id },
      select: { labelsJson: true },
    });
    if (!thread) continue;
    const existing = parseLabelsJson(thread.labelsJson);
    const nextJson = JSON.stringify(mergeSmartLabels(existing, [opts.label]));
    // Idempotent: a candidate that already carries the label is left alone
    // and doesn't appear in the undo snapshot.
    if (nextJson === thread.labelsJson) continue;
    snapshot.push({ threadId: c.id, previousLabelsJson: thread.labelsJson });
    await prisma.mailThread.update({
      where: { id: c.id },
      data: { labelsJson: nextJson },
    });
    await prisma.mailAiCache
      .deleteMany({ where: { threadId: c.id, kind: "TRIAGE" } })
      .catch(() => undefined);
  }

  return { snapshot };
}

/** Revert a previous applyLabelRuleRetroactively call using its snapshot. */
export async function undoSmartLabelRetroactive(
  snapshot: SmartLabelSnapshotItem[],
): Promise<{ restored: number }> {
  let restored = 0;
  for (const s of snapshot) {
    try {
      await prisma.mailThread.update({
        where: { id: s.threadId },
        data: { labelsJson: s.previousLabelsJson },
      });
      restored += 1;
    } catch {
      // Best-effort: the thread may have been independently modified or
      // deleted since — don't fail the whole undo batch over one item.
    }
  }
  return { restored };
}
