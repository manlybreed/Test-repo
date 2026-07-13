import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { selectDocsForAi, type ScannedDoc, type FolderScan } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";

export type LandParticulars = {
  khasra?: string | null;
  area?: string | null;
  village?: string | null;
  tehsil?: string | null;
  district?: string | null;
  state?: string | null;
  sourceNote?: string | null;
};

export type LandVerification = {
  ppa?: LandParticulars | null;
  jamabandi?: LandParticulars | null;
  leaseDeed?: LandParticulars | null;
  consensus?: LandParticulars | null;
  mismatches?: string[];
  leaseTypos?: string[];
  allMatch?: boolean;
  documentsUsed?: string[];
};

export type DisclosureExtract = {
  formDate?: string | null;
  fileReferenceNo?: string | null;
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
  directors?: Array<{
    name?: string | null;
    designation?: string | null;
    dinOrPan?: string | null;
    dateOfBirth?: string | null;
    shareholdingPct?: string | null;
  }>;
  dprProjectCost?: string | null;
  marginMoney?: string | null;
  minLiquidNetWorth?: string | null;
  uslAllowed?: string | null;
  promotersNetWorth?: Array<{
    name?: string | null;
    netWorth?: string | null;
    remarks?: string | null;
  }>;
  combinedNetWorth?: string | null;
  totalLiquidAssets?: string | null;
  liquidityMet?: string | null;
  liquidityShortfall?: string | null;
  liquidityGapPlan?: string | null;
  uslLenders?: Array<{
    name?: string | null;
    relationship?: string | null;
    amount?: string | null;
  }>;
  totalUsl?: string | null;
  marginSources?: Array<{
    source?: string | null;
    amount?: string | null;
    notes?: string | null;
  }>;
  epcPayments?: Array<{
    date?: string | null;
    amount?: string | null;
    mode?: string | null;
    fromAccount?: string | null;
    purpose?: string | null;
  }>;
  totalPaidToEpc?: string | null;
  epcContractValue?: string | null;
  epcPaidPct?: string | null;
  epcBalance?: string | null;
  plant?: {
    component?: string | null;
    capacityAcMw?: string | null;
    capacityDcMwp?: string | null;
    village?: string | null;
    tehsil?: string | null;
    district?: string | null;
    state?: string | null;
    khasra?: string | null;
    landAreaAcres?: string | null;
    landOwnership?: string | null;
    discom?: string | null;
    tariff?: string | null;
    loaPpaDetails?: string | null;
    plantCode?: string | null;
  };
  epc?: {
    legalName?: string | null;
    cin?: string | null;
    pan?: string | null;
    gstin?: string | null;
    address?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  };
  landVerification?: LandVerification | null;
  notes?: string | null;
  confidence?: number | null;
  documentsUsed?: string[];
};

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

const LAND_VERIFY_PROMPT = `You verify land particulars for a PM KUSUM solar plant finance file.

You are given documents that should include some or all of:
1) PPA (Power Purchase Agreement) — land schedule is usually on the LAST page(s) / annexure / schedule of land
2) Jamabandi / land record
3) Lease deed (registered lease)

For EACH source present, extract EXACTLY as written (do not correct spellings yet):
- khasra / survey numbers
- area (acres / hectare / bigha — keep unit)
- village / gram panchayat
- tehsil / block
- district
- state

Then:
- Compare PPA vs Jamabandi vs Lease Deed for khasra, area, village, tehsil, district, state.
- Flag ANY mismatch (including spelling variants like "Rampura" vs "Rampura Kalan", digit typos in khasra, area differences).
- Especially scrutinize the LEASE DEED for typos vs PPA/Jamabandi (village name spelling, tehsil spelling, khasra digits).
- Build a consensus object using the values that agree; if conflict, prefer PPA schedule + Jamabandi over lease for facts, but still list lease typos.

Return ONLY JSON:
{
  "ppa": {"khasra":null,"area":null,"village":null,"tehsil":null,"district":null,"state":null,"sourceNote":"e.g. last page schedule"},
  "jamabandi": {"khasra":null,"area":null,"village":null,"tehsil":null,"district":null,"state":null,"sourceNote":null},
  "leaseDeed": {"khasra":null,"area":null,"village":null,"tehsil":null,"district":null,"state":null,"sourceNote":null},
  "consensus": {"khasra":null,"area":null,"village":null,"tehsil":null,"district":null,"state":null},
  "mismatches": ["..."],
  "leaseTypos": ["Lease says X but PPA/Jamabandi say Y"],
  "allMatch": true
}`;

const EXTRACT_PROMPT = `You are filling a PM KUSUM Component-A Borrower Information & Financial Disclosure Form for Indian solar project finance.

You are given scanned KYC / project documents from a plant folder with categories such as:
SPV KYC, Director KYC, EPC KYC, DPR From EPC, Land KYC, Plant KYC, Invoices, Third Party Reports, Misc.

Extract EVERYTHING you can see that belongs on the form. Use INR amounts as plain numbers with Indian commas if visible. Do not invent values — use null when unknown.

IMPORTANT — Land particulars:
- Prefer the provided landVerification.consensus for village, tehsil, district, state, khasra, area when present.
- PPA land details are often on the LAST page — trust that schedule.
- Lease deed spellings must match PPA/Jamabandi; note typos in notes if any.

Return ONLY JSON (no markdown) matching this shape:
{
  "formDate": "YYYY-MM-DD or null",
  "fileReferenceNo": null,
  "applicantType": "Private Ltd. | LLP | Partnership | Individual | Other | null",
  "legalName": "SPV / applicant legal name",
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
  "directors": [{"name":"","designation":"","dinOrPan":"","dateOfBirth":"","shareholdingPct":""}],
  "dprProjectCost": null,
  "marginMoney": null,
  "minLiquidNetWorth": null,
  "uslAllowed": null,
  "promotersNetWorth": [{"name":"","netWorth":"","remarks":""}],
  "combinedNetWorth": null,
  "totalLiquidAssets": null,
  "liquidityMet": "Yes|No|null",
  "liquidityShortfall": null,
  "liquidityGapPlan": null,
  "uslLenders": [{"name":"","relationship":"","amount":""}],
  "totalUsl": null,
  "marginSources": [{"source":"","amount":"","notes":""}],
  "epcPayments": [{"date":"","amount":"","mode":"","fromAccount":"","purpose":""}],
  "totalPaidToEpc": null,
  "epcContractValue": null,
  "epcPaidPct": null,
  "epcBalance": null,
  "plant": {
    "component": "A",
    "capacityAcMw": null,
    "capacityDcMwp": null,
    "village": null,
    "tehsil": null,
    "district": null,
    "state": null,
    "khasra": null,
    "landAreaAcres": null,
    "landOwnership": null,
    "discom": null,
    "tariff": null,
    "loaPpaDetails": null,
    "plantCode": null
  },
  "epc": {
    "legalName": null,
    "cin": null,
    "pan": null,
    "gstin": null,
    "address": null,
    "contactName": null,
    "contactPhone": null,
    "contactEmail": null
  },
  "notes": "short extraction notes / land issues",
  "confidence": 0.0,
  "documentsUsed": ["relative paths used"]
}

Rules:
- Prefer COI / MCA / GST / PAN for SPV identity.
- Prefer director KYC for Section 2.
- Prefer DPR for project cost / capacity.
- Prefer EPC KYC / agreement for EPC profile and contract value.
- Prefer invoices / bank proofs for EPC payments already made.
- Uppercase PAN / GSTIN / CIN / IFSC when found.`;

function scoreLandDoc(doc: ScannedDoc): { kind: "ppa" | "jamabandi" | "lease" | "other"; score: number } {
  const n = `${doc.relativePath} ${path.basename(doc.absolutePath)}`.toLowerCase();
  if (/ppa|power\s*purchase|purchase\s*agreement/.test(n)) return { kind: "ppa", score: 100 };
  if (/jamabandi|jama\s*bandi|khatauni|khatoni|ror|land\s*record/.test(n))
    return { kind: "jamabandi", score: 90 };
  if (/lease|patta|registered\s*lease|lease\s*deed/.test(n)) return { kind: "lease", score: 90 };
  if (doc.category === "Land KYC" || doc.category === "Plant KYC") return { kind: "other", score: 40 };
  return { kind: "other", score: 0 };
}

/** Prefer PPA / jamabandi / lease deed — at most one strong doc per kind. */
export function selectLandVerificationDocs(
  documents: ScannedDoc[],
  maxFiles = 3,
): ScannedDoc[] {
  const ranked = [...documents]
    .map((d) => ({ d, ...scoreLandDoc(d) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.size - b.d.size);

  const picked: ScannedDoc[] = [];
  for (const kind of ["ppa", "jamabandi", "lease"] as const) {
    if (picked.length >= maxFiles) break;
    // Prefer smallest among top-scoring of this kind (text extract works; smaller is faster)
    const candidates = ranked.filter((x) => x.kind === kind).slice(0, 5);
    candidates.sort((a, b) => a.d.size - b.d.size);
    const hit = candidates[0];
    if (hit) picked.push(hit.d);
  }

  if (picked.length === 0) {
    for (const d of documents
      .filter((x) => x.category === "Land KYC" || x.category === "Plant KYC")
      .sort((a, b) => a.size - b.size)) {
      if (picked.length >= maxFiles) break;
      picked.push(d);
    }
  }
  return picked;
}

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

export async function verifyLandParticulars(
  scan: FolderScan,
  onProgress?: ProgressFn,
): Promise<{ verification: LandVerification; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(22, "Selecting PPA, jamabandi & lease deed…");
  const used = selectLandVerificationDocs(scan.documents);
  if (used.length === 0) {
    return {
      verification: {
        allMatch: false,
        mismatches: ["No PPA / jamabandi / lease deed documents found to verify land particulars."],
        leaseTypos: [],
        documentsUsed: [],
      },
      used: [],
    };
  }

  await onProgress?.(35, "Verifying khasra, area, village, tehsil across land docs…");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { content: docBlocks, report } = await docsToAiContent(used, {
    kindHint: (d) => scoreLandDoc(d).kind,
    maxCharsTotal: 90_000,
    maxBinaryBytesTotal: 1.2 * 1024 * 1024,
  });
  const attached = report.filter((r) => r.mode !== "skipped");
  if (attached.length === 0) {
    return {
      verification: {
        allMatch: false,
        mismatches: [
          "Could not read PPA / jamabandi / lease as text, and files were too large to upload. Prefer text-based PDFs or smaller scans.",
        ],
        leaseTypos: [],
        documentsUsed: used.map((d) => d.relativePath),
      },
      used,
    };
  }

  const content = [
    {
      type: "text" as const,
      text: `${LAND_VERIFY_PROMPT}\n\nPlant folder: ${scan.root}\nAttach modes: ${report
        .map((r) => `${path.basename(r.doc.absolutePath)}=${r.mode}${r.chars ? `(${r.chars}c)` : ""}`)
        .join(", ")}\nFor PPA text, the closing / land-schedule portion is included — compare khasra, area, village, tehsil carefully.\n`,
    },
    ...docBlocks,
  ];

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

  const verification = parseJsonObject<LandVerification>(text, "land verification");
  verification.documentsUsed = used.map((d) => d.relativePath);
  if (!verification.mismatches) verification.mismatches = [];
  if (!verification.leaseTypos) verification.leaseTypos = [];
  if (typeof verification.allMatch !== "boolean") {
    verification.allMatch =
      verification.mismatches.length === 0 && verification.leaseTypos.length === 0;
  }
  return { verification, used };
}

export async function extractDisclosureFromScan(
  scan: FolderScan,
  onProgress?: ProgressFn,
): Promise<{ extract: DisclosureExtract; used: ScannedDoc[]; landUsed: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(15, "Scanning plant folder…");
  const { verification, used: landUsed } = await verifyLandParticulars(scan, onProgress);

  await onProgress?.(55, "Extracting SPV / directors / EPC / financials…");
  // Exclude land docs already verified to avoid duplicate bulk in the second pass
  const landPaths = new Set(landUsed.map((d) => d.absolutePath));
  const pool = scan.documents.filter((d) => !landPaths.has(d.absolutePath));
  const used = selectDocsForAi(pool.length ? pool : scan.documents, 8, 40 * 1024 * 1024);
  if (used.length === 0) {
    throw new Error(
      "No PDF/image documents found in the plant folder. Download iCloud files locally and retry.",
    );
  }

  await onProgress?.(60, "Extracting text from KYC / DPR packs…");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { content: docBlocks, report } = await docsToAiContent(used, {
    kindHint: (d) => scoreLandDoc(d).kind,
    maxCharsTotal: 160_000,
    maxBinaryBytesTotal: 2 * 1024 * 1024,
  });
  if (report.every((r) => r.mode === "skipped")) {
    throw new Error(
      "Could not extract usable text from selected documents, and files were too large to upload raw. Check that PDFs are not iCloud placeholders / empty scans.",
    );
  }

  const content = [
    {
      type: "text" as const,
      text: `${EXTRACT_PROMPT}\n\nPlant folder: ${scan.root}\nFolders present: ${scan.foldersPresent.join(", ") || "(none)"}\nFolders missing: ${scan.foldersMissing.join(", ") || "(none)"}\nAttach modes: ${report
        .map((r) => `${path.basename(r.doc.absolutePath)}=${r.mode}`)
        .join(", ")}\n\nPre-verified land particulars (use consensus for form fields):\n${JSON.stringify(verification, null, 2)}\n`,
    },
    ...docBlocks,
  ];

  let msg;
  try {
    await onProgress?.(68, "Asking AI to fill disclosure fields…");
    msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
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

  const extract = parseJsonObject<DisclosureExtract>(text, "disclosure form");
  extract.landVerification = verification;
  extract.documentsUsed = [
    ...new Set([...(extract.documentsUsed ?? []), ...used.map((d) => d.relativePath)]),
  ];

  // Prefer consensus land fields on plant
  const c = verification.consensus;
  if (c) {
    extract.plant = {
      ...(extract.plant ?? {}),
      village: extract.plant?.village || c.village,
      tehsil: extract.plant?.tehsil || c.tehsil,
      district: extract.plant?.district || c.district,
      state: extract.plant?.state || c.state,
      khasra: extract.plant?.khasra || c.khasra,
      landAreaAcres: extract.plant?.landAreaAcres || c.area,
    };
  }

  const landNotes: string[] = [];
  if (verification.mismatches?.length) {
    landNotes.push(`Land mismatches: ${verification.mismatches.join("; ")}`);
  }
  if (verification.leaseTypos?.length) {
    landNotes.push(`Lease deed typos: ${verification.leaseTypos.join("; ")}`);
  }
  if (landNotes.length) {
    extract.notes = [extract.notes, ...landNotes].filter(Boolean).join(" | ");
  }

  await onProgress?.(78, "Land check complete — preparing disclosure form…");
  return { extract, used, landUsed };
}
