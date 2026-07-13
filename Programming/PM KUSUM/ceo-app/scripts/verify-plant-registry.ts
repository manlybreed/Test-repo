import { PrismaClient } from "@prisma/client";
import { DOC_CATALOG_SEED, derivePlantShort } from "../src/lib/projects/doc-catalog";
import { scanPlantFolder, listDirectorSubfolders } from "../src/lib/projects/scan-folder";
import { matchRequirementsToFiles } from "../src/lib/projects/match-docs";

const prisma = new PrismaClient();
const ROOT =
  "/Users/ManlyBreed/OneDrive - TheBluRidge/OneDrive - The BluRidge/Communication site - Documents/Cosine Plant Details";
const SOLAR = `${ROOT}/SOLARSEED AGRI TECH PRIVATE LIMITED`;

function parseHints(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function main() {
  await prisma.appSetting.upsert({
    where: { key: "kusumPlantsRoot" },
    create: { key: "kusumPlantsRoot", value: ROOT },
    update: { value: ROOT },
  });

  if ((await prisma.docTypeCatalog.count()) === 0) {
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
  console.log("catalog", await prisma.docTypeCatalog.count());

  const scan = await scanPlantFolder(SOLAR);
  console.log("folders", scan.foldersPresent.join(", "));
  console.log("docs", scan.documents.length);

  let plant = await prisma.kusumPlant.findFirst({ where: { folderPath: scan.root } });
  if (!plant) {
    plant = await prisma.kusumPlant.create({
      data: {
        name: "SOLARSEED AGRI TECH PRIVATE LIMITED",
        plantShort: derivePlantShort("SOLARSEED AGRI TECH PRIVATE LIMITED"),
        folderPath: scan.root,
        documentsFound: scan.documents.length,
        status: "DRAFT",
      },
    });
  }

  const plantScoped = await prisma.docTypeCatalog.findMany({ where: { scope: "PLANT" } });
  const existingPlant = await prisma.plantDocRequirement.findMany({
    where: { plantId: plant.id, partyId: null },
    select: { catalogId: true },
  });
  const haveP = new Set(existingPlant.map((e) => e.catalogId));
  for (const c of plantScoped) {
    if (haveP.has(c.id)) continue;
    await prisma.plantDocRequirement.create({
      data: { plantId: plant.id, catalogId: c.id, partyId: null },
    });
  }

  const names = await listDirectorSubfolders(SOLAR);
  for (let i = 0; i < names.length; i++) {
    const folderName = names[i];
    const display = folderName
      .split(/[\s_]+/)
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" ");
    const party = await prisma.plantParty.upsert({
      where: { plantId_folderName: { plantId: plant.id, folderName } },
      create: {
        plantId: plant.id,
        name: display,
        folderName,
        role: "DIRECTOR",
        sortOrder: i,
      },
      update: {},
    });
    const partyScoped = await prisma.docTypeCatalog.findMany({ where: { scope: "PARTY" } });
    const existing = await prisma.plantDocRequirement.findMany({
      where: { plantId: plant.id, partyId: party.id },
      select: { catalogId: true },
    });
    const have = new Set(existing.map((e) => e.catalogId));
    for (const c of partyScoped) {
      if (have.has(c.id)) continue;
      await prisma.plantDocRequirement.create({
        data: { plantId: plant.id, catalogId: c.id, partyId: party.id },
      });
    }
  }

  const reqs = await prisma.plantDocRequirement.findMany({
    where: { plantId: plant.id },
    include: { catalog: true, party: true },
  });
  const hits = matchRequirementsToFiles(
    reqs.map((r) => ({
      id: r.id,
      catalogId: r.catalogId,
      partyId: r.partyId,
      partyFolderName: r.party?.folderName,
      partyName: r.party?.name,
      catalog: {
        id: r.catalog.id,
        code: r.catalog.code,
        label: r.catalog.label,
        folderHint: r.catalog.folderHint,
        matchHints: parseHints(r.catalog.matchHints),
        scope: r.catalog.scope,
      },
    })),
    scan.documents,
    { plantShort: plant.plantShort },
  );

  for (const hit of hits) {
    const doc = scan.documents.find((d) => d.relativePath === hit.fileRelativePath);
    await prisma.plantDocRequirement.update({
      where: { id: hit.requirementId },
      data: {
        received: true,
        receivedAt: doc?.mtimeMs ? new Date(doc.mtimeMs) : new Date(),
        fileRelativePath: hit.fileRelativePath,
        source: "IMPORT",
      },
    });
  }

  await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      documentsFound: scan.documents.length,
      extractSummary: `Folders: ${scan.foldersPresent.join(", ")} · matched ${hits.length}/${reqs.length}`,
    },
  });

  console.log("plant", plant.id);
  console.log("matched", hits.length, "/", reqs.length);
  console.log(
    hits
      .slice(0, 20)
      .map((h) => {
        const r = reqs.find((x) => x.id === h.requirementId);
        return `${r?.catalog.code} <- ${h.fileRelativePath}`;
      })
      .join("\n"),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
