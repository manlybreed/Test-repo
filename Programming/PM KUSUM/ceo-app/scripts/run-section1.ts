/**
 * One-off: fill Section 1 from SPV KYC for a plant (no auth).
 * Usage: npx tsx scripts/run-section1.ts [plantIdOrName]
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.join(__dirname, "../.env") });
config({ path: path.join(__dirname, "../.env.local"), override: true });
import { PrismaClient } from "@prisma/client";
import { scanPlantFolder } from "../src/lib/projects/scan-folder";
import { runSpvSection1Checkpoint } from "../src/lib/projects/spv-section1";
import { fillSection1DisclosureDocx } from "../src/lib/docgen/disclosure-form";
import { writeStorageFile } from "../src/lib/storage";

async function main() {
  const prisma = new PrismaClient();
  const arg = process.argv[2];

  const plants = await prisma.kusumPlant.findMany({
    orderBy: { updatedAt: "desc" },
  });
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
  console.log(`Id: ${plant.id}`);

  const scan = await scanPlantFolder(plant.folderPath);
  console.log(`SPV KYC present: ${scan.foldersPresent.includes("SPV KYC")}`);
  console.log(
    `SPV docs: ${scan.documents.filter((d) => d.category === "SPV KYC").length}`,
  );

  const { result, used } = await runSpvSection1Checkpoint(scan, async (pct, step) => {
    console.log(`[${pct}%] ${step}`);
  });

  console.log("\n=== Documents used ===");
  for (const d of used) console.log(` - ${d.relativePath}`);

  console.log("\n=== Section 1 fields ===");
  console.log(JSON.stringify(result.section1, null, 2));
  console.log(`\nnotes: ${result.notes ?? "—"}`);
  console.log(`confidence: ${result.confidence ?? "—"}`);

  const docxBuf = await fillSection1DisclosureDocx(result.section1);
  const safe = (result.section1.legalName || plant.name)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 50);
  const filename = `Disclosure_Section1_${safe}_${Date.now()}.docx`;
  const filePath = await writeStorageFile("disclosures", filename, docxBuf);

  const summary = `Section 1 (SPV) · ${used.length} docs · ${
    result.section1.legalName || "name?"
  } · CIN ${result.section1.cin || "—"} · PAN ${result.section1.pan || "—"}`;

  await prisma.kusumPlant.update({
    where: { id: plant.id },
    data: {
      status: "SECTION1_READY",
      documentsFound: scan.documents.length,
      disclosureFilePath: filePath,
      extractSummary: summary,
      notes: result.notes ?? plant.notes,
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
