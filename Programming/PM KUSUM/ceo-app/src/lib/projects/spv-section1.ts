import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

/** Section 1 — Applicant / SPV Details (disclosure form). */
export type SpvSection1 = {
  applicantType?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  cin?: string | null;
  pan?: string | null;
  gstin?: string | null;
  udyam?: string | null;
  authorizedCapital?: string | null;
  paidUpCapital?: string | null;
  authorizedCapitalProposed?: string | null;
  paidUpCapitalProposed?: string | null;
  expensesIncurred?: string | null;
  registeredAddress?: string | null;
  operationalAddress?: string | null;
  state?: string | null;
  district?: string | null;
  pincode?: string | null;
  contactName?: string | null;
  contactDesignation?: string | null;
  mobilePrimary?: string | null;
  mobileAlternate?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  bankAccountType?: string | null;
};

export type SpvSection1Result = {
  checkpoint: "spv-section1";
  section1: SpvSection1;
  documentsUsed: string[];
  notes?: string | null;
  confidence?: number | null;
};

function scoreSpvDoc(doc: ScannedDoc): number {
  const n = `${doc.relativePath} ${path.basename(doc.absolutePath)}`.toLowerCase();
  if (/coi|incorporation|certificate\s*of\s*incorporation|mca/.test(n)) return 100;
  if (/\bpan\b|permanent\s*account/.test(n)) return 95;
  if (/gst|gstin|gst\s*reg/.test(n)) return 90;
  if (/moa|aoa|memorandum|articles/.test(n)) return 80;
  if (/bank|passbook|cancelled\s*cheque|account/.test(n)) return 70;
  if (/udyam|msme/.test(n)) return 65;
  if (/board|resolution|authorization/.test(n)) return 55;
  return 40;
}

/** Prefer key SPV identity docs from SPV KYC only (cap count for tokens). */
export function selectSpvKycDocs(scan: FolderScan, maxFiles = 8): ScannedDoc[] {
  const docs = scan.documents.filter((d) => d.category === "SPV KYC");
  if (!docs.length) return [];
  return [...docs]
    .sort((a, b) => scoreSpvDoc(b) - scoreSpvDoc(a) || a.size - b.size)
    .slice(0, maxFiles);
}

const SECTION1_PROMPT = `You fill Section 1 — Applicant / SPV Details of the PM KUSUM Borrower Disclosure Form.

Documents are ONLY from the "SPV KYC" folder (COI, PAN, GST, bank proofs, MOA/AOA, Udyam, etc.).

Extract fields EXACTLY as on official documents. Prefer COI / MCA for legal name, CIN, capital, registered address. Prefer GST certificate for GSTIN / address. Prefer PAN card for PAN. Prefer cancelled cheque / passbook for bank details.

Return ONLY JSON:
{
  "applicantType": "Private Ltd. | LLP | Partnership | Individual | Proprietorship | Other | null",
  "legalName": null,
  "tradeName": null,
  "cin": null,
  "pan": null,
  "gstin": null,
  "udyam": null,
  "authorizedCapital": null,
  "paidUpCapital": null,
  "authorizedCapitalProposed": null,
  "paidUpCapitalProposed": null,
  "expensesIncurred": null,
  "registeredAddress": null,
  "operationalAddress": null,
  "state": null,
  "district": null,
  "pincode": null,
  "contactName": null,
  "contactDesignation": null,
  "mobilePrimary": null,
  "mobileAlternate": null,
  "email": null,
  "whatsapp": null,
  "bankName": null,
  "bankBranch": null,
  "bankAccount": null,
  "bankIfsc": null,
  "bankAccountType": null,
  "notes": "short gaps / ambiguities",
  "confidence": 0.0
}

Rules:
- Uppercase PAN, GSTIN, CIN, IFSC when found.
- Amounts as written (Indian commas OK), without inventing proposed capital if not documented.
- If contact / bank not in SPV KYC, leave null — do not invent.
- Do not fill director details (Section 2).`;

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

export async function runSpvSection1Checkpoint(
  scan: FolderScan,
  onProgress?: ProgressFn,
): Promise<{ result: SpvSection1Result; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking in SPV KYC…");

  if (!scan.foldersPresent.includes("SPV KYC")) {
    throw new Error("SPV KYC folder not found in this plant pack.");
  }

  const used = selectSpvKycDocs(scan);
  if (!used.length) {
    throw new Error("SPV KYC folder has no readable PDF/image files.");
  }

  await onProgress?.(35, "Reading SPV KYC documents…");
  const { content: docBlocks, report } = await docsToAiContent(used, {
    kindHint: (d) => path.basename(d.absolutePath),
    maxCharsTotal: 120_000,
    maxBinaryBytesTotal: 6 * 1024 * 1024,
  });

  if (report.every((r) => r.mode === "skipped")) {
    throw new Error(
      "Could not read SPV KYC files (no usable text and files too large for vision).",
    );
  }

  await onProgress?.(60, "Extracting Section 1 (SPV details)…");
  const content = [
    {
      type: "text" as const,
      text: `${SECTION1_PROMPT}\n\nPlant folder: ${scan.root}\nFiles: ${report
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
      max_tokens: 4000,
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

  const parsed = parseJsonObject<SpvSection1 & { notes?: string; confidence?: number }>(
    text,
    "Section 1 SPV",
  );

  const {
    notes,
    confidence,
    ...section1
  } = parsed;

  const result: SpvSection1Result = {
    checkpoint: "spv-section1",
    section1,
    documentsUsed: used.map((d) => d.relativePath),
    notes: notes ?? null,
    confidence: confidence ?? null,
  };

  await onProgress?.(90, "Section 1 extracted…");
  return { result, used };
}
