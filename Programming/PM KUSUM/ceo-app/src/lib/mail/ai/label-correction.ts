import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";

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

/**
 * "Is this existing thread genuinely similar to the one just corrected" is
 * the same class of problem this session already hit once with recipient
 * extraction: a keyword/substring test can't tell that "Bhaureji Surajmal
 * Green Energy Pvt Ltd, Component A, Bharatpur-Part 3" and "Kumha Solar Pvt
 * Ltd, Component A, Bharatpur-Part 1" are the same *kind* of mail (the same
 * PM KUSUM financing template, sent about different company entities) —
 * their subjects share almost no literal substring. So candidate threads
 * are fetched with a deliberately broad, OR-based query (see
 * findBroadCandidateThreads in label-rules.ts) and then judged here, with
 * the model reading each candidate's actual content — the same
 * retrieve-then-classify shape as this codebase's existing RAG retrieval,
 * just reranking for "same kind of mail" instead of topical relevance to a
 * search query.
 */
export async function classifySimilarThreads(opts: {
  targetLabel: string;
  source: { subject: string; fromAddress: string; snippet: string };
  candidates: {
    id: string;
    subject: string;
    fromAddress: string;
    snippet: string;
  }[];
}): Promise<string[] | null> {
  if (!getAnthropic()) return null;
  if (!opts.candidates.length) return [];

  const raw = await claudeJson<{ similarIds: string[] }>({
    model: "haiku",
    maxTokens: 1024,
    system: `A human just labeled sourceEmail "${opts.targetLabel}". Decide which of the candidate emails are genuinely the SAME KIND of mail and deserve that same label — same purpose, topic, or template as sourceEmail, even if the sender, company/person name, or exact subject wording differs (e.g. the same kind of templated business email sent about a different client, project, or entity is still the same kind of mail). Do not require literal keyword overlap — judge by what the email is actually about and for. Exclude anything that only superficially shares a sender or a word but is actually a different topic or purpose. Return JSON {similarIds: string[]} — the "id" values of matching candidates only (from the "candidates" array), or an empty array if none are genuinely similar.`,
    user: fenceMailData({
      sourceEmail: opts.source,
      targetLabel: opts.targetLabel,
      candidates: opts.candidates,
    }),
  });

  if (!raw || !Array.isArray(raw.similarIds)) return null;
  const validIds = new Set(opts.candidates.map((c) => c.id));
  return raw.similarIds.filter((id) => validIds.has(id));
}
