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
  runDprSection4Checkpoint,
  type Section4Result,
  type Section4,
} from "@/lib/projects/dpr-section4";
import { fillDisclosureSectionsDocx } from "@/lib/docgen/disclosure-form";
import { profilePatchFromSections } from "@/lib/projects/plant-profile";

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

function parseStoredSections(raw: string | null | undefined): {
  section1?: SpvSection1;
  section23?: Section23;
  section4?: Section4;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const section1 =
      (parsed.section1 as SpvSection1Result | undefined)?.section1 ??
      (parsed.section1 as SpvSection1 | undefined);
    const section23 =
      (parsed.section23 as Section23Result | undefined)?.section23 ??
      (parsed.section23 as Section23 | undefined);
    const section4 =
      (parsed.section4 as Section4Result | undefined)?.section4 ??
      (parsed.section4 as Section4 | undefined);
    return { section1, section23, section4 };
  } catch {
    return {};
  }
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
  const sections = {
    section1: patch.section1 ?? prior.section1,
    section23: patch.section23 ?? prior.section23,
    section4: patch.section4 ?? prior.section4,
  };
  const docxBuf = await fillDisclosureSectionsDocx(sections);
  const safe = (sections.section1?.legalName || plantName)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 50);
  const filename = `Disclosure_${tag}_${safe}_${Date.now()}.docx`;
  return writeStorageFile("disclosures", filename, docxBuf);
}

/** Checkpoint 1: Land KYC — PPA last page + lease deed + jamabandi. */
export async function runLandKycCheck(
  plantId: string,
  onProgress?: ProgressFn,
): Promise<{ id: string; summary: string; land: LandKycCheckResult }> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  await onProgress?.(12, "Reading Land KYC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runLandKycCheckpoint(scan, onProgress);

  const khasraList = result.leasedParcels
    .map((p) => p.khasra)
    .filter(Boolean)
    .join(", ");
  const flag = result.allMatch ? "match OK" : "REVIEW NEEDED";
  const summary = `Land KYC check · ${used.length} docs · ${
    result.leasedParcels.length
  } leased khasra(s)${khasraList ? `: ${khasraList}` : ""} · ${flag}`;

  const notesParts = [
    result.mismatches.length ? `Mismatches: ${result.mismatches.join("; ")}` : null,
    result.leaseTypos.length ? `Lease typos: ${result.leaseTypos.join("; ")}` : null,
  ].filter(Boolean);

  await onProgress?.(98, "Saving checkpoint…");
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: result.allMatch ? "LAND_OK" : "LAND_REVIEW",
      documentsFound: scan.documents.length,
      rawExtract: mergeRawExtract(plant.rawExtract, { land: result }),
      extractSummary: summary,
      notes: notesParts.length ? notesParts.join(" | ") : plant.notes,
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

/** Fill disclosure Section 1 from SPV KYC only. */
export async function runSpvSection1Fill(
  plantId: string,
  onProgress?: ProgressFn,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section1: SpvSection1Result;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

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
  } · CIN ${result.section1.cin || "—"} · PAN ${result.section1.pan || "—"}`;

  await onProgress?.(98, "Saving…");
  const profilePatch = profilePatchFromSections({
    section1: result.section1 as unknown as Record<string, unknown>,
    existing: plant,
  });
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION1_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract: mergeRawExtract(plant.rawExtract, { section1: result }),
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

/** Fill Section 2 + partial Section 3 from Director KYC. */
export async function runDirectorSection23Fill(
  plantId: string,
  onProgress?: ProgressFn,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section23: Section23Result;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

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
  const summary = `Section 2–3 (Directors) · ${used.length} docs · ${
    result.section23.directors.length
  } director(s)${dirNames ? `: ${dirNames}` : ""} · NW rows ${
    result.section23.promotersNetWorth.length
  }`;

  await onProgress?.(98, "Saving…");
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION23_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract: mergeRawExtract(plant.rawExtract, { section23: result }),
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
    section23: result,
  };
}

/** Fill Section 4 from DPR / PVsyst. */
export async function runDprSection4Fill(
  plantId: string,
  onProgress?: ProgressFn,
): Promise<{
  id: string;
  summary: string;
  filePath: string | null;
  section4: Section4Result;
}> {
  await requireCeo();
  if (!plantId) throw new Error("Plant id required");

  await onProgress?.(5, "Loading plant…");
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });

  await onProgress?.(12, "Reading DPR From EPC folder…");
  const scan = await scanPlantFolder(plant.folderPath);

  const { result, used } = await runDprSection4Checkpoint(scan, onProgress);

  await onProgress?.(92, "Filling Section 4 on disclosure template…");
  const filePath = await writeAccumulatedDisclosure(
    plant.name,
    plant.rawExtract,
    { section4: result.section4 },
    "S4",
  );

  const summary = `Section 4 (DPR) · ${used.length} docs · ${
    result.section4.capacityAcMw || "?"
  } MW AC · cost ${result.section4.dprProjectCost || "—"} · tariff ${
    result.section4.tariff || "—"
  }`;

  await onProgress?.(98, "Saving…");
  const profilePatch = profilePatchFromSections({
    section4: result.section4 as unknown as Record<string, unknown>,
    existing: plant,
  });
  const updated = await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION4_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      rawExtract: mergeRawExtract(plant.rawExtract, { section4: result }),
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
    section4: result,
  };
}
