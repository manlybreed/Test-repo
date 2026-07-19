import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";
import type { AttachDocsFn } from "./doc-cache";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

/** Mini extract from Plant KYC LOA + PPA only. */
export type PlantKycExtract = {
  loaNumber?: string | null;
  loaDate?: string | null;
  ppaNumber?: string | null;
  ppaDate?: string | null;
  /** PPA tariff (INR/kWh) — usually printed on LOA for PM KUSUM. */
  tariff?: string | null;
  /** PPA tenure in years — often on LOA (commonly 25–27 for KUSUM). */
  ppaTenureYears?: string | null;
  discom?: string | null;
};

export type PlantKycResult = {
  checkpoint: "plant-kyc";
  plantKyc: PlantKycExtract;
  documentsUsed: string[];
  askForDocuments: string[];
  notes?: string | null;
  confidence?: number | null;
};

function scorePlantDoc(doc: ScannedDoc): { kind: "loa" | "ppa" | "other"; score: number } {
  const n = `${doc.relativePath} ${path.basename(doc.absolutePath)}`.toLowerCase();
  if (/\bloa\b|letter\s*of\s*award/.test(n)) return { kind: "loa", score: 100 };
  if (/\bppa\b|power\s*purchase/.test(n)) return { kind: "ppa", score: 100 };
  return { kind: "other", score: 5 };
}

/** Best LOA + best PPA from Plant KYC (max 2 files). */
export function selectPlantKycLoaPpa(scan: FolderScan): {
  used: ScannedDoc[];
  askForDocuments: string[];
} {
  const docs = scan.documents.filter((d) => d.category === "Plant KYC");
  const askForDocuments: string[] = [];
  if (!docs.length) {
    return { used: [], askForDocuments: ["PLANT_LOA", "PLANT_PPA"] };
  }

  const ranked = docs
    .map((d) => ({ d, ...scorePlantDoc(d) }))
    .sort((a, b) => b.score - a.score || a.d.size - b.d.size);

  const used: ScannedDoc[] = [];
  const loa = ranked.find((x) => x.kind === "loa" && x.score >= 40);
  const ppa = ranked.find((x) => x.kind === "ppa" && x.score >= 40);
  if (loa) used.push(loa.d);
  else askForDocuments.push("PLANT_LOA");
  if (ppa) used.push(ppa.d);
  else askForDocuments.push("PLANT_PPA");

  return { used, askForDocuments };
}

const PLANT_KYC_PROMPT = `You extract LOA / PPA identifiers, tariff, and PPA tenure from Plant KYC documents.

You receive at most two files: Letter of Award (LOA) and/or Power Purchase Agreement (PPA).
Do NOT invent values. Leave null if absent.

Extract:
- loaNumber = LOA / Letter of Award reference number (as printed on the LOA — e.g. RRECL/…/LOA/…)
- loaDate (from LOA)
- ppaNumber, ppaDate (from PPA when present)
- tariff (INR/kWh) — PREFER THE LOA. PM KUSUM LOAs almost always state the discovered tariff / PPA tariff. Only use PPA if LOA has no tariff.
- ppaTenureYears — PREFER THE LOA (often 25 or 27 years for Component-A). Else from PPA term/tenure clause.
- discom / nodal agency if clearly stated

Return ONLY JSON:
{
  "loaNumber": null,
  "loaDate": null,
  "ppaNumber": null,
  "ppaDate": null,
  "tariff": null,
  "ppaTenureYears": null,
  "discom": null,
  "notes": "short gaps",
  "confidence": 0.0
}

Rules:
- loaNumber is mandatory when an LOA file is attached — copy the full reference / award number.
- Tariff as on LOA (e.g. "3.14" or "₹3.14/kWh") — do not invent.
- ppaTenureYears as a number of years only (e.g. "27"), not a date range.
- Prefer LOA for loaNumber, loaDate, tariff, ppaTenureYears. Prefer PPA only for ppaNumber/ppaDate (and tariff/tenure if LOA lacks them).
- Do not extract land khasras, directors, or DPR energy numbers.`;

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

export async function runPlantKycCheckpoint(
  scan: FolderScan,
  onProgress?: ProgressFn,
  attachDocs: AttachDocsFn = docsToAiContent,
): Promise<{ result: PlantKycResult; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking in Plant KYC for LOA / PPA…");

  if (!scan.foldersPresent.includes("Plant KYC")) {
    return {
      used: [],
      result: {
        checkpoint: "plant-kyc",
        plantKyc: {},
        documentsUsed: [],
        askForDocuments: ["PLANT_LOA", "PLANT_PPA"],
        notes: "Plant KYC folder not found.",
        confidence: 0,
      },
    };
  }

  const { used, askForDocuments } = selectPlantKycLoaPpa(scan);
  if (!used.length) {
    return {
      used: [],
      result: {
        checkpoint: "plant-kyc",
        plantKyc: {},
        documentsUsed: [],
        askForDocuments,
        notes: "Ask for LOA and/or PPA in Plant KYC.",
        confidence: 0,
      },
    };
  }

  await onProgress?.(35, "Reading LOA / PPA…");
  const { content: docBlocks, report } = await attachDocs(used, {
    kindHint: (d) => scorePlantDoc(d).kind,
    maxCharsTotal: 90_000,
    maxCharsPerDoc: 40_000,
    maxBinaryBytesTotal: 5 * 1024 * 1024,
  });

  if (report.every((r) => r.mode === "skipped")) {
    return {
      used,
      result: {
        checkpoint: "plant-kyc",
        plantKyc: {},
        documentsUsed: used.map((d) => d.relativePath),
        askForDocuments,
        notes: "Could not read LOA/PPA files.",
        confidence: 0,
      },
    };
  }

  await onProgress?.(60, "Extracting LOA / PPA / tariff…");
  const content = [
    {
      type: "text" as const,
      text: `${PLANT_KYC_PROMPT}\n\nPlant folder: ${scan.root}\nFiles: ${report
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
      max_tokens: 2000,
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

  const parsed = parseJsonObject<PlantKycExtract & { notes?: string; confidence?: number }>(
    text,
    "Plant KYC LOA/PPA",
  );

  const { notes, confidence, ...plantKyc } = parsed;

  const result: PlantKycResult = {
    checkpoint: "plant-kyc",
    plantKyc,
    documentsUsed: used.map((d) => d.relativePath),
    askForDocuments,
    notes: notes ?? null,
    confidence: confidence ?? null,
  };

  await onProgress?.(90, "Plant KYC extracted…");
  return { result, used };
}
