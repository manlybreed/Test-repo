/**
 * Backfill outward/inward/ITC/advance from existing documents.
 * Usage: npx tsx scripts/backfill-ledgers.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncLedgersForInvoice } from "../src/lib/ledgers/sync";
import { postInwardFromExpense } from "../src/lib/ledgers/inward";

const prisma = new PrismaClient();

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["ISSUED", "CANCELLED"] } },
  });
  let inv = 0;
  for (const row of invoices) {
    await syncLedgersForInvoice(row);
    inv++;
  }

  const expenses = await prisma.expense.findMany({
    where: { status: { not: "STRUCK" } },
  });
  let exp = 0;
  for (const row of expenses) {
    await postInwardFromExpense(row);
    exp++;
  }

  console.log(`Posted ledgers: invoices=${inv} expenses=${exp}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
