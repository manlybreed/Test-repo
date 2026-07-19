import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";
import type { AttachDocsFn } from "./doc-cache";
import type { LandKycCheckResult } from "./land-kyc-check";
import type { PlantKycExtract } from "./plant-kyc-extract";
import {
  computeFormV4Equity,
  formatInrAmount,
  parseInrAmount,
} from "./margin-liquidity";

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
  moduleEfficiencyLastYear?: string | null;
  minCuf?: string | null;
  annualDegradation?: string | null;
  yield25YearMwh?: string | null;
  pvsystAvailable?: string | null;
  moduleMakeModel?: string | null;
  inverterMakeModel?: string | null;
  transformerMakeType?: string | null;
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

export type Section4KnownFacts = {
  land?: LandKycCheckResult | null;
  plantKyc?: PlantKycExtract | null;
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

function formatKnownFacts(facts?: Section4KnownFacts | null): string {
  if (!facts) return "";
  const lines: string[] = [];
  const parcels = facts.land?.leasedParcels ?? [];
  if (parcels.length) {
    const p = parcels[0]!;
    lines.push(
      `Location (from Land KYC — prefer over DPR narrative when blank): village=${p.village ?? ""}, tehsil=${p.tehsil ?? ""}, district=${p.district ?? ""}, khasra=${parcels.map((x) => x.khasra).filter(Boolean).join(", ")}`,
    );
    const tenure = parcels.map((x) => x.leaseDuration).find(Boolean);
    if (tenure) lines.push(`Lease tenure (Land KYC): ${tenure}`);
  }
  const pk = facts.plantKyc;
  if (pk) {
    if (pk.loaNumber || pk.loaDate) {
      lines.push(`LOA reference (from LOA — use as loaRef): ${[pk.loaNumber, pk.loaDate].filter(Boolean).join(" dated ")}`);
    }
    if (pk.ppaNumber || pk.ppaDate) {
      lines.push(`PPA (Plant KYC): ${[pk.ppaNumber, pk.ppaDate].filter(Boolean).join(" / ")}`);
    }
    if (pk.tariff) lines.push(`PPA tariff from LOA (authoritative): ${pk.tariff}`);
    if (pk.ppaTenureYears) {
      lines.push(`PPA tenure from LOA (authoritative): ${pk.ppaTenureYears} years`);
    }
    if (pk.discom) lines.push(`DISCOM (Plant KYC): ${pk.discom}`);
  }
  if (!lines.length) return "";
  return `\nKNOWN FACTS from earlier checkpoints (do NOT re-extract these unless the field would otherwise be blank — fill blanks from known facts):\n- ${lines.join("\n- ")}\n`;
}

/** Merge land + plantKyc into Section 4 blanks (deterministic). */
export function applySection4KnownFacts(
  section4: Section4,
  facts?: Section4KnownFacts | null,
): Section4 {
  const out = { ...section4 };
  const asStr = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };
  const pick = (cur: unknown, next: unknown) => {
    const c = asStr(cur);
    if (c) return c;
    return asStr(next) ?? (typeof cur === "string" ? cur : null);
  };

  if (facts) {
    const parcels = facts.land?.leasedParcels ?? [];
    if (parcels.length) {
      const p = parcels[0]!;
      out.village = pick(out.village, p.village);
      out.tehsil = pick(out.tehsil, p.tehsil);
      out.district = pick(out.district, p.district);
      out.khasra = pick(
        out.khasra,
        parcels.map((x) => x.khasra).filter(Boolean).join(", "),
      );
      const tenure = parcels.map((x) => x.leaseDuration).find(Boolean);
      out.leaseTenure = pick(out.leaseTenure, tenure);
    }

    const pk = facts.plantKyc;
    if (pk) {
      // LOA is authoritative for ref no., tariff, and PPA tenure (Form + bank practice)
      const loaRef =
        pk.loaNumber && pk.loaDate
          ? `${pk.loaNumber} dated ${pk.loaDate}`
          : pk.loaNumber || null;
      if (loaRef) out.loaRef = loaRef;
      if (asStr(pk.tariff)) out.tariff = asStr(pk.tariff);
      if (asStr(pk.ppaTenureYears)) out.ppaTenureYears = asStr(pk.ppaTenureYears);
      out.ppaDate = pick(out.ppaDate, pk.ppaDate);
      out.discom = pick(out.discom, pk.discom);
    }
  }

  return applyFormV4Section4Financials(out);
}

/** Form v4: Margin = 30% of DPR; Loan ≈ 70% of DPR when blank. */
export function applyFormV4Section4Financials(section4: Section4): Section4 {
  const calc = computeFormV4Equity({
    dprProjectCost: section4.dprProjectCost,
    marginMoney: section4.marginMoney,
  });
  const out = { ...section4 };
  if (calc.dprProjectCost != null && !parseInrAmount(out.dprProjectCost)) {
    out.dprProjectCost = formatInrAmount(calc.dprProjectCost);
  }
  if (calc.marginMoney != null) {
    // Normalize to Form v4 Step 2 whenever we can derive it
    out.marginMoney = formatInrAmount(calc.marginMoney);
  }
  if (calc.loanAmountSuggested != null && !parseInrAmount(out.loanAmountRequested)) {
    out.loanAmountRequested = formatInrAmount(calc.loanAmountSuggested);
  }
  return out;
}

const SECTION4_PROMPT = `You fill Section 4 — PM KUSUM Plant / Project Information of the Borrower Disclosure Form.

Documents are from "DPR From EPC" (Detailed Project Report and/or PVsyst). Do NOT invent values.

Extract:
- Scheme: PM KUSUM Component (usually A), Panel Type, Land Ownership, lease tenure/lessor if stated
- Capacity AC MW / DC MWp, DISCOM / nodal agency
- PPA tariff / PPA tenure: leave null if already in knownFacts from LOA (do not invent from DPR)
- Tech: Module Technology, Inverter Type, Mounting Type
- Equipment make/model: moduleMakeModel, inverterMakeModel, transformerMakeType (from DPR BOM / specs)
- Energy (from DPR and/or PVsyst):
  - p90Generation = annual P90 (kWh/MWp/year) when stated
  - p50Generation = annual P50 (kWh/MWp/year) when stated
  - yield25YearMwh = **25-year P90 generation / 25-year total energy yield (MWh)** as given in the DPR (or PVsyst). This is cumulative over ~25 years at P90 — copy the DPR figure; do not invent by multiplying annual × 25 unless the DPR itself states that method.
  - minCuf (%), moduleEfficiencyY1 %, moduleEfficiencyLastYear %, annual degradation %, pvsystAvailable Yes/No
- Location: khasra, village, tehsil, district, state, GPS plant/GSS, distance to GSS km — only if not already in knownFacts
- Financials (Form v4 Equity Guide): Total Project Cost (DPR); Margin Money = 30% of DPR; Loan Amount typically 70% of DPR if not stated; expected COD / RRECL reg if in DPR. Leave loaRef / tariff / ppaDate blank when knownFacts already has them from LOA.
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
  "moduleMakeModel": null,
  "inverterMakeModel": null,
  "transformerMakeType": null,
  "p90Generation": null,
  "p50Generation": null,
  "minCuf": null,
  "moduleEfficiencyY1": null,
  "moduleEfficiencyLastYear": null,
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
- Prefer PVsyst/DPR tables for energy. Especially capture **25-year P90 generation (MWh)** into yield25YearMwh when the DPR states it.
- Amounts as written (Indian commas OK). Do not invent tariff or LOA number from the DPR when knownFacts already lists them from Plant KYC / LOA.
- Form v4: if marginMoney not stated but dprProjectCost is clear, set marginMoney = 30% of DPR. If loanAmountRequested blank, you may set it to 70% of DPR.
- If knownFacts already have LOA ref / tariff / PPA tenure / location, copy those into blanks — never overwrite a knownFact with a weaker DPR guess.
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
  attachDocs: AttachDocsFn = docsToAiContent,
  knownFacts?: Section4KnownFacts | null,
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
  const { content: docBlocks, report } = await attachDocs(used, {
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
      text: `${SECTION4_PROMPT}${formatKnownFacts(knownFacts)}\nPlant folder: ${scan.root}\nFiles: ${report
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

  const { notes, confidence, ...rawSection4 } = parsed;
  const coerced = Object.fromEntries(
    Object.entries(rawSection4).map(([k, v]) => [
      k,
      v == null || typeof v === "string" || typeof v === "boolean"
        ? v
        : typeof v === "number"
          ? String(v)
          : v,
    ]),
  ) as Section4;
  const section4 = applySection4KnownFacts(coerced, knownFacts);

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
