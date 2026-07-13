import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

/** Section 4 — PM KUSUM Plant / Project Information (from DPR / PVsyst). */
export type Section4 = {
  component?: string | null;
  panelType?: string | null;
  landOwnership?: string | null;
  leaseTenure?: string | null;
  lessorName?: string | null;
  capacityAcMw?: string | null;
  capacityDcMwp?: string | null;
  discom?: string | null;
  tariff?: string | null;
  ppaTenureYears?: string | null;
  capacityAcDcLabel?: string | null;
  moduleTechnology?: string | null;
  inverterType?: string | null;
  mountingType?: string | null;
  p90Generation?: string | null;
  p50Generation?: string | null;
  moduleEfficiencyY1?: string | null;
  annualDegradation?: string | null;
  yield25YearMwh?: string | null;
  pvsystAvailable?: string | null;
  khasra?: string | null;
  village?: string | null;
  tehsil?: string | null;
  district?: string | null;
  state?: string | null;
  gpsPlant?: string | null;
  gpsGss?: string | null;
  distanceGssKm?: string | null;
  dprProjectCost?: string | null;
  loanAmountRequested?: string | null;
  marginMoney?: string | null;
  loaRef?: string | null;
  ppaDate?: string | null;
  rreclRegNo?: string | null;
  expectedCod?: string | null;
  siteCompletionPct?: string | null;
  workDoneBrief?: string | null;
};

export type Section4Result = {
  checkpoint: "dpr-section4";
  section4: Section4;
  documentsUsed: string[];
  notes?: string | null;
  confidence?: number | null;
};

function scoreDprDoc(doc: ScannedDoc): number {
  // Filename only — folder name always contains "DPR"
  const n = path.basename(doc.absolutePath).toLowerCase();
  if (/\bdpr\b|detailed\s*project\s*report/.test(n)) return 100;
  if (/pvsyst|pv\s*syst/.test(n)) return 90;
  if (/techno|feasibility|tfr/.test(n)) return 70;
  if (/epc\s*agreement|epc\s*contract/.test(n)) return 20; // skip by default
  return 40;
}

/** Prefer DPR + PVsyst; skip huge EPC agreements. */
export function selectDprDocs(scan: FolderScan, maxFiles = 3): ScannedDoc[] {
  const docs = scan.documents.filter((d) => d.category === "DPR From EPC");
  if (!docs.length) return [];
  return [...docs]
    .filter((d) => scoreDprDoc(d) >= 70)
    .sort((a, b) => scoreDprDoc(b) - scoreDprDoc(a) || a.size - b.size)
    .slice(0, maxFiles);
}

const SECTION4_PROMPT = `You fill Section 4 — PM KUSUM Plant / Project Information of the Borrower Disclosure Form.

Documents are from "DPR From EPC" (Detailed Project Report and/or PVsyst). Do NOT invent values.

Extract:
- Scheme: PM KUSUM Component (usually A), Panel Type, Land Ownership, lease tenure/lessor if stated
- Capacity AC MW / DC MWp, DISCOM / nodal agency, PPA tariff (INR/kWh), PPA tenure years
- Tech: Module Technology, Inverter Type, Mounting Type
- Energy (from PVsyst / DPR): P90, P50 (kWh/MWp/year), module efficiency Y1 %, annual degradation %, 25-year yield MWh, whether PVsyst report is available (Yes/No)
- Location: khasra, village, tehsil, district, state, GPS plant/GSS, distance to GSS km
- Financials: Total Project Cost (DPR), loan amount if stated, 30% margin money if stated or compute as 30% of DPR when cost is clear, LOA ref, PPA date, RRECL/SNA reg no, expected COD
- Site: completion % and brief work done if mentioned (else null)

Return ONLY JSON:
{
  "component": "A",
  "panelType": null,
  "landOwnership": null,
  "leaseTenure": null,
  "lessorName": null,
  "capacityAcMw": null,
  "capacityDcMwp": null,
  "discom": null,
  "tariff": null,
  "ppaTenureYears": null,
  "moduleTechnology": null,
  "inverterType": null,
  "mountingType": null,
  "p90Generation": null,
  "p50Generation": null,
  "moduleEfficiencyY1": null,
  "annualDegradation": null,
  "yield25YearMwh": null,
  "pvsystAvailable": "Yes|No|null",
  "khasra": null,
  "village": null,
  "tehsil": null,
  "district": null,
  "state": null,
  "gpsPlant": null,
  "gpsGss": null,
  "distanceGssKm": null,
  "dprProjectCost": null,
  "loanAmountRequested": null,
  "marginMoney": null,
  "loaRef": null,
  "ppaDate": null,
  "rreclRegNo": null,
  "expectedCod": null,
  "siteCompletionPct": null,
  "workDoneBrief": null,
  "notes": "short gaps",
  "confidence": 0.0
}

Rules:
- Prefer DPR for cost / capacity / location; PVsyst for generation numbers.
- Amounts as written (Indian commas OK). Tariff as number without inventing.
- If marginMoney not stated but dprProjectCost is clear, set marginMoney to 30% of that cost.
- Do not fill directors (Section 2) or SPV identity (Section 1).`;

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

export async function runDprSection4Checkpoint(
  scan: FolderScan,
  onProgress?: ProgressFn,
): Promise<{ result: Section4Result; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking in DPR From EPC…");

  if (!scan.foldersPresent.includes("DPR From EPC")) {
    throw new Error("DPR From EPC folder not found in this plant pack.");
  }

  const used = selectDprDocs(scan);
  if (!used.length) {
    throw new Error("DPR From EPC has no DPR/PVsyst PDF (EPC agreement alone is skipped).");
  }

  await onProgress?.(35, "Reading DPR / PVsyst…");
  const { content: docBlocks, report } = await docsToAiContent(used, {
    kindHint: (d) => {
      const n = path.basename(d.absolutePath);
      if (/pvsyst/i.test(n)) return `pvsyst ${n}`;
      return `dpr ${n}`;
    },
    maxCharsTotal: 160_000,
    maxCharsPerDoc: 70_000,
    maxBinaryBytesTotal: 6 * 1024 * 1024,
  });

  if (report.every((r) => r.mode === "skipped")) {
    throw new Error(
      "Could not read DPR/PVsyst (no usable text and files too large for vision).",
    );
  }

  await onProgress?.(60, "Extracting Section 4 (plant / project)…");
  const content = [
    {
      type: "text" as const,
      text: `${SECTION4_PROMPT}\n\nPlant folder: ${scan.root}\nFiles: ${report
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

  const parsed = parseJsonObject<Section4 & { notes?: string; confidence?: number }>(
    text,
    "Section 4 DPR",
  );

  const { notes, confidence, ...section4 } = parsed;

  const result: Section4Result = {
    checkpoint: "dpr-section4",
    section4,
    documentsUsed: used.map((d) => d.relativePath),
    notes: notes ?? null,
    confidence: confidence ?? null,
  };

  await onProgress?.(90, "Section 4 extracted…");
  return { result, used };
}
