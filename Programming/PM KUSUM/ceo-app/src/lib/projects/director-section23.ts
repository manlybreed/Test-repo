import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";
import type { AttachDocsFn } from "./doc-cache";
import {
  applyFormV4LiquidityToSection23,
} from "./margin-liquidity";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

export type DirectorRow = {
  name?: string | null;
  designation?: string | null;
  dinOrPan?: string | null;
  dateOfBirth?: string | null;
  shareholdingPct?: string | null;
  /** CIBIL score when a credit report is present for this director. */
  cibilScore?: string | number | null;
  /** Whether a CIBIL / credit-score PDF was found for this director. */
  cibilDocumentFound?: boolean | null;
  /** Name as printed on the CIBIL / credit report. */
  cibilNameOnDocument?: string | null;
  /** Whether cibilNameOnDocument matches this director's name. */
  cibilNameMatches?: boolean | null;
};

export type PromoterNetWorthRow = {
  name?: string | null;
  netWorth?: string | null;
  remarks?: string | null;
};

/** Liquid items from NW certificate (Form v4 §3.2) — sum even without a labeled subtotal. */
export type PromoterLiquidRow = {
  name?: string | null;
  bankBalance?: string | null;
  cash?: string | null;
  fd?: string | null;
  sharesMf?: string | null;
  gold?: string | null;
  receivables90d?: string | null;
  otherLiquid?: string | null;
  /** Per-promoter sum of liquid items above (if stated or computed). */
  totalLiquid?: string | null;
};

/** Section 2 + Section 3 (net worth / liquidity per Form v4). */
export type Section23 = {
  directors: DirectorRow[];
  promotersNetWorth: PromoterNetWorthRow[];
  /** Per-promoter liquid breakdown from NW certificates. */
  promotersLiquidAssets?: PromoterLiquidRow[];
  combinedNetWorth?: string | null;
  totalLiquidAssets?: string | null;
  /** Form v4 Step 3 — 50% of margin money (filled when DPR known). */
  minLiquidityRequired?: string | null;
  /** Form v4 Step 4 — max USL = 70% of margin. */
  maxUslAllowed?: string | null;
  /** Form v4 Step 2 reference when DPR/margin known. */
  marginMoneyRequired?: string | null;
  liquidityMet?: string | null;
  liquidityShortfall?: string | null;
  liquidityGapPlan?: string | null;
};

export type Section23Result = {
  checkpoint: "director-section23";
  section23: Section23;
  documentsUsed: string[];
  notes?: string | null;
  confidence?: number | null;
};

function scoreDirectorDoc(doc: ScannedDoc): number {
  const n = `${doc.relativePath} ${path.basename(doc.absolutePath)}`.toLowerCase();
  if (/leadership|company\s*profile|directors?\s*list|shareholding/.test(n)) return 100;
  if (/cibil|credit\s*score|credit\s*report/.test(n)) return 98;
  if (/net\s*worth|networth/.test(n)) return 95;
  if (/\bpan\b|permanent\s*account/.test(n)) return 90;
  if (/aadhaar|aadhar|adhar/.test(n)) return 85;
  if (/din\s*card|director\s*identification/.test(n)) return 80;
  if (/computation/.test(n)) return 55;
  if (/\bitr\b|income\s*tax/.test(n)) return 45;
  if (/bank\s*statement|passbook/.test(n)) return 25;
  if (/photo|passport\s*size/.test(n)) return 5;
  return 40;
}

/**
 * Prefer identity + net-worth + CIBIL docs; skip bulky bank statements / photos.
 * Cap count for tokens (nested per-director folders).
 */
export function selectDirectorKycDocs(scan: FolderScan, maxFiles = 14): ScannedDoc[] {
  const docs = scan.documents.filter(
    (d) => d.category === "Directors KYC" || d.category === "Director KYC",
  );
  if (!docs.length) return [];

  const ranked = [...docs].sort(
    (a, b) => scoreDirectorDoc(b) - scoreDirectorDoc(a) || a.size - b.size,
  );

  const picked: ScannedDoc[] = [];
  const seenKey = new Set<string>();

  for (const doc of ranked) {
    if (picked.length >= maxFiles) break;
    const score = scoreDirectorDoc(doc);
    if (score < 40) continue; // drop photos / weak matches
    if (score <= 25) continue; // bank statements

    // At most one ITR and one computation per person folder
    const base = path.basename(doc.absolutePath).toLowerCase();
    const folder = path.dirname(doc.relativePath);
    if (/\bitr\b|income\s*tax/.test(base)) {
      const key = `itr:${folder}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
    }
    if (/computation/.test(base)) {
      const key = `comp:${folder}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
    }
    if (/cibil|credit\s*score|credit\s*report/.test(base)) {
      const key = `cibil:${folder}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
    }

    picked.push(doc);
  }

  return picked;
}

const SECTION23_PROMPT = `You fill Section 2 (Directors / Promoters Profile) and PART of Section 3 (Equity / Net Worth) of the PM KUSUM Borrower Disclosure Form.

Documents are ONLY from the "Director KYC" folder (per-director PAN/Aadhaar, net-worth certificates, leadership/company profile, ITR/computation, CIBIL / credit score reports).

SECTION 2 — extract ALL directors / promoters:
- Full Name, Designation (Director / Managing Director / etc.), DIN or PAN, Date of Birth, Shareholding %.
- Prefer leadership / company profile + MCA-style lists for designation & shareholding.
- Prefer PAN / Aadhaar for DOB and PAN. Prefer DIN if shown.
- CIBIL: for each director, set cibilDocumentFound=true if a CIBIL/credit report for that person is among the files; extract cibilScore (integer) when visible. Also extract cibilNameOnDocument = the person's name as printed ON THE CIBIL report, and set cibilNameMatches=true only if that name clearly refers to the same director (same person). If the CIBIL name is a different person or unreadable, cibilNameMatches=false. If no CIBIL file for that director, cibilDocumentFound=false, cibilScore=null, cibilNameOnDocument=null, cibilNameMatches=null.

SECTION 3 (Net Worth + Liquidity — Form v4 §3.1 / §3.2):
Form v4 Equity Guide:
  Margin Money = 30% of DPR; Min Liquidity Required = 50% of Margin; USL max = 70% of Margin.
  Liquid assets = savings bank balance + FDs + listed shares/MF + gold (certified) + receivables due within 90 days (+ cash on NW cert).

- promotersNetWorth: one row per promoter from Net Worth Certificate (name, net worth INR, remarks = CA cert no. / date if any).
- combinedNetWorth: sum of promoter net worths if stated or clearly summable.
- promotersLiquidAssets: ONE row per promoter. Extract EVERY liquid line item visible on that promoter's NW certificate / computation:
  bankBalance, cash, fd (FDs/RDs), sharesMf, gold, receivables90d, otherLiquid.
  Set totalLiquid = sum of that promoter's liquid line items (ALWAYS compute the sum yourself — do NOT leave null just because the certificate lacks a line labeled "Total Liquid Assets").
- totalLiquidAssets: MUST be the SUM of all promoters' totalLiquid (or sum of all liquid line items across promoters).
  Form v4 requires this figure for "Is Minimum Liquidity Met?". Never leave it null when bank/cash/FD amounts are visible on the certificates.
- Leave liquidityMet / liquidityShortfall / liquidityGapPlan null (computed later once DPR margin is known).

Return ONLY JSON:
{
  "directors": [{"name":null,"designation":null,"dinOrPan":null,"dateOfBirth":null,"shareholdingPct":null,"cibilScore":null,"cibilDocumentFound":false,"cibilNameOnDocument":null,"cibilNameMatches":null}],
  "promotersNetWorth": [{"name":null,"netWorth":null,"remarks":null}],
  "promotersLiquidAssets": [{"name":null,"bankBalance":null,"cash":null,"fd":null,"sharesMf":null,"gold":null,"receivables90d":null,"otherLiquid":null,"totalLiquid":null}],
  "combinedNetWorth": null,
  "totalLiquidAssets": null,
  "liquidityMet": null,
  "liquidityShortfall": null,
  "liquidityGapPlan": null,
  "notes": "short gaps",
  "confidence": 0.0
}

Rules:
- Uppercase PAN; keep DIN as digits.
- Amounts as written (Indian commas / Lac / Rs OK). Do not invent shareholding % or net worth.
- CRITICAL: If NW cert shows Bank Balance 7.50 Lac and Cash 1.25 Lac, those ARE liquid assets — sum them. Do not refuse to fill totalLiquidAssets merely because there is no heading "Total Liquid".
- Do NOT use full net worth (land, business capital, etc.) as totalLiquidAssets — only the liquid line items above.
- Date of Birth as DD/MM/YYYY or as on document.
- Do not invent CIBIL scores. Map each CIBIL PDF to the correct director by folder/name AND verify the name printed on the CIBIL matches that director.
- Do not fill SPV Section 1 or plant Section 4.`;

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

export async function runDirectorSection23Checkpoint(
  scan: FolderScan,
  onProgress?: ProgressFn,
  attachDocs: AttachDocsFn = docsToAiContent,
): Promise<{ result: Section23Result; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking in Directors KYC…");

  if (
    !scan.foldersPresent.includes("Directors KYC") &&
    !scan.foldersPresent.includes("Director KYC")
  ) {
    throw new Error("Directors KYC folder not found in this plant pack.");
  }

  const used = selectDirectorKycDocs(scan);
  if (!used.length) {
    throw new Error("Directors KYC folder has no usable PDF/image files.");
  }

  await onProgress?.(35, "Reading Directors KYC documents…");
  const { content: docBlocks, report } = await attachDocs(used, {
    kindHint: (d) => path.basename(d.absolutePath),
    maxCharsTotal: 140_000,
    maxBinaryBytesTotal: 5 * 1024 * 1024,
  });

  if (report.every((r) => r.mode === "skipped")) {
    throw new Error(
      "Could not read Directors KYC files (no usable text and files too large for vision).",
    );
  }

  await onProgress?.(60, "Extracting Section 2–3 + CIBIL…");
  const content = [
    {
      type: "text" as const,
      text: `${SECTION23_PROMPT}\n\nPlant folder: ${scan.root}\nFiles: ${report
        .map((r) => `${r.doc.relativePath}=${r.mode}`)
        .join("; ")}\n`,
    },
    ...docBlocks,
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let msg;
  try {
    msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 5000,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw new Error(formatAnthropicError(err));
  }

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const parsed = parseJsonObject<
    Section23 & { notes?: string; confidence?: number }
  >(text, "Section 2–3 Directors");

  const {
    notes,
    confidence,
    directors = [],
    promotersNetWorth = [],
    promotersLiquidAssets = [],
    combinedNetWorth,
    totalLiquidAssets,
    liquidityMet,
    liquidityShortfall,
    liquidityGapPlan,
  } = parsed;

  let section23: Section23 = {
    directors: Array.isArray(directors) ? directors : [],
    promotersNetWorth: Array.isArray(promotersNetWorth) ? promotersNetWorth : [],
    promotersLiquidAssets: Array.isArray(promotersLiquidAssets)
      ? promotersLiquidAssets
      : [],
    combinedNetWorth: combinedNetWorth ?? null,
    totalLiquidAssets: totalLiquidAssets ?? null,
    liquidityMet: liquidityMet ?? null,
    liquidityShortfall: liquidityShortfall ?? null,
    liquidityGapPlan: liquidityGapPlan ?? null,
  };

  // Deterministic Form v4 liquid sum (bank + cash + FD + …) even if AI left total null
  section23 = applyFormV4LiquidityToSection23(
    section23,
    null,
    notes ?? null,
  ) as Section23;

  const result: Section23Result = {
    checkpoint: "director-section23",
    section23,
    documentsUsed: used.map((d) => d.relativePath),
    notes: notes ?? null,
    confidence: confidence ?? null,
  };

  await onProgress?.(90, "Section 2–3 extracted…");
  return { result, used };
}
