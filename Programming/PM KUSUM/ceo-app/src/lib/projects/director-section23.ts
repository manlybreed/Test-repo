import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

export type DirectorRow = {
  name?: string | null;
  designation?: string | null;
  dinOrPan?: string | null;
  dateOfBirth?: string | null;
  shareholdingPct?: string | null;
};

export type PromoterNetWorthRow = {
  name?: string | null;
  netWorth?: string | null;
  remarks?: string | null;
};

/** Section 2 + partial Section 3 (net worth / liquidity from Director KYC). */
export type Section23 = {
  directors: DirectorRow[];
  promotersNetWorth: PromoterNetWorthRow[];
  combinedNetWorth?: string | null;
  totalLiquidAssets?: string | null;
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
 * Prefer identity + net-worth docs; skip bulky bank statements / photos.
 * Cap count for tokens (nested per-director folders).
 */
export function selectDirectorKycDocs(scan: FolderScan, maxFiles = 12): ScannedDoc[] {
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

    picked.push(doc);
  }

  return picked;
}

const SECTION23_PROMPT = `You fill Section 2 (Directors / Promoters Profile) and PART of Section 3 (Equity / Net Worth) of the PM KUSUM Borrower Disclosure Form.

Documents are ONLY from the "Director KYC" folder (per-director PAN/Aadhaar, net-worth certificates, leadership/company profile, ITR/computation).

SECTION 2 — extract ALL directors / promoters:
- Full Name, Designation (Director / Managing Director / etc.), DIN or PAN, Date of Birth, Shareholding %.
- Prefer leadership / company profile + MCA-style lists for designation & shareholding.
- Prefer PAN / Aadhaar for DOB and PAN. Prefer DIN if shown.

SECTION 3 (partial only — do NOT invent USL / margin sources / EPC payments):
- promotersNetWorth: one row per promoter from Net Worth Certificate (name, net worth INR, remarks = CA cert no. / date if any).
- combinedNetWorth: sum if stated or clearly summable.
- totalLiquidAssets: liquid assets if stated on NW certificates (else null).
- Leave liquidityMet / liquidityShortfall / liquidityGapPlan null unless explicitly stated (margin money % needs DPR — usually unknown here).

Return ONLY JSON:
{
  "directors": [{"name":null,"designation":null,"dinOrPan":null,"dateOfBirth":null,"shareholdingPct":null}],
  "promotersNetWorth": [{"name":null,"netWorth":null,"remarks":null}],
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
- Amounts as written (Indian commas OK). Do not invent shareholding % or net worth.
- Date of Birth as DD/MM/YYYY or as on document.
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
  const { content: docBlocks, report } = await docsToAiContent(used, {
    kindHint: (d) => path.basename(d.absolutePath),
    maxCharsTotal: 140_000,
    maxBinaryBytesTotal: 5 * 1024 * 1024,
  });

  if (report.every((r) => r.mode === "skipped")) {
    throw new Error(
      "Could not read Directors KYC files (no usable text and files too large for vision).",
    );
  }

  await onProgress?.(60, "Extracting Section 2 & net worth (Section 3)…");
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
    combinedNetWorth,
    totalLiquidAssets,
    liquidityMet,
    liquidityShortfall,
    liquidityGapPlan,
  } = parsed;

  const result: Section23Result = {
    checkpoint: "director-section23",
    section23: {
      directors: Array.isArray(directors) ? directors : [],
      promotersNetWorth: Array.isArray(promotersNetWorth) ? promotersNetWorth : [],
      combinedNetWorth: combinedNetWorth ?? null,
      totalLiquidAssets: totalLiquidAssets ?? null,
      liquidityMet: liquidityMet ?? null,
      liquidityShortfall: liquidityShortfall ?? null,
      liquidityGapPlan: liquidityGapPlan ?? null,
    },
    documentsUsed: used.map((d) => d.relativePath),
    notes: notes ?? null,
    confidence: confidence ?? null,
  };

  await onProgress?.(90, "Section 2–3 extracted…");
  return { result, used };
}
