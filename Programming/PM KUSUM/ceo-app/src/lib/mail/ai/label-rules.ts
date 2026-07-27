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
  /** Only populated by findBroadCandidateThreads, for classification context. */
  snippet?: string | null;
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

const BROAD_CANDIDATE_CAP = 60;

/**
 * A deliberately loose, OR-based first pass — either criterion matching is
 * enough to become a candidate, not both — used only to build the pool that
 * classifySimilarThreads then judges for genuine similarity (label-
 * correction.ts). This exists because the strict AND in
 * findMatchingExistingThreads silently under-matches real similar mail: two
 * emails using the same sender and the same underlying template/purpose
 * routinely have almost no literal subject-line overlap once you factor in
 * a different company/client/project name in the subject (e.g. "Bhaureji
 * Surajmal Green Energy... Bharatpur-Part 3" vs "Kumha Solar... Bharatpur-
 * Part 1" — same sender, same PM KUSUM financing template, near-zero shared
 * subject substring). Casting a wider net here and pruning false positives
 * with an LLM judgment call afterward finds those matches without turning
 * "or" into "everything from this sender, regardless of topic."
 *
 * Capped smaller than the 200 final-results cap (RETROACTIVE_CAP) — every
 * candidate here gets its subject+snippet sent to Claude in one batched
 * classification call, so this cap is about keeping that prompt a
 * reasonable size, not about final result count.
 */
export async function findBroadCandidateThreads(
  accountId: string,
  criteria: { fromContains: string | null; subjectContains: string | null },
  opts?: { excludeThreadId?: string; limit?: number },
): Promise<MatchingThreadPreview[]> {
  const limit = Math.min(
    Math.max(opts?.limit ?? BROAD_CANDIDATE_CAP, 1),
    BROAD_CANDIDATE_CAP,
  );

  const or: Record<string, unknown>[] = [];
  if (criteria.fromContains) {
    or.push({
      messages: {
        some: { fromAddress: { contains: criteria.fromContains, mode: "insensitive" } },
      },
    });
  }
  if (criteria.subjectContains) {
    or.push({ subject: { contains: criteria.subjectContains, mode: "insensitive" } });
  }
  if (!or.length) return [];

  const threads = await prisma.mailThread.findMany({
    where: {
      accountId,
      ...(opts?.excludeThreadId ? { id: { not: opts.excludeThreadId } } : {}),
      OR: or,
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      snippet: true,
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
    snippet: t.snippet,
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
 *
 * Pass `threadIds` when the caller already knows exactly which threads to
 * touch (e.g. a user-reviewed, checkbox-selected subset of the live
 * match list) — this skips re-querying `findMatchingExistingThreads` so
 * "what was shown and selected" is exactly "what happens," not a fresh
 * re-match that could have drifted since the suggestion was shown.
 */
export async function applyLabelRuleRetroactively(
  accountId: string,
  rule: { matchJson: string },
  opts: { label: string; excludeThreadId?: string; limit?: number; threadIds?: string[] },
): Promise<{ snapshot: SmartLabelSnapshotItem[] }> {
  const candidateIds =
    opts.threadIds ??
    (await findMatchingExistingThreads(accountId, rule, opts)).map((c) => c.id);
  const snapshot: SmartLabelSnapshotItem[] = [];

  for (const id of candidateIds) {
    const thread = await prisma.mailThread.findFirst({
      where: { id, accountId },
      select: { labelsJson: true },
    });
    if (!thread) continue;
    const existing = parseLabelsJson(thread.labelsJson);
    const nextJson = JSON.stringify(mergeSmartLabels(existing, [opts.label]));
    // Idempotent: a candidate that already carries the label is left alone
    // and doesn't appear in the undo snapshot.
    if (nextJson === thread.labelsJson) continue;
    snapshot.push({ threadId: id, previousLabelsJson: thread.labelsJson });
    await prisma.mailThread.update({
      where: { id },
      data: { labelsJson: nextJson },
    });
    await prisma.mailAiCache
      .deleteMany({ where: { threadId: id, kind: "TRIAGE" } })
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
