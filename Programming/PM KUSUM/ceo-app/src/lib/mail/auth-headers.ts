/**
 * AI-22 authentication signal — SPF/DKIM/DMARC pass/fail is a cheap,
 * deterministic phishing signal this codebase wasn't using at all:
 * domain-spoofing phishing (impersonating a real service/company from a
 * lookalike domain, e.g. this account's own live-tested
 * "techsupport.microsoft.com" spoof) very often fails these checks even
 * when the message body reads as plausible prose.
 *
 * mailparser does NOT always return a plain string for a header —
 * verified directly against node_modules/mailparser/lib/mail-parser.js:
 * a header only collapses to a single string when it appeared exactly
 * once in the raw message (a fixed `singleKeys` list gets this treatment
 * unconditionally; anything else only collapses if `value.length === 1`).
 * Authentication-Results is commonly stamped once per relay hop, so a
 * multi-hop message keeps it as a string[], ordered top-to-bottom from
 * the raw source — the topmost entry is the most recent hop (closest to
 * final delivery, i.e. this account's own provider's own check).
 */

export function normalizeHeaderValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === "string");
    return typeof first === "string" ? first : null;
  }
  return null;
}

type AuthResult = "pass" | "fail" | "none" | "softfail" | "neutral" | "temperror" | "permerror";

function extractResult(authResults: string, mechanism: "spf" | "dkim" | "dmarc"): AuthResult | null {
  const match = new RegExp(`\\b${mechanism}=(\\w+)`, "i").exec(authResults);
  if (!match) return null;
  const value = match[1]!.toLowerCase();
  const known: AuthResult[] = ["pass", "fail", "none", "softfail", "neutral", "temperror", "permerror"];
  return (known as string[]).includes(value) ? (value as AuthResult) : null;
}

/**
 * Compact "spf=... dkim=... dmarc=..." summary, or null when there's no
 * signal at all (no Authentication-Results header, and no parseable
 * Received-SPF fallback). Never guesses a value it can't find — an
 * omitted field in the summary means "unknown for this message," not
 * "failed."
 */
export function summarizeAuthResults(
  authResults: string | null,
  receivedSpf: string | null,
): string | null {
  const parts: string[] = [];

  if (authResults) {
    const spf = extractResult(authResults, "spf");
    const dkim = extractResult(authResults, "dkim");
    const dmarc = extractResult(authResults, "dmarc");
    if (spf) parts.push(`spf=${spf}`);
    if (dkim) parts.push(`dkim=${dkim}`);
    if (dmarc) parts.push(`dmarc=${dmarc}`);
  }

  if (!parts.some((p) => p.startsWith("spf=")) && receivedSpf) {
    const match = /^(pass|fail|none|softfail|neutral|temperror|permerror)\b/i.exec(
      receivedSpf.trim(),
    );
    if (match) parts.unshift(`spf=${match[1]!.toLowerCase()}`);
  }

  return parts.length ? parts.join(" ") : null;
}
