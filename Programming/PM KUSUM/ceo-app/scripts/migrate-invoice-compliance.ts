/**
 * Backfill legacy invoices after schema push.
 * Usage: npx tsx scripts/migrate-invoice-compliance.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function fyFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

async function main() {
  const rows = await prisma.invoice.findMany();
  let updated = 0;
  for (const inv of rows) {
    const fy = inv.financialYear || fyFromDate(inv.invoiceDate);
    let seriesCode = inv.seriesCode;
    let sequenceNo = inv.sequenceNo;
    const compact = inv.number.replace(/\s/g, "");
    if (!seriesCode && /^INV-?\d+$/i.test(compact)) {
      seriesCode = "INV";
      const m = compact.match(/(\d+)/);
      sequenceNo = m ? Number(m[1]) : sequenceNo;
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        documentType: inv.documentType || "TAX_INVOICE",
        status: inv.status || "ISSUED",
        financialYear: fy,
        seriesCode,
        sequenceNo,
        placeOfSupplyState: inv.placeOfSupplyState || inv.buyerState,
        placeOfSupplyStateCode:
          inv.placeOfSupplyStateCode || inv.buyerStateCode,
      },
    });
    updated++;
  }

  // Ensure company flags exist (defaults applied by Prisma)
  const company = await prisma.companyProfile.findFirst();
  if (company) {
    console.log(
      `Company AATO=${company.aatoBand} eInvoice=${company.eInvoiceEnabled}`,
    );
  }
  console.log(`Migrated ${updated} invoices`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
