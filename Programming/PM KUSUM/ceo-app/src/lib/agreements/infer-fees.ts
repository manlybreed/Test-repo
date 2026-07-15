import Anthropic from "@anthropic-ai/sdk";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export type InferredAgreementFees = {
  tokenFeePerPlant: number | null;
  successFeePct: number | null;
  plantCount: number | null;
  tokenFeeCandidates: number[];
  successFeeCandidates: number[];
  notes: string | null;
  rawExtract: string | null;
};

const EXTRACT_PROMPT = `You are extracting fee terms from a BluRidge / PM KUSUM Finance Advisory & Mandate agreement (Indian legal agreement).

Return ONLY a JSON object (no markdown) with these exact keys:
{
  "tokenFees": [<numbers — every distinct token / retainer / engagement fee amount in INR per plant or as a lump sum token fee>],
  "tokenFeeLabels": ["short quote for each tokenFees entry, same order"],
  "successFeesPct": [<numbers — every distinct success / success-fee / advisory success percentage, e.g. 1 means 1%>],
  "successFeeLabels": ["short quote for each successFeesPct entry, same order"],
  "plantCount": <integer plant/project count if stated, else null>,
  "spvName": "SPV / project company if stated, else null",
  "effectiveDate": "YYYY-MM-DD if stated, else null",
  "summary": "one short sentence on how fees appear in the document"
}

Rules:
- Amounts are plain numbers (no ₹, no commas). 40000 not "40,000".
- Percentages are numeric (1 for 1%, 1.5 for 1.5%). Do not return 0.01 for 1%.
- Include every distinct fee value mentioned (schedules, annexures, amendments). If the same fee repeats, list it once.
- Token fee = engagement / retainer / token / upfront advisory fee (usually INR).
- Success fee = success fee / success-based / contingent % of loan or project.
- If a fee is a range (e.g. 0.75%–1.25%), include both ends as separate candidates.
- If nothing found for a field, use [] or null.`;

function average(nums: number[]): number | null {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function uniqRounded(nums: number[], decimals: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  const f = 10 ** decimals;
  for (const n of nums) {
    if (!Number.isFinite(n)) continue;
    const r = Math.round(n * f) / f;
    const key = String(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function buildMultiFeeNote(
  kind: string,
  candidates: number[],
  chosen: number,
  format: (n: number) => string,
): string | null {
  if (candidates.length <= 1) return null;
  const listed = candidates.map(format).join(", ");
  return `Multiple ${kind} found (${listed}); using average ${format(chosen)}.`;
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

function asNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "number" ? x : Number(String(x).replace(/,/g, ""))))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Infer token / success fees from an uploaded agreement (PDF or DOCX).
 * When multiple fee values appear, averages them and returns an explanatory note.
 */
export async function inferAgreementFeesFromFile(opts: {
  buffer: Buffer;
  ext: string;
  fileName?: string;
}): Promise<InferredAgreementFees> {
  const empty: InferredAgreementFees = {
    tokenFeePerPlant: null,
    successFeePct: null,
    plantCount: null,
    tokenFeeCandidates: [],
    successFeeCandidates: [],
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
    if (text.length >= 400) {
      contentParts.push({
        type: "text",
        text: `${EXTRACT_PROMPT}\n\n--- Agreement text ---\n${text.slice(0, 120_000)}`,
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
      text: `${EXTRACT_PROMPT}\n\n--- Agreement text ---\n${text.slice(0, 120_000)}`,
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
    max_tokens: 1024,
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

  const tokenFeeCandidates = uniqRounded(asNumberArray(data.tokenFees), 0);
  const successFeeCandidates = uniqRounded(asNumberArray(data.successFeesPct), 2);

  const tokenAvg = average(tokenFeeCandidates);
  const successAvg = average(successFeeCandidates);
  const tokenFeePerPlant =
    tokenAvg == null ? null : Math.round(tokenAvg);
  const successFeePct =
    successAvg == null ? null : Math.round(successAvg * 100) / 100;

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
  const successNote = successFeePct
    ? buildMultiFeeNote(
        "success fees",
        successFeeCandidates,
        successFeePct,
        (n) => `${n}%`,
      )
    : null;
  if (tokenNote) noteParts.push(tokenNote);
  if (successNote) noteParts.push(successNote);
  if (
    typeof data.summary === "string" &&
    data.summary.trim() &&
    noteParts.length === 0 &&
    (tokenFeeCandidates.length || successFeeCandidates.length)
  ) {
    // Keep AI summary only when we did not already write average notes
  } else if (
    typeof data.summary === "string" &&
    data.summary.trim() &&
    !tokenFeeCandidates.length &&
    !successFeeCandidates.length
  ) {
    noteParts.push(data.summary.trim());
  }

  if (
    !tokenFeeCandidates.length &&
    !successFeeCandidates.length &&
    !noteParts.length
  ) {
    noteParts.push("No clear token/success fee found in the uploaded agreement.");
  }

  return {
    tokenFeePerPlant,
    successFeePct,
    plantCount,
    tokenFeeCandidates,
    successFeeCandidates,
    notes: noteParts.length ? noteParts.join(" ") : null,
    rawExtract: raw.slice(0, 8000),
  };
}
