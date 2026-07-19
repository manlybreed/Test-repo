"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { scanPlantFolder } from "@/lib/projects/scan-folder";
import {
  runLandKycCheckpoint,
  type ProgressFn,
  type LandKycCheckResult,
} from "@/lib/projects/land-kyc-check";
import {
  runPlantKycCheckpoint,
  type PlantKycResult,
} from "@/lib/projects/plant-kyc-extract";
import {
  runSpvSection1Checkpoint,
  type SpvSection1Result,
  type SpvSection1,
} from "@/lib/projects/spv-section1";
import {
  runDirectorSection23Checkpoint,
  type Section23Result,
  type Section23,
} from "@/lib/projects/director-section23";
import {
  applySection4KnownFacts,
  runDprSection4Checkpoint,
  type Section4Result,
  type Section4,
} from "@/lib/projects/dpr-section4";
import { applyFormV4LiquidityToSection23 } from "@/lib/projects/margin-liquidity";
import { fillDisclosureSectionsDocx } from "@/lib/docgen/disclosure-form";
import { profilePatchFromSections } from "@/lib/projects/plant-profile";
import {
  buildCibilFlags,
  buildDirectorMatchFlags,
  buildLandFlags,
  type ComplianceBundle,
} from "@/lib/projects/director-compliance";
import {
  runPlantExtractPipeline,
  type ExtractStep,
} from "@/lib/projects/run-plant-extract";
import { createDocAiCache } from "@/lib/projects/doc-cache";

export async function listKusumPlants() {
  await requireCeo();
  return prisma.kusumPlant.findMany({ orderBy: { updatedAt: "desc" } });
}

/** Native macOS folder picker → import plant with checklist matching. */
export async function addPlantFromFolderPicker() {
  const { importPlantFromPath } = await import("@/actions/plant-registry");
  return importPlantFromPath();
}

export async function deleteKusumPlant(id: string) {
  await requireCeo();
  if (!id) throw new Error("Plant id required");
  await prisma.kusumPlant.delete({ where: { id } });
  revalidatePath("/ceo/projects");
}

/**
 * Clear all AI extracts / disclosure / table fields filled from extracts.
 * Keeps the plant row, folder, checklist, files, fees, and finance pipeline.
 */
export async function resetPlantExtractData(plantId: string): Promise<{ id: string; summary: string }> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  await prisma.kusumPlant.update({
    where: { id: plantId },
    data: {
      rawExtract: null,
      extractSummary: null,
      disclosureFilePath: null,
      notes: null,
      status: "DRAFT",
      capacityMw: null,
      tehsil: null,
      district: null,
      dprName: null,
      epcName: null,
      tariff: null,
      bankName: null,
    },
  });

  revalidatePath("/ceo/projects");
  return {
    id: plant.id,
    summary: `Reset extracts for ${plant.name} — checklist / files / fees kept`,
  };
}

function mergeRawExtract(
  existing: string | null | undefined,
  patch: Record<string, unknown>,
): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
        if ("checkpoint" in base && base.checkpoint === "land-kyc" && !("land" in base)) {
          base = { land: base };
        }
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch }, null, 2);
}

export type ActionAtKey =
  | "land"
  | "plantKyc"
  | "section1"
  | "section23"
  | "section4"
  | "cibil"
  | "fillData"
  | "extractAll";

/** Merge ISO timestamps for when a checkpoint / action last completed. */
function stampActionAt(
  existing: string | null | undefined,
  keys: ActionAtKey | ActionAtKey[],
): Record<string, string> {
  const prior = parseRawObject(existing).actionAt;
  const next: Record<string, string> =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? { ...(prior as Record<string, string>) }
      : {};
  const now = new Date().toISOString();
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    next[k] = now;
  }
  return next;
}

function parseRawObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const base = parsed as Record<string, unknown>;
      if ("checkpoint" in base && base.checkpoint === "land-kyc" && !("land" in base)) {
        return { land: base };
      }
      return base;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function parseStoredSections(raw: string | null | undefined): {
  section1?: SpvSection1;
  section23?: Section23;
  section4?: Section4;
  land?: LandKycCheckResult;
  plantKyc?: PlantKycResult["plantKyc"];
} {
  const parsed = parseRawObject(raw);
  const section1 =
    (parsed.section1 as SpvSection1Result | undefined)?.section1 ??
    (parsed.section1 as SpvSection1 | undefined);
  const section23 =
    (parsed.section23 as Section23Result | undefined)?.section23 ??
    (parsed.section23 as Section23 | undefined);
  const section4 =
    (parsed.section4 as Section4Result | undefined)?.section4 ??
    (parsed.section4 as Section4 | undefined);
  const land = parsed.land as LandKycCheckResult | undefined;
  const plantKycOuter = parsed.plantKyc as PlantKycResult | Record<string, unknown> | undefined;
  const plantKyc =
    plantKycOuter && "plantKyc" in plantKycOuter
      ? (plantKycOuter as PlantKycResult).plantKyc
      : (plantKycOuter as PlantKycResult["plantKyc"] | undefined);
  return { section1, section23, section4, land, plantKyc };
}

function buildComplianceFromRaw(raw: string | null | undefined): ComplianceBundle {
  const { section1, section23, land } = parseStoredSections(raw);
  const directors = section23?.directors ?? [];
  const directorMatch = buildDirectorMatchFlags({
    gstDirectors: section1?.gstDirectors,
    mcaDirectors: section1?.mcaDirectors,
    directors,
  });
  const cibilFlags = buildCibilFlags(directors);
  const landFlags = buildLandFlags(land);
  const plantKycResult = parseRawObject(raw).plantKyc as PlantKycResult | undefined;
  const ask = [
    ...(land?.askForDocuments ?? []),
    ...(plantKycResult?.askForDocuments ?? []),
    ...cibilFlags.filter((f) => f.status === "ASK_FOR_CIBIL").map(() => "DIR_CIBIL"),
  ];
  return {
    directorMatch,
    cibilFlags,
    landFlags,
    askForDocuments: [...new Set(ask)],
    landMatch: land ? land.allMatch : null,
    mcaCapital: section1
      ? {
          authorizedCapital: section1.authorizedCapital ?? null,
          paidUpCapital: section1.paidUpCapital ?? null,
        }
      : null,
  };
}

async function writeAccumulatedDisclosure(
  plantName: string,
  rawExtract: string | null | undefined,
  patch: {
    section1?: SpvSection1;
    section23?: Section23;
    section4?: Section4;
  },
  tag: string,
): Promise<string> {
  const prior = parseStoredSections(rawExtract);
  let section4 = patch.section4 ?? prior.section4;
  if (section4) {
    section4 = applySection4KnownFacts(section4, {
      land: prior.land,
      plantKyc: prior.plantKyc,
    });
  }

  let section23 = patch.section23 ?? prior.section23;
  if (section23) {
    const priorWrap = parseRawObject(rawExtract).section23 as
      | { notes?: string | null; section23?: Section23 }
      | undefined;
    const notesHint =
      priorWrap && typeof priorWrap === "object" && "notes" in priorWrap
        ? priorWrap.notes
        : null;
    section23 = applyFormV4LiquidityToSection23(
      section23,
      section4,
      notesHint,
    ) as Section23;
  }

  const sections = {
    section1: patch.section1 ?? prior.section1,
    section23,
    section4,
  };
  const docxBuf = await fillDisclosureSectionsDocx(sections);
  const safe = (sections.section1?.legalName || plantName)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 50);
  const filename = `Disclosure_${tag}_${safe}_${Date.now()}.docx`;
  return writeStorageFile("disclosures", filename, docxBuf);
}

/** Persist Form v4 liquidity onto section23 when DPR/margin is available. */
function withFormV4Liquidity(
  section23: Section23 | undefined,
  section4: Section4 | undefined,
  notesHint?: string | null,
): Section23 | undefined {
  if (!section23) return section23;
  return applyFormV4LiquidityToSection23(section23, section4, notesHint) as Section23;
}

function profileFromPlant(
  plant: {
    capacityMw?: string | null;
    tehsil?: string | null;
    district?: string | null;
    dprName?: string | null;
    epcName?: string | null;
    tariff?: string | null;
    bankName?: string | null;
    rawExtract?: string | null;
  },
  extras?: {
    section1?: SpvSection1 | null;
    section4?: Section4 | null;
    land?: LandKycCheckResult | null;
    plantKyc?: PlantKycResult["plantKyc"] | null;
  },
) {
  const prior = parseStoredSections(plant.rawExtract);
  return profilePatchFromSections({
    section1: (extras?.section1 ?? prior.section1) as unknown as Record<string, unknown>,
    section4: (extras?.section4 ?? prior.section4) as unknown as Record<string, unknown>,
    land: (extras?.land ?? prior.land) as unknown as Record<string, unknown>,
    plantKyc: (extras?.plantKyc ?? prior.plantKyc) as unknown as Record<string, unknown>,
    existing: plant,
  });
}

function hasRawCheckpoint(raw: string | null | undefined, key: string): boolean {
  const v = parseRawObject(raw)[key];
  return v != null && typeof v === "object";
}

export type CheckpointOpts = { force?: boolean };

/** Checkpoint 1: Land KYC — PPA last page + lease deed + jamabandi. */
export async function runLandKycCheck(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{
  id: string;
  summary: string;
  land: LandKycCheckResult;
  skipped?: boolean;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  if (!opts?.force && hasRawCheckpoint(plant.rawExtract, "land")) {
    const land = parseRawObject(plant.rawExtract).land as LandKycCheckResult;
    await onProgress?.(100, "Land KYC already present — skipped");
    return {
      id: plant.id,
      summary: "Land KYC already present — skipped (pass force to re-run)",
      land,
      skipped: true,
    };
  }

  await onProgress?.(12, "Reading Land KYC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runLandKycCheckpoint(scan, onProgress);

  const khasraList = result.leasedParcels
    .map((p) => p.khasra)
    .filter(Boolean)
    .join(", ");
  const flag = result.allMatch ? "match OK" : "REVIEW NEEDED";
  const ask = result.askForDocuments?.length
    ? ` · Ask for: ${result.askForDocuments.join(", ")}`
    : "";
  const summary = `Land KYC check · ${used.length} docs · ${
    result.leasedParcels.length
  } leased khasra(s)${khasraList ? `: ${khasraList}` : ""} · ${flag}${ask}`;

  const notesParts = [
    result.mismatches.length ? `Mismatches: ${result.mismatches.join("; ")}` : null,
    result.leaseTypos.length ? `Lease typos: ${result.leaseTypos.join("; ")}` : null,
    result.askForDocuments?.length
      ? `Ask for missing Land KYC doc: ${result.askForDocuments.join(", ")}`
      : null,
  ].filter(Boolean);

  await onProgress?.(98, "Saving checkpoint…");
  const rawExtract = mergeRawExtract(plant.rawExtract, {
    land: result,
    actionAt: stampActionAt(plant.rawExtract, "land"),
    compliance: buildComplianceFromRaw(
      mergeRawExtract(plant.rawExtract, { land: result }),
    ),
  });
  const profilePatch = profileFromPlant(
    { ...plant, rawExtract },
    { land: result },
  );
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: result.allMatch ? "LAND_OK" : "LAND_REVIEW",
      documentsFound: scan.documents.length,
      rawExtract,
      extractSummary: summary,
      notes: notesParts.length ? notesParts.join(" | ") : plant.notes,
      ...profilePatch,
    },
  });

  revalidatePath("/ceo/projects");
  await onProgress?.(100, "Done");

  return {
    id: updated.id,
    summary: updated.extractSummary || summary,
    land: result,
  };
}

/** Plant KYC — LOA / PPA / tariff mini-pass. */
export async function runPlantKycFill(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{ id: string; summary: string; plantKyc: PlantKycResult; skipped?: boolean }> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  if (!opts?.force && hasRawCheckpoint(plant.rawExtract, "plantKyc")) {
    const plantKyc = parseRawObject(plant.rawExtract).plantKyc as PlantKycResult;
    await onProgress?.(100, "Plant KYC already present — skipped");
    return {
      id: plant.id,
      summary: "Plant KYC already present — skipped (pass force to re-run)",
      plantKyc,
      skipped: true,
    };
  }

  const scan = await scanPlantFolder(plant.folderPath);
  const { result, used } = await runPlantKycCheckpoint(scan, onProgress);

  const pk = result.plantKyc;
  const summary = `Plant KYC · ${used.length} docs · LOA ${pk.loaNumber || "—"} · PPA ${
    pk.ppaNumber || "—"
  } · tariff ${pk.tariff || "—"}`;

  const rawExtract = mergeRawExtract(plant.rawExtract, {
    plantKyc: result,
    actionAt: stampActionAt(plant.rawExtract, "plantKyc"),
  });
  const profilePatch = profileFromPlant(
    { ...plant, rawExtract },
    { plantKyc: pk },
  );
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "PLANT_KYC_READY",
      documentsFound: scan.documents.length,
      rawExtract,
      extractSummary: summary,
      notes: result.notes ?? plant.notes,
      ...profilePatch,
    },
  });

  revalidatePath("/ceo/projects");
  await onProgress?.(100, "Done");
  return { id: updated.id, summary, plantKyc: result };
}

/** Fill disclosure Section 1 from SPV KYC only. */
export async function runSpvSection1Fill(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section1: SpvSection1Result;
  skipped?: boolean;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  if (!opts?.force && hasRawCheckpoint(plant.rawExtract, "section1")) {
    const section1 = parseRawObject(plant.rawExtract).section1 as SpvSection1Result;
    await onProgress?.(100, "Section 1 already present — skipped");
    return {
      id: plant.id,
      summary: "Section 1 already present — skipped (pass force to re-run)",
      filePath: plant.disclosureFilePath,
      section1,
      skipped: true,
    };
  }

  await onProgress?.(12, "Reading SPV KYC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runSpvSection1Checkpoint(scan, onProgress);

  await onProgress?.(92, "Filling disclosure template…");
  const filePath = await writeAccumulatedDisclosure(
    plant.name,
    plant.rawExtract,
    { section1: result.section1 },
    "S1",
  );

  const summary = `Section 1 (SPV) · ${used.length} docs · ${
    result.section1.legalName || "name?"
  } · CIN ${result.section1.cin || "—"} · capital ${
    result.section1.authorizedCapital || "—"
  } / ${result.section1.paidUpCapital || "—"}`;

  await onProgress?.(98, "Saving…");
  const rawExtract = mergeRawExtract(plant.rawExtract, {
    section1: result,
    actionAt: stampActionAt(plant.rawExtract, "section1"),
    compliance: buildComplianceFromRaw(
      mergeRawExtract(plant.rawExtract, { section1: result }),
    ),
  });
  const profilePatch = profileFromPlant(
    { ...plant, rawExtract },
    { section1: result.section1 },
  );
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION1_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract,
      extractSummary: summary,
      notes: result.notes ?? plant.notes,
      ...profilePatch,
    },
  });

  revalidatePath("/ceo/projects");
  await onProgress?.(100, "Done");

  return {
    id: updated.id,
    summary,
    filePath: updated.disclosureFilePath,
    section1: result,
  };
}

/** Fill Section 2 + partial Section 3 from Director KYC (incl. CIBIL). */
export async function runDirectorSection23Fill(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section23: Section23Result;
  compliance: ComplianceBundle;
  skipped?: boolean;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  if (!opts?.force && hasRawCheckpoint(plant.rawExtract, "section23")) {
    const section23 = parseRawObject(plant.rawExtract).section23 as Section23Result;
    const compliance = buildComplianceFromRaw(plant.rawExtract);
    await onProgress?.(100, "Sections 2–3 already present — skipped");
    return {
      id: plant.id,
      summary:
        "Sections 2–3 already present — skipped (same AI call fills S2+S3; pass force to re-run)",
      filePath: plant.disclosureFilePath,
      section23,
      compliance,
      skipped: true,
    };
  }

  await onProgress?.(12, "Reading Director KYC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runDirectorSection23Checkpoint(scan, onProgress);

  await onProgress?.(92, "Filling Sections 2–3 on disclosure template…");
  const filePath = await writeAccumulatedDisclosure(
    plant.name,
    plant.rawExtract,
    { section23: result.section23 },
    "S23",
  );

  const dirNames = result.section23.directors
    .map((d) => d.name)
    .filter(Boolean)
    .join(", ");
  const cibilFlags = buildCibilFlags(result.section23.directors);
  const red = cibilFlags.filter((f) => f.status === "RED_FLAG").length;
  const ask = cibilFlags.filter((f) => f.status === "ASK_FOR_CIBIL").length;
  const summary = `Section 2–3 (Directors) · ${used.length} docs · ${
    result.section23.directors.length
  } director(s)${dirNames ? `: ${dirNames}` : ""} · CIBIL ask ${ask} / red ${red}`;

  await onProgress?.(98, "Saving…");
  const priorSections = parseStoredSections(plant.rawExtract);
  const priorNotes =
    (parseRawObject(plant.rawExtract).section23 as { notes?: string } | undefined)?.notes ??
    null;
  const section23Enriched =
    withFormV4Liquidity(result.section23, priorSections.section4, priorNotes ?? result.notes) ??
    result.section23;
  const resultToStore = { ...result, section23: section23Enriched };
  const rawMerged = mergeRawExtract(plant.rawExtract, {
    section23: resultToStore,
    actionAt: stampActionAt(plant.rawExtract, ["section23", "cibil"]),
  });
  const compliance = buildComplianceFromRaw(rawMerged);
  const rawExtract = mergeRawExtract(rawMerged, { compliance });
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION23_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract,
      extractSummary: summary,
      notes: result.notes ?? plant.notes,
    },
  });

  revalidatePath("/ceo/projects");
  await onProgress?.(100, "Done");

  return {
    id: updated.id,
    summary,
    filePath: updated.disclosureFilePath,
    section23: resultToStore,
    compliance,
  };
}

/** Fill Section 4 from DPR / PVsyst (injects land + plantKyc known facts). */
export async function runDprSection4Fill(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section4: Section4Result;
  skipped?: boolean;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const prior = parseStoredSections(plant.rawExtract);

  if (!opts?.force && hasRawCheckpoint(plant.rawExtract, "section4")) {
    const section4 = parseRawObject(plant.rawExtract).section4 as Section4Result;
    await onProgress?.(100, "Section 4 already present — skipped");
    return {
      id: plant.id,
      summary: "Section 4 already present — skipped (pass force to re-run)",
      filePath: plant.disclosureFilePath,
      section4,
      skipped: true,
    };
  }

  await onProgress?.(12, "Reading DPR From EPC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runDprSection4Checkpoint(
    scan,
    onProgress,
    undefined,
    { land: prior.land, plantKyc: prior.plantKyc },
  );

  await onProgress?.(92, "Filling Section 4 on disclosure template…");
  const filePath = await writeAccumulatedDisclosure(
    plant.name,
    mergeRawExtract(plant.rawExtract, { section4: result }),
    { section4: result.section4 },
    "S4",
  );

  const summary = `Section 4 (DPR) · ${used.length} docs · ${
    result.section4.capacityAcMw || "?"
  } MW AC · cost ${result.section4.dprProjectCost || "—"} · tariff ${
    result.section4.tariff || "—"
  }`;

  await onProgress?.(98, "Saving…");
  const section4Normalized = applySection4KnownFacts(result.section4, {
    land: prior.land,
    plantKyc: prior.plantKyc,
  });
  const result4 = { ...result, section4: section4Normalized };
  const priorRaw = parseRawObject(plant.rawExtract);
  const priorS23Wrap = priorRaw.section23 as Section23Result | Section23 | undefined;
  let section23Patch: Record<string, unknown> = {};
  if (priorS23Wrap) {
    const inner =
      priorS23Wrap &&
      typeof priorS23Wrap === "object" &&
      "section23" in priorS23Wrap &&
      (priorS23Wrap as Section23Result).section23
        ? (priorS23Wrap as Section23Result).section23
        : (priorS23Wrap as Section23);
    const enriched = withFormV4Liquidity(
      inner,
      section4Normalized,
      (priorS23Wrap as { notes?: string | null }).notes ?? null,
    );
    if (enriched) {
      section23Patch = {
        section23:
          "checkpoint" in (priorS23Wrap as object)
            ? { ...(priorS23Wrap as object), section23: enriched }
            : { checkpoint: "director-section23", section23: enriched, documentsUsed: [] },
      };
    }
  }

  const profilePatch = profileFromPlant(
    plant,
    {
      section4: section4Normalized,
      land: prior.land,
      plantKyc: prior.plantKyc,
    },
  );
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION4_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract: mergeRawExtract(plant.rawExtract, {
        section4: result4,
        ...section23Patch,
        actionAt: stampActionAt(plant.rawExtract, "section4"),
      }),
      extractSummary: summary,
      notes: result.notes ?? plant.notes,
      ...profilePatch,
    },
  });

  revalidatePath("/ceo/projects");
  await onProgress?.(100, "Done");

  return {
    id: updated.id,
    summary,
    filePath: updated.disclosureFilePath,
    section4: result4,
  };
}

export type ExtractAllProgress = {
  pct: number;
  step: string;
  extractStep?: ExtractStep;
  skipped?: boolean;
};

/** Run all optimized checkpoints (≤5 AI calls); skips completed unless force. */
export async function runExtractAll(
  plantId: string,
  opts: { force?: boolean; onProgress?: (p: ExtractAllProgress) => void | Promise<void> } = {},
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  compliance: ComplianceBundle;
  skipped: ExtractStep[];
  ran: ExtractStep[];
  cacheStats: { hits: number; misses: number };
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await opts.onProgress?.({ pct: 2, step: "Loading plant…", extractStep: "land" });
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const prior = parseRawObject(plant.rawExtract);
  const scan = await scanPlantFolder(plant.folderPath);
  const cache = createDocAiCache();

  const pipeline = await runPlantExtractPipeline(scan, {
    force: opts.force === true,
    prior,
    attachDocs: cache,
    onProgress: async (p) => {
      await opts.onProgress?.({
        pct: p.pct,
        step: p.message,
        extractStep: p.step,
        skipped: p.skipped,
      });
    },
  });

  await opts.onProgress?.({
    pct: 93,
    step: "Writing disclosure DOCX…",
    extractStep: "docx",
  });

  let rawExtract = plant.rawExtract;
  const section4ForPatch = pipeline.section4
    ? {
        ...pipeline.section4,
        section4: applySection4KnownFacts(pipeline.section4.section4, {
          land: pipeline.land ?? undefined,
          plantKyc: pipeline.plantKyc?.plantKyc ?? undefined,
        }),
      }
    : undefined;
  const section23ForPatch = pipeline.section23
    ? {
        ...pipeline.section23,
        section23:
          withFormV4Liquidity(
            pipeline.section23.section23,
            section4ForPatch?.section4 ??
              (parseStoredSections(plant.rawExtract).section4 as Section4 | undefined),
          ) ?? pipeline.section23.section23,
      }
    : undefined;

  const patch: Record<string, unknown> = {
    compliance: pipeline.compliance,
  };
  if (pipeline.land) patch.land = pipeline.land;
  if (pipeline.plantKyc) patch.plantKyc = pipeline.plantKyc;
  if (pipeline.section1) patch.section1 = pipeline.section1;
  if (section23ForPatch) patch.section23 = section23ForPatch;
  else if (pipeline.section23) patch.section23 = pipeline.section23;
  if (section4ForPatch) patch.section4 = section4ForPatch;
  else if (pipeline.section4) patch.section4 = pipeline.section4;

  // Recompute Form v4 liquidity on prior Section 3 when only Section 4 ran
  if (section4ForPatch && !section23ForPatch) {
    const priorS23Wrap = parseRawObject(plant.rawExtract).section23 as
      | Section23Result
      | Section23
      | undefined;
    if (priorS23Wrap) {
      const inner =
        priorS23Wrap &&
        typeof priorS23Wrap === "object" &&
        "section23" in priorS23Wrap &&
        (priorS23Wrap as Section23Result).section23
          ? (priorS23Wrap as Section23Result).section23
          : (priorS23Wrap as Section23);
      const enriched = withFormV4Liquidity(
        inner,
        section4ForPatch.section4,
        (priorS23Wrap as { notes?: string | null }).notes ?? null,
      );
      if (enriched) {
        patch.section23 =
          "checkpoint" in (priorS23Wrap as object)
            ? { ...(priorS23Wrap as object), section23: enriched }
            : { checkpoint: "director-section23", section23: enriched, documentsUsed: [] };
      }
    }
  }

  const stamped: ActionAtKey[] = ["extractAll"];
  for (const step of pipeline.ran) {
    if (
      step === "land" ||
      step === "plantKyc" ||
      step === "section1" ||
      step === "section23" ||
      step === "section4"
    ) {
      stamped.push(step);
    }
  }
  if (pipeline.ran.includes("section23")) stamped.push("cibil");
  patch.actionAt = stampActionAt(plant.rawExtract, stamped);

  rawExtract = mergeRawExtract(rawExtract, patch);

  const filePath = await writeAccumulatedDisclosure(
    plant.name,
    rawExtract,
    {
      section1: pipeline.section1?.section1,
      section23: pipeline.section23?.section23,
      section4: pipeline.section4?.section4,
    },
    "ALL",
  );

  await opts.onProgress?.({
    pct: 97,
    step: "Updating plant profile…",
    extractStep: "profile",
  });

  const profilePatch = profileFromPlant(
    { ...plant, rawExtract },
    {
      section1: pipeline.section1?.section1,
      section4: pipeline.section4?.section4,
      land: pipeline.land,
      plantKyc: pipeline.plantKyc?.plantKyc,
    },
  );

  const summary = `Run all · ran [${pipeline.ran.join(", ") || "none"}] · skipped [${
    pipeline.skipped.join(", ") || "none"
  }] · cache ${pipeline.cacheStats.hits}h/${pipeline.cacheStats.misses}m · land ${
    pipeline.compliance.landMatch == null
      ? "—"
      : pipeline.compliance.landMatch
        ? "OK"
        : "REVIEW"
  } · CIBIL flags ${pipeline.compliance.cibilFlags.length}`;

  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "FORM_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract,
      extractSummary: summary,
      ...profilePatch,
    },
  });

  revalidatePath("/ceo/projects");
  await opts.onProgress?.({ pct: 100, step: "Done", extractStep: "done" });

  return {
    id: updated.id,
    summary,
    filePath: updated.disclosureFilePath,
    compliance: pipeline.compliance,
    skipped: pipeline.skipped,
    ran: pipeline.ran,
    cacheStats: pipeline.cacheStats,
  };
}

/**
 * Project rawExtract → plant table columns (Capacity / Tehsil / District / Tariff / …).
 * No AI — fills only empty DB fields from land + plantKyc + S1/S4.
 */
export async function fillPlantTableFromExtract(plantId: string): Promise<{
  id: string;
  summary: string;
  patched: string[];
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const prior = parseStoredSections(plant.rawExtract);
  if (!prior.land && !prior.plantKyc && !prior.section1 && !prior.section4) {
    throw new Error(
      "No extracted data yet — run Land KYC / Plant KYC / Section fills or Run all first.",
    );
  }

  // Refresh Section 4 blanks from land/plantKyc so location/tariff project correctly
  let section4 = prior.section4;
  if (section4) {
    section4 = applySection4KnownFacts(section4, {
      land: prior.land,
      plantKyc: prior.plantKyc,
    });
  }

  const profilePatch = profileFromPlant(plant, {
    section1: prior.section1,
    section4,
    land: prior.land,
    plantKyc: prior.plantKyc,
  });

  const patched = Object.keys(profilePatch);
  if (patched.length === 0) {
    return {
      id: plant.id,
      summary: "Table already has Capacity / Tehsil / District / Tariff (nothing empty to fill).",
      patched: [],
    };
  }

  const data: Record<string, unknown> = {
    ...profilePatch,
    extractSummary: `Fill data · updated ${patched.join(", ")}`,
  };
  const actionAt = stampActionAt(plant.rawExtract, "fillData");
  if (section4 && prior.section4) {
    const prev = parseRawObject(plant.rawExtract);
    const prevS4 = prev.section4;
    data.rawExtract = mergeRawExtract(plant.rawExtract, {
      section4:
        prevS4 && typeof prevS4 === "object" && "section4" in (prevS4 as object)
          ? { ...(prevS4 as object), section4 }
          : { checkpoint: "dpr-section4", section4, documentsUsed: [] },
      actionAt,
    });
  } else {
    data.rawExtract = mergeRawExtract(plant.rawExtract, { actionAt });
  }

  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data,
  });

  revalidatePath("/ceo/projects");
  return {
    id: updated.id,
    summary: `Filled ${patched.join(", ")} from extracted docs`,
    patched,
  };
}

/**
 * CIBIL check — reuses Directors KYC extract when present; otherwise runs S2–S3.
 * Surfaces ASK_FOR_CIBIL / RED_FLAG (&lt;725) on compliance.
 */
export async function runCibilCheck(
  plantId: string,
  onProgress?: ProgressFn,
  opts?: CheckpointOpts,
): Promise<{
  id: string;
  summary: string;
  compliance: ComplianceBundle;
  section23?: Section23Result;
  filePath?: string | null;
  skipped?: boolean;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const prior = parseStoredSections(plant.rawExtract);

  if (prior.section23?.directors?.length && !opts?.force) {
    await onProgress?.(40, "Checking CIBIL flags from existing Directors extract…");
    const cibilFlags = buildCibilFlags(prior.section23.directors);
    const rawMerged = plant.rawExtract;
    const compliance = buildComplianceFromRaw(rawMerged);
    compliance.cibilFlags = cibilFlags;
    compliance.askForDocuments = [
      ...new Set([
        ...compliance.askForDocuments.filter((c) => c !== "DIR_CIBIL"),
        ...cibilFlags.filter((f) => f.status === "ASK_FOR_CIBIL").map(() => "DIR_CIBIL"),
      ]),
    ];
    const rawExtract = mergeRawExtract(plant.rawExtract, {
      compliance,
      actionAt: stampActionAt(plant.rawExtract, "cibil"),
    });
    const ask = cibilFlags.filter((f) => f.status === "ASK_FOR_CIBIL").length;
    const red = cibilFlags.filter((f) => f.status === "RED_FLAG").length;
    const ok = cibilFlags.filter((f) => f.status === "OK").length;
    const summary = `CIBIL check · ${cibilFlags.length} director(s) · OK ${ok} · ask ${ask} · red ${red}`;
    const updated = await prisma.kusumPlant.update({
      where: { id: plant.id },
      data: { rawExtract, extractSummary: summary },
    });
    revalidatePath("/ceo/projects");
    await onProgress?.(100, "Done");
    return { id: updated.id, summary, compliance };
  }

  await onProgress?.(15, "No directors extract — running Sections 2–3 (incl. CIBIL)…");
  return runDirectorSection23Fill(plantId, onProgress, opts);
}
