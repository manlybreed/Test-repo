/**
 * Smarter mailbox search: tokenize + AND all terms + light synonyms.
 * "SBI POS machine" matches mail that mentions those concepts even if
 * they never appear as one contiguous phrase.
 */

const STOP = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "in",
  "on",
  "and",
  "or",
  "is",
  "at",
  "as",
  "by",
  "re",
  "fw",
  "fwd",
  "with",
  "from",
  "your",
  "our",
  "mail",
  "email",
  "regarding",
  "about",
]);

/** token → alternate spellings / related phrases to OR-match */
const SYNONYMS: Record<string, string[]> = {
  pos: ["pos", "point of sale", "e-statement", "estatement", "e statement"],
  sbi: ["sbi", "state bank", "state bank of india"],
  hdfc: ["hdfc", "hdfc bank"],
  icici: ["icici", "icici bank"],
  axis: ["axis", "axis bank"],
  machine: ["machine", "device", "terminal", "edc"],
  machines: ["machine", "machines", "device", "terminal", "edc"],
  terminal: ["terminal", "machine", "device", "edc", "pos"],
  statement: ["statement", "e-statement", "estatement"],
  kusum: ["kusum", "pm kusum", "pmkusum", "pm-kusum"],
  pmkusum: ["kusum", "pm kusum", "pmkusum"],
  upi: ["upi", "unified payments"],
  neft: ["neft"],
  imps: ["imps"],
  invoice: ["invoice", "tax invoice", "proforma"],
  bluridge: ["bluridge", "blu ridge", "thebluridge"],
};

/** Generic nouns — boost ranking but not required for a hit. */
const OPTIONAL_TOKENS = new Set([
  "machine",
  "machines",
  "device",
  "devices",
  "terminal",
  "terminals",
  "update",
  "updates",
  "info",
  "please",
  "hello",
  "hi",
  "test",
]);

export function tokenizeSearchQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
  // de-dupe, keep order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Tokens that must all match (synonyms OK). */
export function requiredSearchTokens(tokens: string[]): string[] {
  const required = tokens.filter((t) => !OPTIONAL_TOKENS.has(t));
  // If the user only typed optional words, require them all
  return required.length ? required : tokens;
}

export function synonymVariants(token: string): string[] {
  const key = token.toLowerCase();
  const list = SYNONYMS[key] || [key];
  return Array.from(new Set(list.map((s) => s.toLowerCase())));
}

type ContainsFilter = { contains: string; mode: "insensitive" };

function contains(v: string): ContainsFilter {
  return { contains: v, mode: "insensitive" };
}

/** Prisma OR: match variants across subject/body/sender local@domain/attachments. */
export function messageFieldMatchOr(variants: string[]) {
  const expanded = expandSenderVariants(variants);
  return {
    OR: expanded.flatMap((v) => [
      { subject: contains(v) },
      { snippet: contains(v) },
      { searchText: contains(v) },
      { bodyText: contains(v) },
      { fromAddress: contains(v) },
      { fromName: contains(v) },
      { toAddresses: contains(v) },
      { ccAddresses: contains(v) },
      {
        attachments: {
          some: { extractedText: contains(v) },
        },
      },
    ]),
  };
}

/** Also match username / domain fragments (sbi → user@sbi.co.in, sbi.*). */
function expandSenderVariants(variants: string[]): string[] {
  const out = new Set<string>();
  for (const v of variants) {
    const t = v.trim().toLowerCase();
    if (!t) continue;
    out.add(t);
    if (!t.includes(" ") && !t.includes("@") && t.length >= 2) {
      out.add(`@${t}`);
      out.add(`${t}.`);
      out.add(`${t}@`);
    }
  }
  return [...out];
}

export type SearchPlanLike = {
  mustGroups: string[][];
  should?: string[];
  fromHints?: string[];
};

function groupClause(variants: string[]) {
  const v = expandSenderVariants(variants);
  return {
    OR: [
      ...v.flatMap((term) => [
        { subject: contains(term) },
        { snippet: contains(term) },
        { participantsJson: contains(term) },
        { labelsJson: contains(term) },
      ]),
      { messages: { some: messageFieldMatchOr(v) } },
    ],
  };
}

/** Prisma AND of concept groups (from AI plan or lexical tokens). */
export function buildThreadSearchAnd(
  query: string,
  plan?: SearchPlanLike | null,
): object[] {
  const phrase = query.trim();
  if (plan?.mustGroups?.length) {
    const clauses = plan.mustGroups
      .map((g) => g.map((s) => s.trim()).filter(Boolean))
      .filter((g) => g.length)
      .map((g) => groupClause(g));
    // fromHints are ranking boosts only (see scoreSearchHit) — not required
    return clauses.length ? clauses : [{ OR: [{ subject: contains(phrase) }] }];
  }

  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length && phrase.length < 2) return [];

  const required = requiredSearchTokens(tokens);

  if (required.length <= 1) {
    const variants = required[0]
      ? synonymVariants(required[0])
      : tokens[0]
        ? synonymVariants(tokens[0])
        : [phrase];
    return [groupClause(variants)];
  }

  return required.map((token) => groupClause(synonymVariants(token)));
}

/** Higher = better. Used after SQL fetch. */
export function scoreSearchHit(opts: {
  query: string;
  subject: string;
  snippet?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  searchBlob?: string | null;
  plan?: SearchPlanLike | null;
}): number {
  const tokens = tokenizeSearchQuery(opts.query);
  const phrase = opts.query.trim().toLowerCase();
  const subject = (opts.subject || "").toLowerCase();
  const snippet = (opts.snippet || "").toLowerCase();
  const fromRaw = `${opts.fromName || ""} ${opts.fromAddress || ""}`.toLowerCase();
  const [local = "", domain = ""] = (opts.fromAddress || "")
    .toLowerCase()
    .split("@");
  const from = `${fromRaw} ${local} ${domain}`;
  const blob = (opts.searchBlob || "").toLowerCase();
  const hay = `${subject}\n${snippet}\n${from}\n${blob}`;

  let score = 0;
  if (phrase.length >= 3 && hay.includes(phrase)) score += 80;
  if (phrase.length >= 3 && subject.includes(phrase)) score += 40;

  const groups =
    opts.plan?.mustGroups?.length && opts.plan.mustGroups.length > 0
      ? opts.plan.mustGroups
      : tokens.map((t) => synonymVariants(t));

  for (const group of groups) {
    const variants = expandSenderVariants(group);
    const inSubject = variants.some((v) => subject.includes(v));
    const inFrom = variants.some((v) => from.includes(v));
    const inSnippet = variants.some((v) => snippet.includes(v));
    const inBlob = variants.some((v) => blob.includes(v));
    if (inSubject) score += 28;
    else if (inFrom) score += 22;
    else if (inSnippet) score += 12;
    else if (inBlob) score += 8;
  }

  for (const hint of opts.plan?.fromHints || []) {
    if (from.includes(hint.toLowerCase())) score += 20;
  }
  for (const term of opts.plan?.should || []) {
    if (hay.includes(term.toLowerCase())) score += 6;
  }

  const subjectHits = groups.filter((g) =>
    expandSenderVariants(g).some((v) => subject.includes(v)),
  ).length;
  if (groups.length && subjectHits === groups.length) score += 30;

  return score;
}
