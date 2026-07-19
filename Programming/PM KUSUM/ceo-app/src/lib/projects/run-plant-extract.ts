import type { FolderScan } from "./scan-folder";
import { createDocAiCache, type AttachDocsFn } from "./doc-cache";
import {
  runLandKycCheckpoint,
  type LandKycCheckResult,
  type ProgressFn,
} from "./land-kyc-check";
import {
  runPlantKycCheckpoint,
  type PlantKycResult,
} from "./plant-kyc-extract";
import {
  runSpvSection1Checkpoint,
  type SpvSection1Result,
} from "./spv-section1";
import {
  runDirectorSection23Checkpoint,
  type Section23Result,
} from "./director-section23";
import {
  applySection4KnownFacts,
  runDprSection4Checkpoint,
  type Section4Result,
} from "./dpr-section4";
import {
  buildCibilFlags,
  buildDirectorMatchFlags,
  buildLandFlags,
  type ComplianceBundle,
} from "./director-compliance";

export type ExtractStep =
  | "land"
  | "plantKyc"
  | "section1"
  | "section23"
  | "section4"
  | "profile"
  | "docx"
  | "done";

export type RunPlantExtractProgress = {
  step: ExtractStep;
  pct: number;
  message: string;
  skipped?: boolean;
};

export type RunPlantExtractOptions = {
  force?: boolean;
  /** Existing rawExtract JSON object */
  prior?: Record<string, unknown> | null;
  onProgress?: (p: RunPlantExtractProgress) => void | Promise<void>;
  attachDocs?: AttachDocsFn;
};

export type RunPlantExtractResult = {
  land?: LandKycCheckResult;
  plantKyc?: PlantKycResult;
  section1?: SpvSection1Result;
  section23?: Section23Result;
  section4?: Section4Result;
  compliance: ComplianceBundle;
  skipped: ExtractStep[];
  ran: ExtractStep[];
  cacheStats: { hits: number; misses: number };
};

function hasCheckpoint(prior: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!prior) return false;
  const v = prior[key];
  return v != null && typeof v === "object";
}

function asLand(prior: Record<string, unknown> | null | undefined): LandKycCheckResult | null {
  const v = prior?.land;
  if (v && typeof v === "object") return v as LandKycCheckResult;
  return null;
}

function asPlantKyc(prior: Record<string, unknown> | null | undefined): PlantKycResult | null {
  const v = prior?.plantKyc;
  if (v && typeof v === "object") return v as PlantKycResult;
  return null;
}

function asSection1(prior: Record<string, unknown> | null | undefined): SpvSection1Result | null {
  const v = prior?.section1;
  if (v && typeof v === "object") return v as SpvSection1Result;
  return null;
}

function asSection23(prior: Record<string, unknown> | null | undefined): Section23Result | null {
  const v = prior?.section23;
  if (v && typeof v === "object") return v as Section23Result;
  return null;
}

function asSection4(prior: Record<string, unknown> | null | undefined): Section4Result | null {
  const v = prior?.section4;
  if (v && typeof v === "object") return v as Section4Result;
  return null;
}

function mapProgress(
  step: ExtractStep,
  base: number,
  span: number,
  onProgress?: RunPlantExtractOptions["onProgress"],
): ProgressFn {
  return async (pct, message) => {
    const mapped = base + Math.round((Math.min(100, Math.max(0, pct)) / 100) * span);
    await onProgress?.({ step, pct: mapped, message });
  };
}

function buildCompliance(bundle: {
  land?: LandKycCheckResult | null;
  plantKyc?: PlantKycResult | null;
  section1?: SpvSection1Result | null;
  section23?: Section23Result | null;
}): ComplianceBundle {
  const s1 = bundle.section1?.section1;
  const directors = bundle.section23?.section23?.directors ?? [];
  const directorMatch = buildDirectorMatchFlags({
    gstDirectors: s1?.gstDirectors,
    mcaDirectors: s1?.mcaDirectors,
    directors,
  });
  const cibilFlags = buildCibilFlags(directors);
  const landFlags = buildLandFlags(bundle.land);
  const askForDocuments = [
    ...(bundle.land?.askForDocuments ?? []),
    ...(bundle.plantKyc?.askForDocuments ?? []),
    ...cibilFlags
      .filter((f) => f.status === "ASK_FOR_CIBIL")
      .map(() => "DIR_CIBIL"),
  ];
  // unique ask codes
  const uniqueAsk = [...new Set(askForDocuments)];

  return {
    directorMatch,
    cibilFlags,
    landFlags,
    askForDocuments: uniqueAsk,
    landMatch: bundle.land ? bundle.land.allMatch : null,
    mcaCapital: s1
      ? {
          authorizedCapital: s1.authorizedCapital ?? null,
          paidUpCapital: s1.paidUpCapital ?? null,
        }
      : null,
  };
}

/**
 * Ordered optimized pipeline: Land → Plant KYC → S1 → S23+CIBIL → S4.
 * Skips steps already present in prior rawExtract unless force=true.
 * ≤5 Claude calls when all steps run.
 */
export async function runPlantExtractPipeline(
  scan: FolderScan,
  opts: RunPlantExtractOptions = {},
): Promise<RunPlantExtractResult> {
  const force = opts.force === true;
  const prior = opts.prior ?? {};
  const attach =
    opts.attachDocs ??
    (createDocAiCache() as AttachDocsFn & { stats?: () => { hits: number; misses: number } });
  const skipped: ExtractStep[] = [];
  const ran: ExtractStep[] = [];

  let land = asLand(prior);
  let plantKyc = asPlantKyc(prior);
  let section1 = asSection1(prior);
  let section23 = asSection23(prior);
  let section4 = asSection4(prior);

  // Land ~0–18
  if (!force && hasCheckpoint(prior, "land")) {
    skipped.push("land");
    await opts.onProgress?.({
      step: "land",
      pct: 18,
      message: "Land KYC already present — skipped",
      skipped: true,
    });
  } else {
    ran.push("land");
    const { result } = await runLandKycCheckpoint(
      scan,
      mapProgress("land", 0, 18, opts.onProgress),
      attach,
    );
    land = result;
  }

  // Plant KYC ~18–34
  if (!force && hasCheckpoint(prior, "plantKyc")) {
    skipped.push("plantKyc");
    await opts.onProgress?.({
      step: "plantKyc",
      pct: 34,
      message: "Plant KYC already present — skipped",
      skipped: true,
    });
  } else {
    ran.push("plantKyc");
    const { result } = await runPlantKycCheckpoint(
      scan,
      mapProgress("plantKyc", 18, 16, opts.onProgress),
      attach,
    );
    plantKyc = result;
  }

  // Section 1 ~34–52
  if (!force && hasCheckpoint(prior, "section1")) {
    skipped.push("section1");
    await opts.onProgress?.({
      step: "section1",
      pct: 52,
      message: "Section 1 already present — skipped",
      skipped: true,
    });
  } else {
    ran.push("section1");
    try {
      const { result } = await runSpvSection1Checkpoint(
        scan,
        mapProgress("section1", 34, 18, opts.onProgress),
        attach,
      );
      section1 = result;
    } catch (err) {
      await opts.onProgress?.({
        step: "section1",
        pct: 52,
        message: err instanceof Error ? err.message : "Section 1 failed",
      });
      throw err;
    }
  }

  // Section 23 ~52–72
  if (!force && hasCheckpoint(prior, "section23")) {
    skipped.push("section23");
    await opts.onProgress?.({
      step: "section23",
      pct: 72,
      message: "Sections 2–3 already present — skipped",
      skipped: true,
    });
  } else {
    ran.push("section23");
    const { result } = await runDirectorSection23Checkpoint(
      scan,
      mapProgress("section23", 52, 20, opts.onProgress),
      attach,
    );
    section23 = result;
  }

  // Section 4 ~72–92
  if (!force && hasCheckpoint(prior, "section4")) {
    skipped.push("section4");
    // Still merge known facts into existing section4 for profile/docx
    if (section4?.section4) {
      section4 = {
        ...section4,
        section4: applySection4KnownFacts(section4.section4, {
          land,
          plantKyc: plantKyc?.plantKyc,
        }),
      };
    }
    await opts.onProgress?.({
      step: "section4",
      pct: 92,
      message: "Section 4 already present — skipped",
      skipped: true,
    });
  } else {
    ran.push("section4");
    const { result } = await runDprSection4Checkpoint(
      scan,
      mapProgress("section4", 72, 20, opts.onProgress),
      attach,
      {
        land,
        plantKyc: plantKyc?.plantKyc,
      },
    );
    section4 = result;
  }

  const compliance = buildCompliance({ land, plantKyc, section1, section23 });

  await opts.onProgress?.({
    step: "profile",
    pct: 95,
    message: "Building plant profile projection…",
  });

  const cacheStats =
    typeof (attach as unknown as { stats?: () => { hits: number; misses: number } }).stats ===
    "function"
      ? (attach as unknown as { stats: () => { hits: number; misses: number } }).stats()
      : { hits: 0, misses: 0 };

  await opts.onProgress?.({
    step: "done",
    pct: 100,
    message: "Pipeline complete",
  });

  return {
    land: land ?? undefined,
    plantKyc: plantKyc ?? undefined,
    section1: section1 ?? undefined,
    section23: section23 ?? undefined,
    section4: section4 ?? undefined,
    compliance,
    skipped,
    ran,
    cacheStats,
  };
}
