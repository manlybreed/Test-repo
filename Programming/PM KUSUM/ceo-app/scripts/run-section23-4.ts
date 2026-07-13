/**
 * Fill Sections 2–3 (Director KYC) and Section 4 (DPR) for a plant.
 * Usage: npx tsx scripts/run-section23-4.ts [plantIdOrName]
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.join(__dirname, "../.env") });
config({ path: path.join(__dirname, "../.env.local"), override: true });

import { PrismaClient } from "@prisma/client";
import { scanPlantFolder } from "../src/lib/projects/scan-folder";
import { runDirectorSection23Checkpoint } from "../src/lib/projects/director-section23";
import { runDprSection4Checkpoint } from "../src/lib/projects/dpr-section4";
import { fillDisclosureSectionsDocx } from "../src/lib/docgen/disclosure-form";
import { writeStorageFile } from "../src/lib/storage";
import type { SpvSection1 } from "../src/lib/projects/spv-section1";

async function main() {
  const prisma = new PrismaClient();
  const arg = process.argv[2];

  const plants = await prisma.kusumPlant.findMany({ orderBy: { updatedAt: "desc" } });
  if (!plants.length) {
    console.error("No plants in DB");
    process.exit(1);
  }

  const plant =
    (arg &&
      plants.find(
        (p) =>
          p.id === arg ||
          p.name.toLowerCase().includes(arg.toLowerCase()) ||
          p.folderPath.toLowerCase().includes(arg.toLowerCase()),
      )) ||
    plants[0];

  console.log(`Plant: ${plant.name}`);
  console.log(`Folder: ${plant.folderPath}`);

  let priorS1: SpvSection1 | undefined;
  if (plant.rawExtract) {
    try {
      const raw = JSON.parse(plant.rawExtract) as {
        section1?: { section1?: SpvSection1 };
      };
      priorS1 = raw.section1?.section1;
    } catch {
      /* ignore */
    }
  }

  const scan = await scanPlantFolder(plant.folderPath);

  console.log("\n===== Sections 2–3 (Director KYC) =====");
  const { result: s23, used: used23 } = await runDirectorSection23Checkpoint(
    scan,
    async (pct, step) => console.log(`[${pct}%] ${step}`),
  );
  console.log("Docs:", used23.map((d) => d.relativePath).join("\n  "));
  console.log(JSON.stringify(s23.section23, null, 2));
  console.log("notes:", s23.notes);
  console.log("confidence:", s23.confidence);

  console.log("\n===== Section 4 (DPR) =====");
  const { result: s4, used: used4 } = await runDprSection4Checkpoint(
    scan,
    async (pct, step) => console.log(`[${pct}%] ${step}`),
  );
  console.log("Docs:", used4.map((d) => d.relativePath).join("\n  "));
  console.log(JSON.stringify(s4.section4, null, 2));
  console.log("notes:", s4.notes);
  console.log("confidence:", s4.confidence);

  const docxBuf = await fillDisclosureSectionsDocx({
    section1: priorS1,
    section23: s23.section23,
    section4: s4.section4,
  });
  const safe = (priorS1?.legalName || plant.name).replace(/[^\w.-]+/g, "_").slice(0, 50);
  const filename = `Disclosure_S23_S4_${safe}_${Date.now()}.docx`;
  const filePath = await writeStorageFile("disclosures", filename, docxBuf);

  const summary = `S2–3: ${s23.section23.directors.length} directors · S4: ${
    s4.section4.capacityAcMw || "?"
  } MW · cost ${s4.section4.dprProjectCost || "—"}`;

  let rawBase: Record<string, unknown> = {};
  if (plant.rawExtract) {
    try {
      rawBase = JSON.parse(plant.rawExtract) as Record<string, unknown>;
    } catch {
      rawBase = {};
    }
  }

  await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION4_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      extractSummary: summary,
      notes: [s23.notes, s4.notes].filter(Boolean).join(" | ") || plant.notes,
      rawExtract: JSON.stringify(
        { ...rawBase, section23: s23, section4: s4 },
        null,
        2,
      ),
    },
  });

  console.log(`\nDOCX: ${filePath}`);
  console.log(`Summary: ${summary}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
