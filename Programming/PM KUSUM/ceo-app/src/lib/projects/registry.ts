import { prisma } from "@/lib/prisma";
import { DOC_CATALOG_SEED } from "./doc-catalog";

const PLANTS_ROOT_KEY = "kusumPlantsRoot";

export async function ensureDocCatalogSeeded(): Promise<void> {
  const count = await prisma.docTypeCatalog.count();
  if (count > 0) return;

  await prisma.docTypeCatalog.createMany({
    data: DOC_CATALOG_SEED.map((s) => ({
      code: s.code,
      docGroup: s.docGroup,
      label: s.label,
      description: s.description ?? null,
      scope: s.scope,
      required: s.required ?? true,
      folderHint: s.folderHint,
      matchHints: JSON.stringify(s.matchHints),
      namePattern: s.namePattern ?? "{plantShort}-{label}",
      sortOrder: s.sortOrder,
    })),
  });
}

export async function getPlantsRoot(): Promise<string | null> {
  const fromEnv = process.env.KUSUM_PLANTS_ROOT?.trim();
  if (fromEnv) return fromEnv;
  const row = await prisma.appSetting.findUnique({ where: { key: PLANTS_ROOT_KEY } });
  return row?.value?.trim() || null;
}

export async function setPlantsRoot(folderPath: string): Promise<string> {
  const trimmed = folderPath.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Plants root path required");
  await prisma.appSetting.upsert({
    where: { key: PLANTS_ROOT_KEY },
    create: { key: PLANTS_ROOT_KEY, value: trimmed },
    update: { value: trimmed },
  });
  return trimmed;
}

export async function materializePlantChecklist(opts: {
  plantId: string;
  partyIds?: string[];
}): Promise<void> {
  await ensurePlantRequirements(opts.plantId);
  for (const partyId of opts.partyIds ?? []) {
    await ensurePartyRequirements(opts.plantId, partyId);
  }
}

/**
 * Materialize plant-scoped checklist rows.
 */
export async function ensurePlantRequirements(plantId: string): Promise<void> {
  await ensureDocCatalogSeeded();
  const catalog = await prisma.docTypeCatalog.findMany();
  const plantScoped = catalog.filter((c) => c.scope === "PLANT");
  const existing = await prisma.plantDocRequirement.findMany({
    where: { plantId, partyId: null },
    select: { catalogId: true },
  });
  const have = new Set(existing.map((e) => e.catalogId));
  for (const c of plantScoped) {
    if (have.has(c.id)) continue;
    await prisma.plantDocRequirement.create({
      data: {
        plantId,
        catalogId: c.id,
        partyId: null,
        applicability: c.required ? "REQUIRED" : "OPTIONAL",
      },
    });
  }
}

export async function ensurePartyRequirements(
  plantId: string,
  partyId: string,
): Promise<void> {
  await ensureDocCatalogSeeded();
  const partyScoped = await prisma.docTypeCatalog.findMany({
    where: { scope: "PARTY" },
  });
  const existing = await prisma.plantDocRequirement.findMany({
    where: { plantId, partyId },
    select: { catalogId: true },
  });
  const have = new Set(existing.map((e) => e.catalogId));
  for (const c of partyScoped) {
    if (have.has(c.id)) continue;
    await prisma.plantDocRequirement.create({
      data: {
        plantId,
        catalogId: c.id,
        partyId,
        applicability: c.required ? "REQUIRED" : "OPTIONAL",
      },
    });
  }
}

export function parseMatchHints(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return [];
}
