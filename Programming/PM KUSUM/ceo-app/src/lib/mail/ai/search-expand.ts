import { z } from "zod";
import { claudeJson, getAnthropic } from "@/lib/mail/ai/claude";
import {
  synonymVariants,
  tokenizeSearchQuery,
} from "@/lib/mail/mail-search";

const SearchPlanSchema = z.object({
  /** Concept groups — EVERY group must match (variants inside a group are OR). */
  mustGroups: z.array(z.array(z.string()).min(1)).default([]),
  /** Extra terms that boost ranking but are not required. */
  should: z.array(z.string()).default([]),
  /** Likely sender local-parts or domains (sbi, statebank, yono…). */
  fromHints: z.array(z.string()).default([]),
  intent: z.string().optional(),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

const expandCache = new Map<string, { at: number; plan: SearchPlan }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheGet(q: string): SearchPlan | null {
  const hit = expandCache.get(q.toLowerCase());
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    expandCache.delete(q.toLowerCase());
    return null;
  }
  return hit.plan;
}

function cacheSet(q: string, plan: SearchPlan) {
  expandCache.set(q.toLowerCase(), { at: Date.now(), plan });
}

/** Deterministic fallback when Claude is unavailable. */
export function lexicalSearchPlan(query: string): SearchPlan {
  const tokens = tokenizeSearchQuery(query);
  const mustGroups = tokens
    .filter((t) => !["machine", "machines", "device", "devices"].includes(t))
    .map((t) => synonymVariants(t));
  const optional = tokens.filter((t) =>
    ["machine", "machines", "device", "devices", "terminal"].includes(t),
  );
  return {
    mustGroups: mustGroups.length
      ? mustGroups
      : tokens.map((t) => synonymVariants(t)),
    should: optional.flatMap((t) => synonymVariants(t)),
    fromHints: tokens.filter((t) =>
      ["sbi", "hdfc", "icici", "axis", "kotak", "yesbank", "bluridge"].includes(
        t,
      ),
    ),
    intent: query.trim(),
  };
}

/**
 * AI rewrite: turn "SBI POS machine" into concept groups that match real mail
 * (State Bank, e-statement, terminal, @sbi.co.in, etc.).
 */
export async function expandSearchQuery(query: string): Promise<SearchPlan> {
  const q = query.trim();
  if (q.length < 2) {
    return { mustGroups: [], should: [], fromHints: [], intent: q };
  }

  const cached = cacheGet(q);
  if (cached) return cached;

  const fallback = lexicalSearchPlan(q);

  if (!getAnthropic() || q.length < 4) {
    cacheSet(q, fallback);
    return fallback;
  }

  const raw = await claudeJson<SearchPlan>({
    model: "haiku",
    maxTokens: 500,
    system: `You expand CEO mailbox search queries into JSON for India business email.
Return JSON only:
{
  "mustGroups": string[][],  // each inner array is OR-synonyms for ONE required concept
  "should": string[],        // optional boost terms
  "fromHints": string[],     // sender username or domain fragments
  "intent": string
}

Rules:
- mustGroups: 1–4 groups. A thread must match ≥1 variant from EACH group.
- Include real mail phrasing: bank short codes, "e-statement", "POS", "EDC", "terminal", merchant, etc.
- fromHints: domains/locals like "sbi", "statebank", "yono", "hdfcbank", "reportsmailer".
- Keep variants short (1–4 words). No sentences.
- Example: "SBI POS machine" →
  mustGroups: [["sbi","state bank","state bank of india"],["pos","point of sale","e-statement","estatement","edc","terminal"]],
  should: ["machine","device","merchant","card"],
  fromHints: ["sbi","statebank","yono","onlinesbi"]`,
    user: `Query: ${q}`,
  }).catch(() => null);

  const parsed = SearchPlanSchema.safeParse(raw);
  if (!parsed.success) {
    cacheSet(q, fallback);
    return fallback;
  }

  // Merge AI plan with lexical synonyms so we never drop known banks/POS terms
  const merged = mergePlans(fallback, parsed.data);
  cacheSet(q, merged);
  return merged;
}

function mergePlans(a: SearchPlan, b: SearchPlan): SearchPlan {
  const groups = [...b.mustGroups];
  for (const g of a.mustGroups) {
    const key = g[0]?.toLowerCase();
    const exists = groups.some((x) =>
      x.some((t) => t.toLowerCase() === key || g.includes(t.toLowerCase())),
    );
    if (!exists) groups.push(g);
  }
  return {
    mustGroups: groups
      .map((g) =>
        Array.from(new Set(g.map((s) => s.trim().toLowerCase()).filter(Boolean))),
      )
      .filter((g) => g.length)
      .slice(0, 5),
    should: Array.from(
      new Set(
        [...a.should, ...b.should].map((s) => s.trim().toLowerCase()).filter(Boolean),
      ),
    ).slice(0, 16),
    fromHints: Array.from(
      new Set(
        [...a.fromHints, ...b.fromHints]
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ).slice(0, 12),
    intent: b.intent || a.intent,
  };
}

const RerankSchema = z.object({
  orderedIds: z.array(z.string()),
});

/**
 * Ask Haiku to order candidate threads by relevance to the user's intent.
 */
export async function rerankSearchHits(opts: {
  query: string;
  intent?: string;
  candidates: {
    id: string;
    subject: string;
    fromAddress?: string | null;
    fromName?: string | null;
    snippet?: string | null;
  }[];
}): Promise<string[] | null> {
  if (!getAnthropic() || opts.candidates.length < 2) return null;

  const raw = await claudeJson<z.infer<typeof RerankSchema>>({
    model: "haiku",
    maxTokens: 800,
    system: `Rank mailbox threads for a search query. Return JSON {orderedIds: string[]}
with the most relevant thread ids first. Only use ids from the candidates list.
Drop clearly irrelevant threads. Prefer subject/from matches over weak body noise.`,
    user: JSON.stringify({
      query: opts.query,
      intent: opts.intent || opts.query,
      candidates: opts.candidates.slice(0, 28).map((c) => ({
        id: c.id,
        subject: c.subject,
        from: c.fromName || c.fromAddress,
        snippet: (c.snippet || "").slice(0, 160),
      })),
    }),
  }).catch(() => null);

  const parsed = RerankSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = new Set(opts.candidates.map((c) => c.id));
  return parsed.data.orderedIds.filter((id) => allowed.has(id));
}
