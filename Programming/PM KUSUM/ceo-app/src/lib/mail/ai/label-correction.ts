import { claudeJson, getAnthropic } from "@/lib/mail/ai/claude";

export type LabelMatchCriteria = {
  fromContains: string | null;
  subjectContains: string | null;
  ruleName: string;
};

/**
 * When a user corrects a label on one email, this decides what makes that
 * email generalizable to "other mail like this" — an exact sender address,
 * a whole domain, a subject keyword, or (for a genuine one-off) nothing at
 * all. Deciding *what generalizes* is a real understanding task, so it goes
 * through Claude rather than a fixed heuristic; once decided, checking
 * whether a given thread matches stays a plain substring test (see
 * matchesLabelRule in label-rules.ts) — this is called once per correction
 * event, never once per candidate thread.
 */
export async function suggestLabelMatchCriteria(opts: {
  fromAddress: string;
  subject: string;
  snippet?: string;
  targetLabel: string;
}): Promise<LabelMatchCriteria | null> {
  if (!getAnthropic()) return null;
  if (!opts.fromAddress.trim() || !opts.targetLabel.trim()) return null;

  const raw = await claudeJson<{
    fromContains: string | null;
    subjectContains: string | null;
    ruleName: string | null;
  }>({
    model: "haiku",
    maxTokens: 200,
    system: `A human just labeled one email "${opts.targetLabel}". Suggest reusable matching criteria that would correctly catch "other mail like this" going forward — without being so broad it catches unrelated mail. Return JSON {fromContains, subjectContains, ruleName}.
- fromContains: a substring of the sender address that generalizes correctly — prefer the exact address over its whole domain, UNLESS the subject/snippet clearly indicates an automated/bulk/transactional sender (e.g. a bank, a notification system, a merchant) where the whole domain is the right scope. null if no sender-based generalization makes sense.
- subjectContains: a short recurring subject phrase/keyword, only if one is actually characteristic of this kind of mail (e.g. "invoice", "statement") — null otherwise. Most corrections only need fromContains.
- ruleName: a short human-readable name for the rule (e.g. "Axis Bank statements"), only meaningful if at least one of the above is non-null.
If this looks like a one-off — a personal note, a unique one-time request, nothing that would recur — return {fromContains: null, subjectContains: null, ruleName: ""}. Do not invent a generalization that isn't really there.`,
    user: `From: ${opts.fromAddress}\nSubject: ${opts.subject}\nSnippet: ${(opts.snippet || "").slice(0, 400)}\nLabel assigned: ${opts.targetLabel}`,
  });

  if (!raw) return null;
  const fromContains = raw.fromContains?.trim() || null;
  const subjectContains = raw.subjectContains?.trim() || null;
  if (!fromContains && !subjectContains) return null;

  return {
    fromContains,
    subjectContains,
    ruleName: raw.ruleName?.trim() || opts.targetLabel,
  };
}
