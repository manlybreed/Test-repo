import type { Prisma } from "@prisma/client";
import {
  SERIES_BY_DOCUMENT_TYPE,
  type InvoiceDocumentType,
} from "@/lib/invoice/types";
import { financialYearFromDate, financialYearShort } from "@/lib/invoice/financial-year";

export type NumberAllocation = {
  number: string;
  financialYear: string;
  seriesCode: string;
  sequenceNo: number;
};

function padSeq(n: number): string {
  return String(n).padStart(4, "0");
}

/** Format document number ≤16 chars: INV/2526/0009 */
export function formatDocumentNumber(
  seriesCode: string,
  financialYear: string,
  sequenceNo: number,
): string {
  const fyShort = financialYearShort(financialYear);
  const num = `${seriesCode}/${fyShort}/${padSeq(sequenceNo)}`;
  if (num.length > 16) {
    // Fallback tighter pad
    return `${seriesCode}/${fyShort}/${String(sequenceNo).padStart(3, "0")}`.slice(0, 16);
  }
  return num;
}

export function sequenceKey(seriesCode: string, financialYear: string): string {
  return `${seriesCode}:${financialYear}`;
}

type Tx = Prisma.TransactionClient;

/**
 * Allocate next gapless number for series+FY inside a transaction.
 * For TAX_INVOICE, seeds from legacy INV-XX peak when first used in a FY.
 */
export async function allocateDocumentNumber(
  tx: Tx,
  documentType: InvoiceDocumentType,
  invoiceDate: Date = new Date(),
  opts?: { seedTaxFromLegacy?: boolean },
): Promise<NumberAllocation> {
  const seriesCode = SERIES_BY_DOCUMENT_TYPE[documentType];
  const financialYear = financialYearFromDate(invoiceDate);
  const id = sequenceKey(seriesCode, financialYear);

  let seed = 0;
  if (
    documentType === "TAX_INVOICE" &&
    opts?.seedTaxFromLegacy !== false
  ) {
    const existing = await tx.invoiceSequence.findUnique({ where: { id } });
    if (!existing) {
      const legacy = await tx.invoiceSequence.findUnique({ where: { id: "default" } });
      if (legacy) seed = legacy.lastNum;
      // Also scan max from existing INV-* style numbers
      const recent = await tx.invoice.findMany({
        where: { seriesCode: "INV", financialYear },
        select: { sequenceNo: true },
        orderBy: { sequenceNo: "desc" },
        take: 1,
      });
      if (recent[0]?.sequenceNo != null) {
        seed = Math.max(seed, recent[0].sequenceNo);
      }
    }
  }

  const seq = await tx.invoiceSequence.upsert({
    where: { id },
    create: { id, lastNum: seed + 1 },
    update: { lastNum: { increment: 1 } },
  });

  const sequenceNo = seq.lastNum;
  const number = formatDocumentNumber(seriesCode, financialYear, sequenceNo);

  return { number, financialYear, seriesCode, sequenceNo };
}
