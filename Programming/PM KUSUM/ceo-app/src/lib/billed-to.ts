/**
 * Normalize & match "Billed to" party names.
 * e.g. "MR Royal S/O xyz" ≡ "MR Royal"; "Manna Ram Royal" may be ambiguous vs "Royal".
 */

const TITLE_RE =
  /^(?:mr|mrs|ms|miss|shri|smt|dr|adv|m\/?s|messrs)\.?\s+/i;

/**
 * Cut father/husband/care-of suffixes: S/O, S.O., D/O, W/O, Son of, …
 * Everything from the marker to end of string is removed.
 */
export function stripRelationSuffix(s: string): string {
  if (!s) return "";
  return s
    .replace(
      // S/O  S.O.  S\O  S O  SO   (and D/O W/O C/O)
      /\b(?:[sdwc])\s*[./\\]?\s*o\b\s*[:\-–—,.]?\s*.*$/i,
      "",
    )
    .replace(
      /\b(?:son|daughter|wife|care)\s+of\b\s*[:\-–—,.]?\s*.*$/i,
      "",
    )
    .trim();
}

/** Human-readable name for UI / canonical party label (titles + S/O stripped). */
export function displayBilledToName(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  let s = raw.trim().replace(/\s+/g, " ");

  for (let i = 0; i < 3; i++) {
    const next = s.replace(TITLE_RE, "").trim();
    if (next === s) break;
    s = next;
  }

  s = stripRelationSuffix(s);
  if (!s) return "";

  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      // Keep short all-caps tokens (II, III) as-is-ish
      if (/^[IVX]+$/i.test(w) && w.length <= 5) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

export function normalizeBilledToName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["""'']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (let i = 0; i < 3; i++) {
    const next = s.replace(TITLE_RE, "").trim();
    if (next === s) break;
    s = next;
  }

  // Strip S/O … BEFORE removing slashes/punctuation
  s = stripRelationSuffix(s);

  s = s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

export function billedToTokens(norm: string): string[] {
  return norm.split(/\s+/).filter((t) => t.length > 1);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export type BilledToMatchKind = "exact" | "auto" | "ambiguous" | "none";

export type BilledToScore = {
  kind: BilledToMatchKind;
  score: number;
  reason: string;
};

/**
 * Score how likely `incoming` refers to the same person/entity as `existing`
 * (both preferably already normalized, but raw is fine).
 */
export function scoreBilledToMatch(
  incomingRaw: string,
  existingRaw: string,
): BilledToScore {
  const a = normalizeBilledToName(incomingRaw);
  const b = normalizeBilledToName(existingRaw);
  if (!a || !b) return { kind: "none", score: 0, reason: "empty" };

  if (a === b) {
    return { kind: "exact", score: 1, reason: "normalized equal" };
  }

  const ta = billedToTokens(a);
  const tb = billedToTokens(b);
  const jac = jaccard(ta, tb);

  const aInB = b.includes(a);
  const bInA = a.includes(b);

  if (aInB || bInA) {
    const shorter = a.length <= b.length ? ta : tb;
    const longer = a.length <= b.length ? tb : ta;
    if (shorter.length === 1 && longer.length >= 2) {
      return {
        kind: "ambiguous",
        score: 0.7,
        reason: `"${shorter[0]}" appears inside a longer name`,
      };
    }
    if (shorter.length >= 2 && shorter.every((t) => longer.includes(t))) {
      return { kind: "auto", score: 0.92, reason: "multi-token containment" };
    }
    return {
      kind: "ambiguous",
      score: 0.75,
      reason: "partial name containment",
    };
  }

  if (jac >= 0.85) {
    return { kind: "auto", score: jac, reason: "high token overlap" };
  }
  if (jac >= 0.45) {
    return {
      kind: "ambiguous",
      score: jac,
      reason: "partial token overlap — confirm if same person",
    };
  }

  return { kind: "none", score: jac, reason: "no match" };
}
