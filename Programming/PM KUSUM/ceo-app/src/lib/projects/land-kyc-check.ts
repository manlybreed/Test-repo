import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { FolderScan, ScannedDoc } from "./scan-folder";
import { docsToAiContent, formatAnthropicError } from "./doc-content";

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

/** Only documents under the Land KYC folder — one best file per kind. */
export function selectLandKycDocs(scan: FolderScan): ScannedDoc[] {
  const landDocs = scan.documents.filter((d) => d.category === "Land KYC");
  if (landDocs.length === 0) return [];

  const ranked = landDocs
    .map((d) => ({ d, ...scoreLandDoc(d) }))
    .sort((a, b) => b.score - a.score || a.d.size - b.d.size);

  const picked: ScannedDoc[] = [];
  for (const kind of ["ppa", "lease", "jamabandi"] as const) {
    const candidates = ranked.filter((x) => x.kind === kind).slice(0, 6);
    // Prefer smaller among strong matches (faster text extract); keep highest score first
    candidates.sort((a, b) => b.score - a.score || a.d.size - b.d.size);
    if (candidates[0]) picked.push(candidates[0].d);
  }

  // If filenames don't match keywords, take up to 3 Land KYC files (smallest first)
  if (picked.length === 0) {
    return [...landDocs].sort((a, b) => a.size - b.size).slice(0, 3);
  }
  return picked;
}

const LAND_KYC_PROMPT = `You are Checkpoint 1 for a PM KUSUM plant file: LAND KYC verification only.

Documents are ONLY from the "Land KYC" folder. You should receive some or all of:
1) PPA (Power Purchase Agreement) — the land / khasra schedule is almost always on the LAST page(s) or closing annexure. Focus there.
2) Lease deed — registered lease of project land (lists khasras taken on lease + tenure).
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
): Promise<{ result: LandKycCheckResult; used: ScannedDoc[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  await onProgress?.(10, "Looking in Land KYC for PPA, lease deed & jamabandi…");

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
      },
    };
  }

  const used = selectLandKycDocs(scan);
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
      },
    };
  }

  await onProgress?.(35, "Extracting text (PPA last pages, lease, jamabandi)…");
  const { content: docBlocks, report } = await docsToAiContent(used, {
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
      },
    };
  }

  await onProgress?.(55, "AI comparing khasra, area, village, tehsil, district, lease duration…");

  const content = [
    {
      type: "text" as const,
      text: `${LAND_KYC_PROMPT}\n\nPlant folder: ${scan.root}\nLand KYC files attached: ${report
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

  const result: LandKycCheckResult = {
    checkpoint: "land-kyc",
    ppa: parsed.ppa ?? emptySource(),
    jamabandi: parsed.jamabandi ?? emptySource(),
    leaseDeed: parsed.leaseDeed ?? emptySource(),
    leasedParcels: parsed.leasedParcels ?? [],
    mismatches: parsed.mismatches ?? [],
    leaseTypos: parsed.leaseTypos ?? [],
    allMatch:
      typeof parsed.allMatch === "boolean"
        ? parsed.allMatch
        : (parsed.mismatches?.length ?? 0) === 0 && (parsed.leaseTypos?.length ?? 0) === 0,
    documentsUsed: used.map((d) => d.relativePath),
  };

  await onProgress?.(95, "Saving Land KYC checkpoint…");
  return { result, used };
}
