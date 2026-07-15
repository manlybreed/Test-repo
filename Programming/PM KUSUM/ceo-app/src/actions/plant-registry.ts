"use server";

import fs from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import {
  chooseFolderDialog,
  folderDisplayName,
} from "@/lib/projects/pick-folder";
import {
  listDirectorSubfolders,
  scanPlantFolder,
} from "@/lib/projects/scan-folder";
import {
  createPlantFolderUnderRoot,
  ensureDirectorFolder,
  resolveSafePlantPath,
} from "@/lib/projects/plant-folder";
import {
  buildDocFileName,
  derivePlantShort,
} from "@/lib/projects/doc-catalog";
import {
  ensureDocCatalogSeeded,
  ensurePartyRequirements,
  ensurePlantRequirements,
  getPlantsRoot,
  materializePlantChecklist,
  parseMatchHints,
  setPlantsRoot,
} from "@/lib/projects/registry";
import {
  matchRequirementsToFiles,
  type MatchRequirement,
} from "@/lib/projects/match-docs";
import { resolvePlantProfile } from "@/lib/projects/plant-profile";
import { currentUserIsFinanceOwner } from "@/lib/session";
import {
  FINANCE_STAGES,
  FINANCING_VERTICALS,
  computeIncomePlan,
  computeVerticalAverages,
  financeStageProgress,
  fundPerMw,
  isFinanceStage,
  resolveFeePayout,
  verticalTargetIncomeKey,
  type FinanceStage,
  type FinancingVerticalId,
} from "@/lib/projects/finance-pipeline";
import { writeStorageFile } from "@/lib/storage";

function revalidatePlant(id?: string) {
  revalidatePath("/ceo/projects");
  if (id) revalidatePath(`/ceo/projects/${id}`);
}

export async function fetchPlantsRoot(): Promise<string | null> {
  await requireCeo();
  return getPlantsRoot();
}

export async function savePlantsRoot(folderPath: string) {
  await requireCeo();
  const saved = await setPlantsRoot(folderPath);
  revalidatePlant();
  return saved;
}

export async function pickAndSavePlantsRoot() {
  await requireCeo();
  const folder = await chooseFolderDialog("Select OneDrive Cosine Plant Details (plants root)");
  if (!folder) return null;
  return savePlantsRoot(folder);
}

async function syncDirectorsFromDisk(plantId: string, folderPath: string) {
  const names = await listDirectorSubfolders(folderPath);
  const parties = [];
  for (let i = 0; i < names.length; i++) {
    const folderName = names[i];
    const display = folderName
      .split(/[\s_]+/)
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" ");
    const party = await prisma.plantParty.upsert({
      where: { plantId_folderName: { plantId, folderName } },
      create: {
        plantId,
        name: display,
        folderName,
        role: "DIRECTOR",
        sortOrder: i,
      },
      update: { name: display, sortOrder: i },
    });
    await ensurePartyRequirements(plantId, party.id);
    parties.push(party);
  }
  return parties;
}

async function applyImportMatches(plantId: string, plantShort: string | null) {
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const scan = await scanPlantFolder(plant.folderPath);
  const reqs = await prisma.plantDocRequirement.findMany({
    where: { plantId },
    include: {
      catalog: true,
      party: true,
    },
  });

  const matchReqs: MatchRequirement[] = reqs.map((r) => ({
    id: r.id,
    catalogId: r.catalogId,
    partyId: r.partyId,
    partyFolderName: r.party?.folderName ?? null,
    partyName: r.party?.name ?? null,
    catalog: {
      id: r.catalog.id,
      code: r.catalog.code,
      label: r.catalog.label,
      folderHint: r.catalog.folderHint,
      matchHints: parseMatchHints(r.catalog.matchHints),
      scope: r.catalog.scope,
    },
  }));

  const hits = matchRequirementsToFiles(matchReqs, scan.documents, {
    plantShort: plantShort || plant.plantShort,
  });

  const byRel = new Map(scan.documents.map((d) => [d.relativePath, d]));
  let matched = 0;
  for (const hit of hits) {
    const doc = byRel.get(hit.fileRelativePath);
    await prisma.plantDocRequirement.update({
      where: { id: hit.requirementId },
      data: {
        received: true,
        receivedAt: doc?.mtimeMs ? new Date(doc.mtimeMs) : new Date(),
        fileRelativePath: hit.fileRelativePath,
        source: "IMPORT",
      },
    });
    matched++;
  }

  await prisma.kusumPlant.update({
    where: { id: plantId },
    data: {
      documentsFound: scan.documents.length,
      extractSummary: `Folders: ${scan.foldersPresent.join(", ") || "none"} · matched ${matched}/${reqs.length} checklist slots`,
    },
  });

  return { matched, total: reqs.length, documents: scan.documents.length };
}

/** Import / link an existing plant folder (path or picker). */
export async function importPlantFromPath(inputPath?: string) {
  await requireCeo();
  await ensureDocCatalogSeeded();

  let folderPath = inputPath?.trim();
  if (!folderPath) {
    const picked = await chooseFolderDialog("Select plant document folder to import");
    if (!picked) return null;
    folderPath = picked;
  }

  const scan = await scanPlantFolder(folderPath);
  const name = folderDisplayName(scan.root);
  const plantShort = derivePlantShort(name);

  const existing = await prisma.kusumPlant.findFirst({
    where: { folderPath: scan.root },
  });
  if (existing) {
    throw new Error(`This folder is already added as “${existing.name}”.`);
  }

  const plant = await prisma.kusumPlant.create({
    data: {
      name,
      plantShort,
      folderPath: scan.root,
      status: "DRAFT",
      documentsFound: scan.documents.length,
      extractSummary: `Folders: ${scan.foldersPresent.join(", ") || "none"}`,
    },
  });

  await ensurePlantRequirements(plant.id);
  await syncDirectorsFromDisk(plant.id, scan.root);
  await applyImportMatches(plant.id, plantShort);

  revalidatePlant(plant.id);
  return plant;
}

/** Create a new empty plant under the configured OneDrive plants root. */
export async function createPlantInRoot(input: {
  name: string;
  plantShort?: string;
  notes?: string;
}) {
  await requireCeo();
  await ensureDocCatalogSeeded();

  const root = await getPlantsRoot();
  if (!root) {
    throw new Error("Set the plants root folder first (OneDrive Cosine Plant Details).");
  }

  const name = input.name.trim();
  if (!name) throw new Error("Plant name required");
  const plantShort = (input.plantShort?.trim() || derivePlantShort(name)).trim();

  const folderPath = await createPlantFolderUnderRoot(root, name);

  const plant = await prisma.kusumPlant.create({
    data: {
      name,
      plantShort,
      folderPath,
      status: "DRAFT",
      documentsFound: 0,
      notes: input.notes?.trim() || null,
      extractSummary: "Created empty pack under plants root",
    },
  });

  await ensurePlantRequirements(plant.id);
  revalidatePlant(plant.id);
  return plant;
}

export async function addDirectorToPlant(plantId: string, directorName: string) {
  await requireCeo();
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const name = directorName.trim();
  if (!name) throw new Error("Director name required");
  const folderName = name.toUpperCase();

  await ensureDirectorFolder(plant.folderPath, folderName);
  const count = await prisma.plantParty.count({ where: { plantId } });
  const party = await prisma.plantParty.create({
    data: {
      plantId,
      name,
      folderName,
      role: "DIRECTOR",
      sortOrder: count,
    },
  });
  await ensurePartyRequirements(plantId, party.id);
  revalidatePlant(plantId);
  return party;
}

export async function rescanAndMatchPlant(plantId: string) {
  await requireCeo();
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  await ensurePlantRequirements(plantId);
  await syncDirectorsFromDisk(plantId, plant.folderPath);
  const result = await applyImportMatches(plantId, plant.plantShort);
  revalidatePlant(plantId);
  return result;
}

export async function listPlantFiles(plantId: string) {
  await requireCeo();
  const plant = await prisma.kusumPlant.findUniqueOrThrow({ where: { id: plantId } });
  const scan = await scanPlantFolder(plant.folderPath);
  return {
    root: scan.root,
    foldersPresent: scan.foldersPresent,
    foldersMissing: scan.foldersMissing,
    files: scan.documents.map((d) => ({
      category: d.category,
      relativePath: d.relativePath,
      size: d.size,
      ext: d.ext,
      mtimeMs: d.mtimeMs ?? null,
    })),
  };
}

export async function getPlantChecklist(plantId: string) {
  await requireCeo();
  await ensurePlantRequirements(plantId);
  const rows = await prisma.plantDocRequirement.findMany({
    where: { plantId },
    include: {
      catalog: true,
      party: true,
    },
    orderBy: [{ catalog: { sortOrder: "asc" } }, { party: { sortOrder: "asc" } }],
  });

  // Tick is derived from file presence — keep DB in sync when drifted.
  const drifted = rows.filter(
    (r) => Boolean(r.fileRelativePath) !== r.received,
  );
  if (drifted.length > 0) {
    await Promise.all(
      drifted.map((r) => {
        const hasFile = Boolean(r.fileRelativePath);
        return prisma.plantDocRequirement.update({
          where: { id: r.id },
          data: {
            received: hasFile,
            receivedAt: hasFile ? r.receivedAt ?? new Date() : null,
          },
        });
      }),
    );
  }

  return rows.map((r) => {
    const hasFile = Boolean(r.fileRelativePath);
    return {
      id: r.id,
      received: hasFile,
      receivedAt: hasFile
        ? (r.receivedAt?.toISOString() ?? new Date().toISOString())
        : null,
      fileRelativePath: r.fileRelativePath,
      source: r.source,
      notes: r.notes,
      applicability: (r.applicability === "OPTIONAL" || r.applicability === "NA"
        ? r.applicability
        : "REQUIRED") as "REQUIRED" | "OPTIONAL" | "NA",
      partyId: r.partyId,
      partyName: r.party?.name ?? null,
      partyFolderName: r.party?.folderName ?? null,
      catalog: {
        code: r.catalog.code,
        docGroup: r.catalog.docGroup,
        label: r.catalog.label,
        description: r.catalog.description,
        scope: r.catalog.scope,
        required: r.catalog.required,
        folderHint: r.catalog.folderHint,
      },
    };
  });
}

/** Unlink (and optionally delete) the file on a checklist slot. Tick clears automatically. */
export async function clearRequirementFile(
  requirementId: string,
  options?: { deleteFromDisk?: boolean },
) {
  await requireCeo();
  const req = await prisma.plantDocRequirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { plant: true },
  });

  if (options?.deleteFromDisk && req.fileRelativePath) {
    try {
      const abs = resolveSafePlantPath(
        req.plant.folderPath,
        req.fileRelativePath,
      );
      await fs.unlink(abs);
    } catch {
      // File may already be gone from disk — still clear the slot.
    }
  }

  const row = await prisma.plantDocRequirement.update({
    where: { id: requirementId },
    data: {
      received: false,
      receivedAt: null,
      fileRelativePath: null,
      source: null,
    },
  });

  const scan = await scanPlantFolder(req.plant.folderPath);
  await prisma.kusumPlant.update({
    where: { id: req.plantId },
    data: { documentsFound: scan.documents.length },
  });

  revalidatePlant(row.plantId);
  return row;
}

export async function exportChecklistCsv(plantId: string): Promise<string> {
  await requireCeo();
  const rows = await getPlantChecklist(plantId);
  const header = [
    "docGroup",
    "label",
    "description",
    "party",
    "received",
    "receivedAt",
    "fileRelativePath",
    "source",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.catalog.docGroup,
        r.catalog.label,
        r.catalog.description || "",
        r.partyName || "",
        r.received ? "yes" : "no",
        r.receivedAt || "",
        r.fileRelativePath || "",
        r.source || "",
      ]
        .map((x) => escape(String(x)))
        .join(","),
    );
  }
  return lines.join("\n");
}

/** Upload a file into a checklist slot (writes into plant OneDrive folder). */
export async function uploadRequirementFile(formData: FormData) {
  await requireCeo();
  const requirementId = String(formData.get("requirementId") || "");
  const file = formData.get("file") as File | null;
  if (!requirementId || !file) throw new Error("requirementId and file required");

  const req = await prisma.plantDocRequirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { catalog: true, party: true, plant: true },
  });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || ".pdf";
  const fileName = buildDocFileName({
    pattern: req.catalog.namePattern || "{plantShort}-{label}",
    plantShort: req.plant.plantShort || derivePlantShort(req.plant.name),
    partyName: req.party?.name,
    label: req.catalog.label,
    ext,
  });

  const folderHint = req.catalog.folderHint;
  const relDir = req.party
    ? path.join(folderHint, req.party.folderName)
    : folderHint;
  await fs.mkdir(path.join(req.plant.folderPath, relDir), { recursive: true });
  const relativePath = path.join(relDir, fileName);
  const abs = resolveSafePlantPath(req.plant.folderPath, relativePath);
  await fs.writeFile(abs, buf);

  await prisma.plantDocRequirement.update({
    where: { id: requirementId },
    data: {
      received: true,
      receivedAt: new Date(),
      fileRelativePath: relativePath,
      source: "UPLOAD",
    },
  });

  const scan = await scanPlantFolder(req.plant.folderPath);
  await prisma.kusumPlant.update({
    where: { id: req.plantId },
    data: { documentsFound: scan.documents.length },
  });

  revalidatePlant(req.plantId);
  return { relativePath };
}

export async function getPlantDetail(plantId: string) {
  await requireCeo();
  const plant = await prisma.kusumPlant.findUnique({
    where: { id: plantId },
    include: {
      parties: { orderBy: { sortOrder: "asc" } },
      requirements: {
        include: { catalog: true, party: true },
      },
    },
  });
  if (!plant) return null;

  const received = plant.requirements.filter((r) => r.received).length;
  const total = plant.requirements.length;
  const showFees = await currentUserIsFinanceOwner();

  return {
    id: plant.id,
    name: plant.name,
    plantShort: plant.plantShort,
    folderPath: plant.folderPath,
    status: plant.status,
    documentsFound: plant.documentsFound,
    extractSummary: plant.extractSummary,
    disclosureFilePath: plant.disclosureFilePath,
    notes: plant.notes,
    rawExtract: plant.rawExtract,
    capacityMw: plant.capacityMw,
    tehsil: plant.tehsil,
    district: plant.district,
    dprName: plant.dprName,
    epcName: plant.epcName,
    tariff: plant.tariff,
    bankName: plant.bankName,
    activeStatus: plant.activeStatus,
    ...(showFees
      ? {
          feePercent: plant.feePercent,
          feeFlat: plant.feeFlat,
          sanctionAmount: plant.sanctionAmount,
        }
      : {}),
    interestRate: plant.interestRate,
    financeStage: isFinanceStage(plant.financeStage)
      ? plant.financeStage
      : "DOCUMENTATION",
    financeProgress: financeStageProgress(plant.financeStage),
    docsCompleteAt: plant.docsCompleteAt?.toISOString() ?? null,
    mailSentAt: plant.mailSentAt?.toISOString() ?? null,
    fieldVisitAt: plant.fieldVisitAt?.toISOString() ?? null,
    cmaAt: plant.cmaAt?.toISOString() ?? null,
    sanctionAt: plant.sanctionAt?.toISOString() ?? null,
    disbursementAt: plant.disbursementAt?.toISOString() ?? null,
    sanctionLetterPath: plant.sanctionLetterPath,
    updatedAt: plant.updatedAt.toISOString(),
    parties: plant.parties.map((p) => ({
      id: p.id,
      name: p.name,
      folderName: p.folderName,
      role: p.role,
    })),
    checklistProgress: { received, total },
  };
}

export async function listPlantsWithProgress() {
  await requireCeo();
  await ensureDocCatalogSeeded();
  const showFees = await currentUserIsFinanceOwner();
  const plants = await prisma.kusumPlant.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      requirements: {
        select: {
          received: true,
          applicability: true,
          catalog: { select: { required: true } },
        },
      },
    },
  });
  return plants.map((p) => {
    const requiredRows = p.requirements.filter((r) => {
      if (r.applicability === "NA") return false;
      if (r.applicability === "OPTIONAL") return false;
      if (r.applicability === "REQUIRED") return true;
      return r.catalog.required;
    });
    const received = requiredRows.filter((r) => r.received).length;
    const profile = resolvePlantProfile(p);
    const feePercent = p.feePercent;
    const feeFlat = p.feeFlat;
    const sanctionAmount = p.sanctionAmount;
    const feeAmount = resolveFeePayout({
      feePercent,
      feeFlat,
      sanctionAmount,
    });
    return {
      id: p.id,
      name: p.name,
      plantShort: p.plantShort,
      folderPath: p.folderPath,
      status: p.status,
      documentsFound: p.documentsFound,
      extractSummary: p.extractSummary,
      disclosureFilePath: p.disclosureFilePath,
      notes: p.notes,
      updatedAt: p.updatedAt.toISOString(),
      checklistReceived: received,
      checklistRequired: requiredRows.length,
      capacityMw: profile.capacityMw,
      tehsil: profile.tehsil,
      district: profile.district,
      dprName: profile.dprName,
      epcName: profile.epcName,
      tariff: profile.tariff,
      bankName: profile.bankName,
      activeStatus: profile.activeStatus,
      interestRate: p.interestRate,
      financeStage: isFinanceStage(p.financeStage) ? p.financeStage : "DOCUMENTATION",
      financeProgress: financeStageProgress(p.financeStage),
      docsCompleteAt: p.docsCompleteAt?.toISOString() ?? null,
      mailSentAt: p.mailSentAt?.toISOString() ?? null,
      fieldVisitAt: p.fieldVisitAt?.toISOString() ?? null,
      cmaAt: p.cmaAt?.toISOString() ?? null,
      sanctionAt: p.sanctionAt?.toISOString() ?? null,
      disbursementAt: p.disbursementAt?.toISOString() ?? null,
      sanctionLetterPath: p.sanctionLetterPath,
      fundPerMw: fundPerMw(p.sanctionAmount, profile.capacityMw),
      ...(showFees
        ? {
            feePercent,
            feeFlat,
            sanctionAmount,
            feeAmount,
          }
        : {}),
    };
  });
}

export async function updatePlantProfile(
  plantId: string,
  patch: {
    capacityMw?: string | null;
    tehsil?: string | null;
    district?: string | null;
    dprName?: string | null;
    epcName?: string | null;
    tariff?: string | null;
    bankName?: string | null;
    activeStatus?: "ACTIVE" | "INACTIVE";
    feePercent?: number | null;
    feeFlat?: number | null;
    sanctionAmount?: number | null;
    interestRate?: number | null;
  },
) {
  await requireCeo();
  const clean = (v: string | null | undefined) => {
    if (v == null) return null;
    const t = v.trim();
    return t || null;
  };

  const feePatch: {
    feePercent?: number | null;
    feeFlat?: number | null;
    sanctionAmount?: number | null;
  } = {};
  if (
    patch.feePercent !== undefined ||
    patch.feeFlat !== undefined ||
    patch.sanctionAmount !== undefined
  ) {
    const { requireFinanceOwnerAction } = await import("@/lib/session");
    await requireFinanceOwnerAction();
    if (patch.feePercent !== undefined) feePatch.feePercent = patch.feePercent;
    if (patch.feeFlat !== undefined) feePatch.feeFlat = patch.feeFlat;
    if (patch.sanctionAmount !== undefined) {
      feePatch.sanctionAmount = patch.sanctionAmount;
    }
  }

  await prisma.kusumPlant.update({
    where: { id: plantId },
    data: {
      ...(patch.capacityMw !== undefined ? { capacityMw: clean(patch.capacityMw) } : {}),
      ...(patch.tehsil !== undefined ? { tehsil: clean(patch.tehsil) } : {}),
      ...(patch.district !== undefined ? { district: clean(patch.district) } : {}),
      ...(patch.dprName !== undefined ? { dprName: clean(patch.dprName) } : {}),
      ...(patch.epcName !== undefined ? { epcName: clean(patch.epcName) } : {}),
      ...(patch.tariff !== undefined ? { tariff: clean(patch.tariff) } : {}),
      ...(patch.bankName !== undefined ? { bankName: clean(patch.bankName) } : {}),
      ...(patch.activeStatus !== undefined
        ? { activeStatus: patch.activeStatus }
        : {}),
      ...(patch.interestRate !== undefined
        ? { interestRate: patch.interestRate }
        : {}),
      ...feePatch,
    },
  });
  revalidatePlant(plantId);
  return { ok: true };
}

export async function listPlantFileComments(plantId: string) {
  await requireCeo();
  const rows = await prisma.plantFileComment.findMany({
    where: { plantId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    relativePath: r.relativePath,
    comment: r.comment,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertPlantFileComment(
  plantId: string,
  relativePath: string,
  comment: string,
) {
  await requireCeo();
  const plant = await prisma.kusumPlant.findUnique({ where: { id: plantId } });
  if (!plant) throw new Error("Plant not found");
  // Validate path stays inside plant folder (even if file was removed).
  resolveSafePlantPath(plant.folderPath, relativePath);

  const trimmed = comment.trim();
  if (!trimmed) {
    await prisma.plantFileComment.deleteMany({
      where: { plantId, relativePath },
    });
    revalidatePlant(plantId);
    return null;
  }

  const row = await prisma.plantFileComment.upsert({
    where: { plantId_relativePath: { plantId, relativePath } },
    create: { plantId, relativePath, comment: trimmed },
    update: { comment: trimmed },
  });
  revalidatePlant(plantId);
  return {
    id: row.id,
    relativePath: row.relativePath,
    comment: row.comment,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateRequirementNotes(
  requirementId: string,
  notes: string,
) {
  await requireCeo();
  const row = await prisma.plantDocRequirement.update({
    where: { id: requirementId },
    data: { notes: notes.trim() || null },
  });
  revalidatePlant(row.plantId);
  return row;
}

export type PlantTaskInput = {
  title: string;
  description?: string;
  urgency?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reminderAt?: string | null;
  reminderTone?: "GENTLE" | "NORMAL" | "URGENT";
  status?: "TODO" | "IN_PROGRESS" | "DONE";
};

export async function listPlantTasks(plantId: string) {
  await requireCeo();
  const rows = await prisma.plantTask.findMany({
    where: { plantId },
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    urgency: r.urgency as PlantTaskInput["urgency"],
    reminderAt: r.reminderAt?.toISOString() ?? null,
    reminderTone: r.reminderTone as PlantTaskInput["reminderTone"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createPlantTask(plantId: string, input: PlantTaskInput) {
  await requireCeo();
  const title = input.title.trim();
  if (!title) throw new Error("Task title required");

  const row = await prisma.plantTask.create({
    data: {
      plantId,
      title,
      description: input.description?.trim() || null,
      urgency: input.urgency || "MEDIUM",
      reminderTone: input.reminderTone || "NORMAL",
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      status: input.status || "TODO",
    },
  });
  revalidatePlant(plantId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    urgency: row.urgency,
    reminderAt: row.reminderAt?.toISOString() ?? null,
    reminderTone: row.reminderTone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updatePlantTask(
  taskId: string,
  input: Partial<PlantTaskInput>,
) {
  await requireCeo();
  const existing = await prisma.plantTask.findUniqueOrThrow({
    where: { id: taskId },
  });

  const row = await prisma.plantTask.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      ...(input.urgency !== undefined ? { urgency: input.urgency } : {}),
      ...(input.reminderTone !== undefined
        ? { reminderTone: input.reminderTone }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.reminderAt !== undefined
        ? {
            reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
          }
        : {}),
    },
  });
  revalidatePlant(existing.plantId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    urgency: row.urgency,
    reminderAt: row.reminderAt?.toISOString() ?? null,
    reminderTone: row.reminderTone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deletePlantTask(taskId: string) {
  await requireCeo();
  const row = await prisma.plantTask.delete({ where: { id: taskId } });
  revalidatePlant(row.plantId);
  return { ok: true };
}

export async function setRequirementApplicability(
  requirementId: string,
  applicability: "REQUIRED" | "OPTIONAL" | "NA",
) {
  await requireCeo();
  // Skip page revalidation — checklist UI updates optimistically.
  return prisma.plantDocRequirement.update({
    where: { id: requirementId },
    data: { applicability },
  });
}

export type CatalogItemInput = {
  code?: string;
  docGroup: string;
  label: string;
  description?: string;
  scope?: "PLANT" | "PARTY";
  required?: boolean;
  folderHint: string;
  matchHints?: string[];
  namePattern?: string;
  sortOrder?: number;
};

export async function listDocCatalog() {
  await requireCeo();
  await ensureDocCatalogSeeded();
  const rows = await prisma.docTypeCatalog.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    docGroup: r.docGroup,
    label: r.label,
    description: r.description,
    scope: r.scope as "PLANT" | "PARTY",
    required: r.required,
    folderHint: r.folderHint,
    matchHints: parseMatchHints(r.matchHints),
    namePattern: r.namePattern,
    sortOrder: r.sortOrder,
  }));
}

function slugCode(group: string, label: string): string {
  const g = group.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().slice(0, 12);
  const l = label.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().slice(0, 24);
  return `${g}_${l}_${Date.now().toString(36).toUpperCase()}`.slice(0, 60);
}

export async function createDocCatalogItem(input: CatalogItemInput) {
  await requireCeo();
  const label = input.label.trim();
  const docGroup = input.docGroup.trim().toUpperCase();
  if (!label || !docGroup) throw new Error("Group and label required");
  const folderHint = input.folderHint.trim() || docGroup;
  const code = (input.code?.trim() || slugCode(docGroup, label)).toUpperCase();

  const maxSort = await prisma.docTypeCatalog.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.docTypeCatalog.create({
    data: {
      code,
      docGroup,
      label,
      description: input.description?.trim() || null,
      scope: input.scope || "PLANT",
      required: input.required ?? true,
      folderHint,
      matchHints: JSON.stringify(input.matchHints ?? [label.toLowerCase()]),
      namePattern:
        input.namePattern ||
        (input.scope === "PARTY" ? "{partyName}-{label}" : "{plantShort}-{label}"),
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 10,
    },
  });

  // Materialize onto existing plants
  const plants = await prisma.kusumPlant.findMany({ select: { id: true } });
  for (const p of plants) {
    await ensurePlantRequirements(p.id);
    if (row.scope === "PARTY") {
      const parties = await prisma.plantParty.findMany({
        where: { plantId: p.id },
        select: { id: true },
      });
      for (const party of parties) {
        await ensurePartyRequirements(p.id, party.id);
      }
    }
  }

  revalidatePath("/ceo/projects");
  return row;
}

export async function updateDocCatalogItem(
  id: string,
  input: Partial<CatalogItemInput>,
) {
  await requireCeo();
  const row = await prisma.docTypeCatalog.update({
    where: { id },
    data: {
      ...(input.docGroup !== undefined
        ? { docGroup: input.docGroup.trim().toUpperCase() }
        : {}),
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.folderHint !== undefined
        ? { folderHint: input.folderHint.trim() }
        : {}),
      ...(input.matchHints !== undefined
        ? { matchHints: JSON.stringify(input.matchHints) }
        : {}),
      ...(input.namePattern !== undefined
        ? { namePattern: input.namePattern.trim() }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  revalidatePath("/ceo/projects");
  return row;
}

export async function deleteDocCatalogItem(id: string) {
  await requireCeo();
  await prisma.docTypeCatalog.delete({ where: { id } });
  revalidatePath("/ceo/projects");
  return { ok: true };
}

export async function syncCatalogToAllPlants() {
  await requireCeo();
  await ensureDocCatalogSeeded();
  const plants = await prisma.kusumPlant.findMany({
    include: { parties: { select: { id: true } } },
  });
  for (const p of plants) {
    await materializePlantChecklist({
      plantId: p.id,
      partyIds: p.parties.map((x) => x.id),
    });
  }
  revalidatePath("/ceo/projects");
  return { plants: plants.length };
}

function isoOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function updatePlantFinancePipeline(
  plantId: string,
  patch: {
    financeStage?: FinanceStage;
    docsCompleteAt?: string | null;
    mailSentAt?: string | null;
    fieldVisitAt?: string | null;
    cmaAt?: string | null;
    sanctionAt?: string | null;
    disbursementAt?: string | null;
    interestRate?: number | null;
  },
) {
  await requireCeo();
  const data: Record<string, unknown> = {};

  if (patch.financeStage !== undefined) {
    if (!isFinanceStage(patch.financeStage)) {
      throw new Error("Invalid finance stage");
    }
    data.financeStage = patch.financeStage;
    const now = new Date();
    const idx = FINANCE_STAGES.indexOf(patch.financeStage);
    // Auto-stamp milestone dates when advancing stage (only if empty)
    const plant = await prisma.kusumPlant.findUniqueOrThrow({
      where: { id: plantId },
    });
    const stampIfEmpty = (
      key:
        | "docsCompleteAt"
        | "mailSentAt"
        | "fieldVisitAt"
        | "cmaAt"
        | "sanctionAt"
        | "disbursementAt",
      existing: Date | null,
    ) => {
      if (!existing && patch[key] === undefined) data[key] = now;
    };
    if (idx >= 0) stampIfEmpty("docsCompleteAt", plant.docsCompleteAt);
    if (idx >= 1) stampIfEmpty("mailSentAt", plant.mailSentAt);
    if (idx >= 2) stampIfEmpty("fieldVisitAt", plant.fieldVisitAt);
    if (idx >= 3) stampIfEmpty("cmaAt", plant.cmaAt);
    if (idx >= 4) stampIfEmpty("sanctionAt", plant.sanctionAt);
    if (idx >= 5) stampIfEmpty("disbursementAt", plant.disbursementAt);
  }

  if (patch.docsCompleteAt !== undefined) {
    data.docsCompleteAt = isoOrNull(patch.docsCompleteAt);
  }
  if (patch.mailSentAt !== undefined) {
    data.mailSentAt = isoOrNull(patch.mailSentAt);
  }
  if (patch.fieldVisitAt !== undefined) {
    data.fieldVisitAt = isoOrNull(patch.fieldVisitAt);
  }
  if (patch.cmaAt !== undefined) data.cmaAt = isoOrNull(patch.cmaAt);
  if (patch.sanctionAt !== undefined) {
    data.sanctionAt = isoOrNull(patch.sanctionAt);
  }
  if (patch.disbursementAt !== undefined) {
    data.disbursementAt = isoOrNull(patch.disbursementAt);
  }
  if (patch.interestRate !== undefined) {
    data.interestRate = patch.interestRate;
  }

  await prisma.kusumPlant.update({ where: { id: plantId }, data });
  revalidatePlant(plantId);
  revalidatePath("/ceo/financing");
  return { ok: true };
}

export async function uploadSanctionLetter(formData: FormData) {
  await requireCeo();
  const plantId = String(formData.get("plantId") || "");
  const file = formData.get("file") as File | null;
  if (!plantId || !file) throw new Error("plantId and file required");

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || ".pdf";
  const storedName = `sanction_${plantId.slice(-8)}_${Date.now()}${ext}`;
  const filePath = await writeStorageFile("sanctions", storedName, buf);

  await prisma.kusumPlant.update({
    where: { id: plantId },
    data: {
      sanctionLetterPath: filePath,
      sanctionAt: new Date(),
      financeStage: "SANCTION",
    },
  });
  revalidatePlant(plantId);
  revalidatePath("/ceo/financing");
  return { filePath };
}

export async function getFinancingDashboard() {
  await requireCeo();
  const showFees = await currentUserIsFinanceOwner();
  const plants = await prisma.kusumPlant.findMany({
    orderBy: { updatedAt: "desc" },
  });

  const verticalKeys = FINANCING_VERTICALS.map((v) =>
    verticalTargetIncomeKey(v.id),
  );
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: verticalKeys } },
  });
  const settingMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const active = plants.filter((p) => p.activeStatus !== "INACTIVE");
  const sanctioned = active.filter(
    (p) =>
      p.financeStage === "SANCTION" ||
      p.financeStage === "DISBURSEMENT" ||
      p.sanctionAmount != null,
  );
  const disbursed = active.filter((p) => p.financeStage === "DISBURSEMENT");

  const totalSanctioned = sanctioned.reduce(
    (s, p) => s + (p.sanctionAmount || 0),
    0,
  );
  const totalDisbursed = disbursed.reduce(
    (s, p) => s + (p.sanctionAmount || 0),
    0,
  );
  const totalMw = active.reduce((s, p) => {
    const mw = Number(String(p.capacityMw || "").replace(/[^\d.]/g, ""));
    return s + (Number.isFinite(mw) ? mw : 0);
  }, 0);
  const sanctionedMw = sanctioned.reduce((s, p) => {
    const mw = Number(String(p.capacityMw || "").replace(/[^\d.]/g, ""));
    return s + (Number.isFinite(mw) ? mw : 0);
  }, 0);

  const rates = active
    .map((p) => p.interestRate)
    .filter((r): r is number => r != null && Number.isFinite(r));
  const avgInterest =
    rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const minInterest = rates.length > 0 ? Math.min(...rates) : null;

  const fundPerMwValues = active
    .map((p) => fundPerMw(p.sanctionAmount, p.capacityMw))
    .filter((v): v is number => v != null);
  const avgFundPerMw =
    fundPerMwValues.length > 0
      ? fundPerMwValues.reduce((a, b) => a + b, 0) / fundPerMwValues.length
      : null;

  const byStage = Object.fromEntries(
    FINANCE_STAGES.map((stage) => [
      stage,
      active.filter((p) => p.financeStage === stage).length,
    ]),
  ) as Record<FinanceStage, number>;

  const incomeEarned = showFees
    ? active.reduce((s, p) => {
        const payout = resolveFeePayout({
          feePercent: p.feePercent,
          feeFlat: p.feeFlat,
          sanctionAmount: p.sanctionAmount,
        });
        return s + (payout ?? 0);
      }, 0)
    : 0;

  const averages = computeVerticalAverages(
    active.map((p) => ({
      capacityMw: p.capacityMw,
      tariff: p.tariff,
      sanctionAmount: showFees ? p.sanctionAmount : null,
      feePercent: showFees ? p.feePercent : null,
      feeFlat: showFees ? p.feeFlat : null,
    })),
  );

  // PM KUSUM is the first vertical; averages come from KusumPlant portfolio.
  const verticals = FINANCING_VERTICALS.map((v) => {
    const targetIncome =
      Number(settingMap[verticalTargetIncomeKey(v.id)] || 0) || 0;
    const plan = computeIncomePlan({
      targetIncome,
      incomeEarned: v.id === "pm-kusum" ? incomeEarned : 0,
      dealsDone: v.id === "pm-kusum" ? sanctioned.length : 0,
      averages: v.id === "pm-kusum" ? averages : computeVerticalAverages([]),
    });
    return {
      id: v.id,
      label: v.label,
      targetIncome,
      averages: v.id === "pm-kusum" ? averages : computeVerticalAverages([]),
      plan,
    };
  });

  const totalTargetIncome = verticals.reduce((s, v) => s + v.targetIncome, 0);
  const totalIncomeEarned = verticals.reduce(
    (s, v) => s + v.plan.incomeEarned,
    0,
  );
  const totalDealsRequired = verticals.reduce(
    (s, v) => s + (v.plan.dealsRequired ?? 0),
    0,
  );
  const totalDealsDone = verticals.reduce((s, v) => s + v.plan.dealsDone, 0);

  const now = Date.now();
  const day = 86400000;
  const recentSanction = (days: number) =>
    active.filter((p) => {
      if (!p.sanctionAt) return false;
      return now - p.sanctionAt.getTime() <= days * day;
    }).length;

  return {
    showFees,
    verticals,
    portfolio: {
      totalTargetIncome,
      totalIncomeEarned,
      totalIncomeGap: Math.max(0, totalTargetIncome - totalIncomeEarned),
      incomePct:
        totalTargetIncome > 0
          ? Math.min(100, (totalIncomeEarned / totalTargetIncome) * 100)
          : 0,
      totalDealsRequired: totalDealsRequired > 0 ? totalDealsRequired : null,
      totalDealsDone,
      totalDealsRemaining:
        totalDealsRequired > 0
          ? Math.max(0, totalDealsRequired - totalDealsDone)
          : null,
    },
    progress: {
      plants: active.length,
      dealsDone: sanctioned.length,
      totalSanctioned: showFees ? totalSanctioned : null,
      totalDisbursed: showFees ? totalDisbursed : null,
      totalMw,
      sanctionedMw,
      avgInterest,
      minInterest,
      avgFundPerMw: showFees ? avgFundPerMw : null,
      totalFees: showFees ? incomeEarned : null,
    },
    growth: {
      sanctions30d: recentSanction(30),
      sanctions90d: recentSanction(90),
    },
    byStage,
    plants: active.map((p) => ({
      id: p.id,
      name: p.name,
      capacityMw: p.capacityMw,
      tariff: p.tariff,
      bankName: p.bankName,
      financeStage: p.financeStage,
      financeProgress: financeStageProgress(p.financeStage),
      sanctionAmount: showFees ? p.sanctionAmount : null,
      interestRate: p.interestRate,
      fundPerMw: showFees ? fundPerMw(p.sanctionAmount, p.capacityMw) : null,
    })),
  };
}

export async function setVerticalTargetIncome(
  verticalId: FinancingVerticalId,
  targetIncome: number,
) {
  await requireCeo();
  if (!FINANCING_VERTICALS.some((v) => v.id === verticalId)) {
    throw new Error("Unknown vertical");
  }
  if (!Number.isFinite(targetIncome) || targetIncome < 0) {
    throw new Error("Invalid target income");
  }
  const key = verticalTargetIncomeKey(verticalId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: String(targetIncome) },
    update: { value: String(targetIncome) },
  });
  revalidatePath("/ceo/financing");
  return { ok: true };
}
