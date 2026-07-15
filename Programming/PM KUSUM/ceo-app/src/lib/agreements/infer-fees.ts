import Anthropic from "@anthropic-ai/sdk";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export type InferredAgreementFees = {
  tokenFeePerPlant: number | null;
  successFeePct: number | null;
  /** Flat INR success / professional fee when the deal is not %-based. */
  successFeeFlat: number | null;
  plantCount: number | null;
  tokenFeeCandidates: number[];
  successFeePctCandidates: number[];
  successFeeFlatCandidates: number[];
  notes: string | null;
  rawExtract: string | null;
};

type ExtractedFee = {
  label: string;
  role: "token" | "success" | "other" | "ignore";
  amountInr: number | null;
  percent: number | null;
  basis: string | null;
  quote: string | null;
};

const EXTRACT_PROMPT = `You extract BluRidge / advisor commercial fees from a finance advisory, mandate, or debt-syndication proposal/agreement (India).

Read the document and return ONLY JSON (no markdown):
{
  "fees": [
    {
      "label": "short name for this fee",
      "role": "token" | "success" | "other" | "ignore",
      "amountInr": <number or null — absolute INR amount if stated>,
      "percent": <number or null — e.g. 1.25 means 1.25%, never 0.0125>,
      "basis": "per_plant" | "flat" | "of_sanction" | "of_disbursement" | "of_loan" | "other" | null,
      "quote": "verbatim short snippet from the document"
    }
  ],
  "plantCount": <integer if stated, else null>,
  "summary": "one sentence describing how the advisor is paid"
}

Classification rules (role):
- "token" — engagement token, retainer, token fee, file initiation fee, adjustable advance paid upfront (usually per plant).
- "success" — professional success fee, success fee, syndication / advisory success consideration (may be a % of sanction/loan OR a flat INR amount).
- "ignore" — bank interest rates, CGTMSE / guarantee fees (AGF), GST rates, TDS, stamp duty, third-party TIR/LEI/ROC costs, EMI, tenure.
- "other" — any other advisor charge that is neither token nor success.

Critical:
- Do NOT invent fees. Only use amounts/percents written in the document.
- A success fee can be FLAT INR (e.g. "₹ 5,50,000 flat") with percent=null, OR a percentage (e.g. "1.25% of sanctioned loan") with amountInr=null.
- Indian grouping is common (₹ 5,50,000 = 550000). Always return plain numbers without commas.
- Ignore CGTMSE slab tables and loan interest options entirely (role "ignore").
- If several distinct token amounts or several distinct success terms appear, list each as its own fees[] entry.`;

function average(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function uniqRounded(nums: number[], decimals: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  const f = 10 ** decimals;
  for (const n of nums) {
    if (!Number.isFinite(n) || n <= 0) continue;
    const r = Math.round(n * f) / f;
    const key = String(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function parseMoney(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v !== "string") return null;
  const cleaned = v
    .replace(/₹/g, "")
    .replace(/\bRs\.?\b/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePercent(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Guard: model sometimes returns 0.0125 for 1.25%
    if (v > 0 && v < 0.2) return Math.round(v * 10000) / 100;
    return v;
  }
  if (typeof v !== "string") return null;
  const m = v.replace(/%/g, "").trim();
  const n = Number(m.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 0 && n < 0.2) return Math.round(n * 10000) / 100;
  return n;
}

function buildMultiFeeNote(
  kind: string,
  candidates: number[],
  chosen: number,
  format: (n: number) => string,
): string | null {
  if (candidates.length <= 1) return null;
  return `Multiple ${kind} found (${candidates.map(format).join(", ")}); using average ${format(chosen)}.`;
}

async function extractDocxPlainText(buf: Buffer): Promise<string> {
  const fflate = await import("fflate");
  const unzipped = fflate.unzipSync(new Uint8Array(buf));
  const xmlBytes = unzipped["word/document.xml"];
  if (!xmlBytes) return "";
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  return xml
    .replace(/<w:tab\b[^/]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<br\b[^/]*\/>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfPlainText(buf: Buffer): Promise<string> {
  try {
    const parsed = await pdfParse(buf);
    return (parsed.text || "").trim();
  } catch {
    return "";
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function normalizeRole(raw: unknown): ExtractedFee["role"] {
  const s = String(raw || "")
    .toLowerCase()
    .trim();
  if (s === "token" || s === "engagement" || s === "retainer") return "token";
  if (s === "success" || s === "professional" || s === "syndication")
    return "success";
  if (s === "ignore" || s === "bank" || s === "cgtmse") return "ignore";
  return "other";
}

function normalizeFees(data: Record<string, unknown>): ExtractedFee[] {
  const feesRaw = data.fees;
  if (!Array.isArray(feesRaw)) return [];
  const out: ExtractedFee[] = [];
  for (const item of feesRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    out.push({
      label: typeof row.label === "string" ? row.label : "Fee",
      role: normalizeRole(row.role),
      amountInr: parseMoney(row.amountInr),
      percent: parsePercent(row.percent),
      basis: typeof row.basis === "string" ? row.basis : null,
      quote: typeof row.quote === "string" ? row.quote : null,
    });
  }
  return out;
}

/**
 * Infer commercial fees from an uploaded agreement/proposal.
 * Discovers fee terms from the document (flat INR and/or %) instead of
 * assuming a fixed BluRidge template shape.
 */
export async function inferAgreementFeesFromFile(opts: {
  buffer: Buffer;
  ext: string;
  fileName?: string;
}): Promise<InferredAgreementFees> {
  const empty: InferredAgreementFees = {
    tokenFeePerPlant: null,
    successFeePct: null,
    successFeeFlat: null,
    plantCount: null,
    tokenFeeCandidates: [],
    successFeePctCandidates: [],
    successFeeFlatCandidates: [],
    notes: null,
    rawExtract: null,
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ...empty,
      notes: "AI fee inference skipped — ANTHROPIC_API_KEY not configured.",
    };
  }

  const ext = opts.ext.toLowerCase().replace(/^\./, "");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  type ContentBlock =
    | Anthropic.ImageBlockParam
    | Anthropic.DocumentBlockParam
    | Anthropic.TextBlockParam;

  const contentParts: ContentBlock[] = [];

  if (ext === "pdf") {
    const text = await extractPdfPlainText(opts.buffer);
    // Prefer document vision when text is thin; otherwise send text (cheaper/faster).
    if (text.length >= 800) {
      contentParts.push({
        type: "text",
        text: `${EXTRACT_PROMPT}\n\n--- Document text ---\n${text.slice(0, 120_000)}`,
      });
    } else {
      contentParts.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: opts.buffer.toString("base64"),
        },
      } as Anthropic.DocumentBlockParam);
      contentParts.push({ type: "text", text: EXTRACT_PROMPT });
    }
  } else if (ext === "docx") {
    const text = await extractDocxPlainText(opts.buffer);
    if (!text) {
      return {
        ...empty,
        notes: "Could not read DOCX text for fee inference.",
      };
    }
    contentParts.push({
      type: "text",
      text: `${EXTRACT_PROMPT}\n\n--- Document text ---\n${text.slice(0, 120_000)}`,
    });
  } else if (ext === "doc") {
    return {
      ...empty,
      notes: "Fee inference skipped for legacy .doc — upload PDF or DOCX.",
    };
  } else {
    return empty;
  }

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1600,
    messages: [{ role: "user", content: contentParts }],
  });

  const raw =
    msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
  let data: Record<string, unknown>;
  try {
    data = parseJsonObject(raw);
  } catch {
    return {
      ...empty,
      notes: "AI returned unreadable fee JSON.",
      rawExtract: raw.slice(0, 4000),
    };
  }

  const fees = normalizeFees(data);

  const tokenFeeCandidates = uniqRounded(
    fees
      .filter((f) => f.role === "token" && f.amountInr != null)
      .map((f) => f.amountInr as number),
    0,
  );

  const successFeePctCandidates = uniqRounded(
    fees
      .filter((f) => f.role === "success" && f.percent != null)
      .map((f) => f.percent as number),
    2,
  );

  const successFeeFlatCandidates = uniqRounded(
    fees
      .filter((f) => f.role === "success" && f.amountInr != null && f.percent == null)
      .map((f) => f.amountInr as number),
    0,
  );

  // If a success fee has BOTH amount and percent, prefer percent for % field
  // and still keep amount as flat candidate only when percent is absent.
  for (const f of fees) {
    if (f.role === "success" && f.amountInr != null && f.percent != null) {
      // percent already counted; ignore amount as "flat" to avoid double-counting
    }
  }

  const tokenAvg = average(tokenFeeCandidates);
  const successPctAvg = average(successFeePctCandidates);
  const successFlatAvg = average(successFeeFlatCandidates);

  const tokenFeePerPlant = tokenAvg == null ? null : Math.round(tokenAvg);
  const successFeePct =
    successPctAvg == null ? null : Math.round(successPctAvg * 100) / 100;
  const successFeeFlat =
    successFlatAvg == null ? null : Math.round(successFlatAvg);

  const plantRaw = data.plantCount;
  const plantCount =
    typeof plantRaw === "number" && plantRaw > 0
      ? Math.round(plantRaw)
      : typeof plantRaw === "string" && Number(plantRaw) > 0
        ? Math.round(Number(plantRaw))
        : null;

  const noteParts: string[] = [];
  const tokenNote = tokenFeePerPlant
    ? buildMultiFeeNote(
        "token fees",
        tokenFeeCandidates,
        tokenFeePerPlant,
        (n) => `₹${n.toLocaleString("en-IN")}`,
      )
    : null;
  const successPctNote = successFeePct
    ? buildMultiFeeNote(
        "success fee %",
        successFeePctCandidates,
        successFeePct,
        (n) => `${n}%`,
      )
    : null;
  const successFlatNote = successFeeFlat
    ? buildMultiFeeNote(
        "flat success fees",
        successFeeFlatCandidates,
        successFeeFlat,
        (n) => `₹${n.toLocaleString("en-IN")}`,
      )
    : null;

  if (tokenNote) noteParts.push(tokenNote);
  if (successPctNote) noteParts.push(successPctNote);
  if (successFlatNote) noteParts.push(successFlatNote);

  if (successFeeFlat && !successFeePct) {
    noteParts.push(
      `Success fee is flat ₹${successFeeFlat.toLocaleString("en-IN")} (not a %).`,
    );
  } else if (successFeeFlat && successFeePct) {
    noteParts.push(
      `Also found flat success amount ₹${successFeeFlat.toLocaleString("en-IN")}.`,
    );
  }

  const otherFees = fees.filter((f) => f.role === "other");
  if (otherFees.length) {
    noteParts.push(
      `Other advisor fees noted: ${otherFees
        .map((f) => f.quote || f.label)
        .slice(0, 3)
        .join("; ")}.`,
    );
  }

  if (
    typeof data.summary === "string" &&
    data.summary.trim() &&
    !tokenFeeCandidates.length &&
    !successFeePctCandidates.length &&
    !successFeeFlatCandidates.length
  ) {
    noteParts.push(data.summary.trim());
  }

  if (
    !tokenFeeCandidates.length &&
    !successFeePctCandidates.length &&
    !successFeeFlatCandidates.length &&
    !noteParts.length
  ) {
    noteParts.push("No clear advisor token/success fee found in the document.");
  }

  return {
    tokenFeePerPlant,
    successFeePct,
    successFeeFlat,
    plantCount,
    tokenFeeCandidates,
    successFeePctCandidates,
    successFeeFlatCandidates,
    notes: noteParts.length ? noteParts.join(" ") : null,
    rawExtract: raw.slice(0, 8000),
  };
}
