import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { prisma } from "../src/lib/prisma";
import { classifyInvoiceGstEntity } from "../src/lib/ai/classify-gst-entity";

async function main() {
  const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: "asc" } });
  for (const inv of invoices) {
    const c = await classifyInvoiceGstEntity(inv);
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { gstEntity: c.gstEntity },
    });
    console.log(
      `${inv.number}: ${inv.gstEntity ?? "null"} → ${c.gstEntity} [${c.method}, ${c.confidence}] ${c.reason}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
