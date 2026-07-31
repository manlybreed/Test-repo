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
export const SYNONYMS: Record<string, string[]> = {
  pos: ["pos", "point of sale"],
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

/**
 * Short alphabetic tokens ("pos", "sbi", "edc") must not match as substrings
 * of longer words — ILIKE '%pos%' matches "proposal", which flooded
 * "SBI POS machine" with financing-proposal threads.
 */
export function needsWordBoundary(token: string): boolean {
  const t = token.trim().toLowerCase();
  return t.length > 0 && t.length <= 3 && /^[a-z0-9]+$/i.test(t);
}

/** Case-insensitive whole-token (or substring for longer / multi-word) match. */
export function textHasToken(haystack: string, token: string): boolean {
  const hay = haystack.toLowerCase();
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (!needsWordBoundary(t)) return hay.includes(t);
  return new RegExp(
    `(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    "i",
  ).test(hay);
}

/**
 * Prisma field filters for a search token. Short tokens use separator-padded
 * contains / startsWith / endsWith approximations (Prisma has no ~* filter).
 */
function fieldTokenMatch(field: string, term: string): object[] {
  if (!needsWordBoundary(term)) {
    return [{ [field]: contains(term) }];
  }
  const mode = "insensitive" as const;
  return [
    { [field]: { equals: term, mode } },
    { [field]: { startsWith: `${term} `, mode } },
    { [field]: { startsWith: `${term}:`, mode } },
    { [field]: { startsWith: `${term}-`, mode } },
    { [field]: { endsWith: ` ${term}`, mode } },
    { [field]: contains(` ${term} `) },
    { [field]: contains(` ${term}.`) },
    { [field]: contains(` ${term},`) },
    { [field]: contains(` ${term}:`) },
    { [field]: contains(` ${term}-`) },
    { [field]: contains(`(${term})`) },
    { [field]: contains(`[${term}]`) },
    { [field]: contains(`/${term} `) },
    { [field]: contains(`\n${term} `) },
  ];
}

/** Prisma OR: match a person across participants / from / to / cc (no body scan). */
export function personParticipantWhere(
  addresses: string[],
  nameQuery?: string,
): object {
  const ors: object[] = [];
  for (const raw of addresses) {
    const addr = raw.trim().toLowerCase();
    if (!addr) continue;
    ors.push({ participantsJson: { contains: addr, mode: "insensitive" as const } });
    ors.push({
      messages: {
        some: {
          OR: [
            { fromAddress: { contains: addr, mode: "insensitive" as const } },
            { toAddresses: { contains: addr, mode: "insensitive" as const } },
            { ccAddresses: { contains: addr, mode: "insensitive" as const } },
          ],
        },
      },
    });
  }
  const name = nameQuery?.trim();
  if (name && name.length >= 2) {
    ors.push({
      messages: {
        some: {
          OR: [
            { fromName: { contains: name, mode: "insensitive" as const } },
            { toAddresses: { contains: name, mode: "insensitive" as const } },
          ],
        },
      },
    });
    ors.push({
      participantsJson: { contains: name, mode: "insensitive" as const },
    });
  }
  return ors.length ? { OR: ors } : { id: "__never__" };
}

/** Prisma OR: match variants across subject/body/sender local@domain/attachments. */
export function messageFieldMatchOr(variants: string[]) {
  const expanded = expandSenderVariants(variants);
  return {
    OR: expanded.flatMap((v) => [
      ...fieldTokenMatch("subject", v),
      ...fieldTokenMatch("snippet", v),
      ...fieldTokenMatch("searchText", v),
      ...fieldTokenMatch("bodyText", v),
      ...fieldTokenMatch("fromAddress", v),
      ...fieldTokenMatch("fromName", v),
      ...fieldTokenMatch("toAddresses", v),
      ...fieldTokenMatch("ccAddresses", v),
      {
        attachments: {
          some: {
            OR: fieldTokenMatch("extractedText", v),
          },
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

export type SearchTier = "person" | "keyword" | "nl";

/** Tokens that are project/bank/product jargon, not person names. */
const NON_PERSON_TOKENS = new Set([
  ...Object.keys(SYNONYMS),
  "invoice",
  "invoices",
  "loan",
  "payment",
  "payments",
  "meeting",
  "meetings",
  "draft",
  "attachment",
  "attachments",
  "report",
  "reports",
  "receipt",
  "receipts",
  "proposal",
  "contract",
  "contracts",
  "quote",
  "quotation",
  "po",
  "gst",
  "tds",
  "pan",
  "aadhaar",
  "pm",
  "kusum",
]);

const NL_QUERY_RE =
  /\b(who|what|when|where|why|how|which|whose|whom|about|regarding|show\s+me|find\s+(me\s+)?(all\s+)?(the\s+)?(mails?|emails?|messages?)|any\s+(mail|email)|look\s+for|search\s+for|tell\s+me|did\s+\w+\s+send|sent\s+me)\b/i;

/** 1–3 alphabetic name-like tokens (optional middle initials / hyphens). */
const PERSON_NAME_RE =
  /^[a-z][a-z.'’\-]*(\s+[a-z][a-z.'’\-]*){0,2}$/i;

/**
 * Route Threads search box queries (R6 / §3.2):
 * - person: bare names → MailContact, no Claude
 * - keyword: short tokens / jargon → FTS
 * - nl: questions / paraphrase → AI expand + FTS (+ optional rerank)
 */
export function classifySearchTier(freeText: string): SearchTier {
  const q = freeText.trim();
  if (!q) return "keyword";
  if (q.includes("?") || NL_QUERY_RE.test(q)) return "nl";

  const tokens = tokenizeSearchQuery(q);
  if (tokens.length >= 5 || q.length >= 48) return "nl";

  if (
    tokens.length >= 1 &&
    tokens.length <= 3 &&
    PERSON_NAME_RE.test(q) &&
    !/\d|@/.test(q)
  ) {
    // Bank/product jargon ("sbi pos", "invoice") is keyword, not a person.
    const allJargon = tokens.every((t) => NON_PERSON_TOKENS.has(t));
    const mixedJargon =
      tokens.length > 1 && tokens.some((t) => NON_PERSON_TOKENS.has(t));
    if (!allJargon && !mixedJargon) return "person";
  }

  return "keyword";
}

export type ParsedSearchOperators = {
  /** Whatever's left after stripping recognized operators — feeds the existing AI-expand/lexical path. */
  freeText: string;
  /** Structured Prisma where fragments for each recognized operator, ANDed in as-is. */
  whereFragments: object[];
};

const OPERATOR_RE = /(\w+):(?:"([^"]*)"|(\S+))/g;

/**
 * Gmail-style search operators — from:, to:, has:attachment, is:unread/
 * starred/important/read, label:, before:/after: (YYYY-MM-DD). Anything not
 * recognized (including a bare "key:" with no matching operator) is left in
 * freeText so it still gets searched literally rather than silently dropped.
 */
export function parseSearchOperators(query: string): ParsedSearchOperators {
  const whereFragments: object[] = [];
  const freeTextParts: string[] = [];
  let lastIndex = 0;
  OPERATOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPERATOR_RE.exec(query))) {
    freeTextParts.push(query.slice(lastIndex, m.index));
    lastIndex = OPERATOR_RE.lastIndex;

    const key = m[1].toLowerCase();
    const value = (m[2] ?? m[3] ?? "").trim();
    if (!value) {
      freeTextParts.push(m[0]);
      continue;
    }
    const lower = value.toLowerCase();

    if (key === "from") {
      whereFragments.push({
        messages: {
          some: { OR: [{ fromAddress: contains(value) }, { fromName: contains(value) }] },
        },
      });
    } else if (key === "to") {
      whereFragments.push({ messages: { some: { toAddresses: contains(value) } } });
    } else if (key === "has" && (lower === "attachment" || lower === "attachments")) {
      whereFragments.push({ messages: { some: { hasAttachments: true } } });
    } else if (key === "is" && lower === "unread") {
      whereFragments.push({ unreadCount: { gt: 0 } });
    } else if (key === "is" && lower === "read") {
      whereFragments.push({ unreadCount: 0 });
    } else if (key === "is" && (lower === "starred" || lower === "important")) {
      whereFragments.push({ important: true });
    } else if (key === "label") {
      whereFragments.push({ labelsJson: contains(value) });
    } else if (key === "before" && !Number.isNaN(new Date(value).getTime())) {
      whereFragments.push({ lastMessageAt: { lt: new Date(value) } });
    } else if (key === "after" && !Number.isNaN(new Date(value).getTime())) {
      whereFragments.push({ lastMessageAt: { gte: new Date(value) } });
    } else {
      freeTextParts.push(m[0]);
    }
  }
  freeTextParts.push(query.slice(lastIndex));

  return {
    freeText: freeTextParts.join(" ").replace(/\s+/g, " ").trim(),
    whereFragments,
  };
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
        ...fieldTokenMatch("subject", term),
        ...fieldTokenMatch("snippet", term),
        ...fieldTokenMatch("participantsJson", term),
        ...fieldTokenMatch("labelsJson", term),
      ]),
      { messages: { some: messageFieldMatchOr(variants) } },
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

/**
 * Recency multiplier (Phase R1): exp(-ageDays/180), floored so a strong old
 * match still surfaces. 0d→1.0, 30d→~0.85, 90d→~0.61, ≥~1yr→floor 0.4.
 */
function recencyFactor(date: string | Date | null | undefined): number {
  if (!date) return 1;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  return Math.max(0.4, Math.exp(-ageDays / 180));
}

/** Higher = better. Used after SQL fetch. */
export function scoreSearchHit(opts: {
  query: string;
  subject: string;
  snippet?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  searchBlob?: string | null;
  /** When provided, applies a recency prior to the final score. */
  date?: string | Date | null;
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

  // A group satisfied only via a multi-word/hyphenated synonym variant
  // ("point of sale", "e-statement") must never score like a literal,
  // single-word match — mirrors Algolia's alternativesAsExact distinction
  // (multi-word synonyms are "semantically farther"). Weight 1.0 for a
  // literal/single-word hit, 0.4 for a multi-word-only hit, 0 for no hit —
  // a second, independent defense layer beyond the literal-first waterfall:
  // even a future bad multi-word synonym entry that slips past the
  // SYNONYMS cross-concept test ranks low instead of winning outright.
  const isMultiWord = (v: string) => v.includes(" ") || v.includes("-");
  const bestMatchWeight = (haystack: string, variants: string[]): number => {
    let weight = 0;
    for (const v of variants) {
      if (!textHasToken(haystack, v)) continue;
      weight = Math.max(weight, isMultiWord(v) ? 0.4 : 1);
    }
    return weight;
  };

  const subjectWeights: number[] = [];
  for (const group of groups) {
    const variants = expandSenderVariants(group);
    const subjectW = bestMatchWeight(subject, variants);
    const fromW = bestMatchWeight(from, variants);
    const snippetW = bestMatchWeight(snippet, variants);
    const blobW = bestMatchWeight(blob, variants);
    subjectWeights.push(subjectW);
    if (subjectW) score += 28 * subjectW;
    else if (fromW) score += 22 * fromW;
    else if (snippetW) score += 12 * snippetW;
    else if (blobW) score += 8 * blobW;
  }

  for (const hint of opts.plan?.fromHints || []) {
    if (textHasToken(from, hint)) score += 20;
  }
  for (const term of opts.plan?.should || []) {
    if (textHasToken(hay, term)) score += 6;
  }

  const subjectHits = subjectWeights.filter((w) => w > 0).length;
  if (groups.length && subjectHits === groups.length) {
    score += 30 * Math.min(...subjectWeights);
  }

  return score * recencyFactor(opts.date);
}
