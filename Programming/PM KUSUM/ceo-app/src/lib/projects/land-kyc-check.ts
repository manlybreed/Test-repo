import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";
import type { AttachDocsFn } from "./doc-cache";

export type ProgressFn = (pct: number, step: string) => void | Promise<void>;

/** One leased khasra parcel as written in a source document. */
export type LandParcel = {
  khasra?: string | null;
  area?: string | null;
  village?: string | null;
  tehsil?: string | null;
  district?: string | null;
  /** Lease tenure e.g. "29 years", "01/04/2024 to 31/03/2053" — mainly from lease deed / PPA */
  leaseDuration?: string | null;
};

export type LandSourceExtract = {
  found: boolean;
  file?: string | null;
  parcels: LandParcel[];
  notes?: string | null;
};

export type LandKycCheckResult = {
  /** Checkpoint 1 — Land KYC only */
  checkpoint: "land-kyc";
  ppa: LandSourceExtract;
  jamabandi: LandSourceExtract;
  leaseDeed: LandSourceExtract;
  /** Merged list of khasras taken on lease (prefer lease deed + PPA agreement) */
  leasedParcels: LandParcel[];
  mismatches: string[];
  leaseTypos: string[];
  allMatch: boolean;
  documentsUsed: string[];
  /** Catalog codes to request when key Land KYC docs are missing. */
  askForDocuments?: string[];
};

function scoreLandDoc(doc: ScannedDoc): {
  kind: "ppa" | "jamabandi" | "lease" | "other";
  score: number;
} {
  const n = `${doc.relativePath} ${path.basename(doc.absolutePath)}`.toLowerCase();
  if (/ppa|power\s*purchase|purchase\s*agreement/.test(n)) return { kind: "ppa", score: 100 };
  if (/jamabandi|jama\s*bandi|khatauni|khatoni|ror|land\s*record/.test(n))
    return { kind: "jamabandi", score: 95 };
  if (/lease|patta|registered\s*lease|lease\s*deed/.test(n)) return { kind: "lease", score: 95 };
  return { kind: "other", score: 10 };
}

function pickBestByKind(
  docs: ScannedDoc[],
  kind: "ppa" | "jamabandi" | "lease",
): ScannedDoc | null {
  const ranked = docs
    .map((d) => ({ d, ...scoreLandDoc(d) }))
    .filter((x) => x.kind === kind && x.score >= 40)
    .sort((a, b) => b.score - a.score || a.d.size - b.d.size);
  return ranked[0]?.d ?? null;
}

/**
 * Land verification docs: jamabandi + lease from Land KYC;
 * PPA from Land KYC first, else Plant KYC (where LOA/PPA usually live).
 */
export function selectLandKycDocs(scan: FolderScan): {
  used: ScannedDoc[];
  askForDocuments: string[];
} {
  const landDocs = scan.documents.filter((d) => d.category === "Land KYC");
  const plantDocs = scan.documents.filter((d) => d.category === "Plant KYC");
  const askForDocuments: string[] = [];

  if (landDocs.length === 0 && plantDocs.length === 0) {
    return {
      used: [],
      askForDocuments: ["LAND_JAMABANDI", "LAND_LEASE", "PLANT_PPA"],
    };
  }

  const picked: ScannedDoc[] = [];
  const seen = new Set<string>();
  const push = (doc: ScannedDoc | null) => {
    if (!doc || seen.has(doc.absolutePath)) return;
    seen.add(doc.absolutePath);
    picked.push(doc);
  };

  const jamabandi = pickBestByKind(landDocs, "jamabandi");
  const lease = pickBestByKind(landDocs, "lease");
  // PPA land schedule: prefer Land KYC copy, else Plant KYC (standard Solarseed layout)
  const ppa =
    pickBestByKind(landDocs, "ppa") || pickBestByKind(plantDocs, "ppa");

  push(ppa);
  push(lease);
  push(jamabandi);

  if (!jamabandi) askForDocuments.push("LAND_JAMABANDI");
  if (!lease) askForDocuments.push("LAND_LEASE");
  if (!ppa) askForDocuments.push("PLANT_PPA");

  // Filename fallback: up to 3 Land KYC files if nothing keyword-matched
  if (picked.length === 0 && landDocs.length > 0) {
    return {
      used: [...landDocs].sort((a, b) => a.size - b.size).slice(0, 3),
      askForDocuments: ["LAND_JAMABANDI", "LAND_LEASE", "PLANT_PPA"],
    };
  }
  return { used: picked, askForDocuments };
}

const LAND_KYC_PROMPT = `You are Checkpoint 1 for a PM KUSUM plant file: LAND KYC verification.

You may receive documents from Land KYC and/or Plant KYC:
1) PPA (Power Purchase Agreement) — often stored under Plant KYC. The land / khasra schedule is almost always on the LAST page(s) or closing annexure. Focus there. If a PPA file is attached, set ppa.found=true — do NOT say "PPA not provided".
2) Lease deed — registered lease of project land (lists khasras taken on lease + tenure). Schedules may be mid/end of a long deed — use whatever schedule pages are attached.
3) Jamabandi / land records — ownership / khasra / area / village / tehsil / district.

Task:
- Identify khasra / survey numbers that are TAKEN ON LEASE for the project (not every random khasra in the village).
- For EACH such khasra, extract:
  - khasra (exact digits/letters as written)
  - corresponding area — if only PART of the khasra is leased (e.g. tippani says 2.26 ha out of 4.48 ha), use the LEASED area, not the full khasra area
  - village
  - tehsil (read Hindi carefully — किशनगंज = Kishanganj, NOT Kishangarh)
  - district
  - leaseDuration (years and/or from–to dates). Prefer lease deed; jamabandi tippani / PPA may also state tenure.

IMPORTANT for jamabandi:
- Read the visual page / tippani column. Do NOT trust a broken Unicode text layer.
- Partial lease of a khasra is common — extract the leased raiyati area from tippani.

Per source (ppa / jamabandi / leaseDeed), list parcels found in THAT document exactly as written (do not "fix" spellings yet).

Then:
- Build leasedParcels = the set of leased khasras with best consensus values.
- Flag mismatches across PPA last page vs jamabandi vs lease deed (khasra digits, area, village spelling, tehsil spelling, district).
- Flag lease deed typos vs PPA/Jamabandi (character-level spelling / digit errors).

Return ONLY JSON:
{
  "ppa": {
    "found": true,
    "file": "relative path or null",
    "parcels": [{"khasra":"","area":"","village":"","tehsil":"","district":"","leaseDuration":""}],
    "notes": "e.g. taken from last page schedule"
  },
  "jamabandi": {
    "found": true,
    "file": null,
    "parcels": [{"khasra":"","area":"","village":"","tehsil":"","district":"","leaseDuration":null}],
    "notes": null
  },
  "leaseDeed": {
    "found": true,
    "file": null,
    "parcels": [{"khasra":"","area":"","village":"","tehsil":"","district":"","leaseDuration":""}],
    "notes": null
  },
  "leasedParcels": [{"khasra":"","area":"","village":"","tehsil":"","district":"","leaseDuration":""}],
  "mismatches": ["..."],
  "leaseTypos": ["Lease says X but PPA/Jamabandi say Y"],
  "allMatch": true
}

Rules:
- Do not invent khasras. If a source is missing, found=false and parcels=[].
- Prefer exact transcription from the lease deed for spellings; still report typos if lease differs from PPA/Jamabandi.
- If multiple khasras are leased, list each as its own parcel row.
- leaseDuration is required when visible on lease deed or PPA.`;

function parseJsonObject<T>(text: string, label: string): T {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI did not return JSON for ${label}`);
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    throw new Error(`Failed to parse AI JSON for ${label}`);
  }
}

function emptySource(): LandSourceExtract {
  return { found: false, file: null, parcels: [], notes: null };
}

export async function runLandKycCheckpoint(
  scan: FolderScan,
  onProgress?: ProgressFn,
  attachDocs: AttachDocsFn = docsToAiContent,
): Promise<{ result: LandKycCheckResult; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking for jamabandi, lease & PPA (Land KYC + Plant KYC)…");

  if (!scan.foldersPresent.includes("Land KYC")) {
    return {
      used: [],
      result: {
        checkpoint: "land-kyc",
        ppa: emptySource(),
        jamabandi: emptySource(),
        leaseDeed: emptySource(),
        leasedParcels: [],
        mismatches: ["Land KYC folder not found in this plant pack."],
        leaseTypos: [],
        allMatch: false,
        documentsUsed: [],
        askForDocuments: ["LAND_JAMABANDI", "LAND_LEASE"],
      },
    };
  }

  const { used, askForDocuments } = selectLandKycDocs(scan);
  if (used.length === 0) {
    return {
      used: [],
      result: {
        checkpoint: "land-kyc",
        ppa: emptySource(),
        jamabandi: emptySource(),
        leaseDeed: emptySource(),
        leasedParcels: [],
        mismatches: ["Land KYC folder has no readable PDF/image files."],
        leaseTypos: [],
        allMatch: false,
        documentsUsed: [],
        askForDocuments,
      },
    };
  }

  await onProgress?.(35, "Extracting text (PPA last pages, lease, jamabandi)…");
  const { content: docBlocks, report } = await attachDocs(used, {
    kindHint: (d) => scoreLandDoc(d).kind,
    maxCharsTotal: 80_000,
    maxBinaryBytesTotal: 8 * 1024 * 1024,
  });

  const attached = report.filter((r) => r.mode !== "skipped");
  if (attached.length === 0) {
    return {
      used,
      result: {
        checkpoint: "land-kyc",
        ppa: emptySource(),
        jamabandi: emptySource(),
        leaseDeed: emptySource(),
        leasedParcels: [],
        mismatches: [
          "Could not extract text from Land KYC PDFs and files were too large to upload. Download iCloud files / use text PDFs.",
        ],
        leaseTypos: [],
        allMatch: false,
        documentsUsed: used.map((d) => d.relativePath),
        askForDocuments,
      },
    };
  }

  await onProgress?.(55, "AI comparing khasra, area, village, tehsil, district, lease duration…");

  const content = [
    {
      type: "text" as const,
      text: `${LAND_KYC_PROMPT}\n\nPlant folder: ${scan.root}\nFiles attached: ${report
        .map(
          (r) =>
            `${r.doc.relativePath} [${scoreLandDoc(r.doc).kind}/${r.mode}${r.chars ? ` ${r.chars}c` : ""}]`,
        )
        .join("; ")}\n`,
    },
    ...docBlocks,
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let msg;
  try {
    msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
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

  const parsed = parseJsonObject<Omit<LandKycCheckResult, "checkpoint" | "documentsUsed">>(
    text,
    "Land KYC check",
  );

  const ppaDoc = used.find((d) => scoreLandDoc(d).kind === "ppa");
  let ppa = parsed.ppa ?? emptySource();
  let mismatches = [...(parsed.mismatches ?? [])];

  // Never claim PPA missing when we attached a Plant KYC / Land KYC PPA file
  if (ppaDoc) {
    ppa = {
      ...ppa,
      found: true,
      file: ppa.file || ppaDoc.relativePath,
    };
    mismatches = mismatches.filter(
      (m) => !/ppa\s+not\s+provided|no\s+ppa|ppa\s+missing|without\s+ppa/i.test(m),
    );
  }

  const result: LandKycCheckResult = {
    checkpoint: "land-kyc",
    ppa,
    jamabandi: parsed.jamabandi ?? emptySource(),
    leaseDeed: parsed.leaseDeed ?? emptySource(),
    leasedParcels: parsed.leasedParcels ?? [],
    mismatches,
    leaseTypos: parsed.leaseTypos ?? [],
    allMatch:
      typeof parsed.allMatch === "boolean"
        ? parsed.allMatch && mismatches.length === 0
        : mismatches.length === 0 && (parsed.leaseTypos?.length ?? 0) === 0,
    documentsUsed: used.map((d) => d.relativePath),
    askForDocuments,
  };

  await onProgress?.(95, "Saving Land KYC checkpoint…");
  return { result, used };
}
