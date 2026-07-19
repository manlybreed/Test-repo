import { prisma } from "@/lib/prisma";
import { financialYearFromDate } from "@/lib/invoice/financial-year";
import { retentionUntilForDate } from "@/lib/ledgers/retention";
import { writeAuditLog } from "@/lib/ledgers/audit";
import type { Invoice } from "@prisma/client";

export async function postAdvanceFromInvoice(
  invoice: Invoice,
  opts?: { actorUserId?: string | null },
) {
  if (invoice.status !== "ISSUED" && invoice.status !== "CANCELLED") return null;

  const company = await prisma.companyProfile.findFirst();
  const retentionMonths = company?.retentionMonths ?? 72;
  const fy = invoice.financialYear || financialYearFromDate(invoice.invoiceDate);

  if (invoice.status === "CANCELLED") {
    const open = await prisma.advanceLedgerEntry.findMany({
      where: { invoiceId: invoice.id, struckOutAt: null },
    });
    for (const row of open) {
      const updated = await prisma.advanceLedgerEntry.update({
        where: { id: row.id },
        data: {
          struckOutAt: new Date(),
          struckOutReason: invoice.cancelReason || "Document cancelled",
        },
      });
      await writeAuditLog({
        entityType: "AdvanceLedgerEntry",
        entityId: row.id,
        action: "STRIKE",
        before: row,
        after: updated,
        reason: updated.struckOutReason || undefined,
        actorUserId: opts?.actorUserId,
      });
    }
    return null;
  }

  let kind: string | null = null;
  if (invoice.documentType === "RECEIPT_VOUCHER") kind = "RECEIVED";
  else if (invoice.documentType === "REFUND_VOUCHER") kind = "REFUNDED";
  else return null;

  const taxAmount =
    invoice.cgstAmount + invoice.sgstAmount + invoice.igstAmount;

  const existing = await prisma.advanceLedgerEntry.findFirst({
    where: { invoiceId: invoice.id, struckOutAt: null },
  });

  const data = {
    financialYear: fy,
    gstEntity: invoice.gstEntity,
    kind,
    partyName: invoice.buyerName,
    partyGstin: invoice.buyerGstin,
    amount: invoice.taxableTotal,
    taxAmount,
    documentNumber: invoice.number,
    documentDate: invoice.invoiceDate,
    invoiceId: invoice.id,
    source: "DOC",
    retentionUntil: retentionUntilForDate(invoice.invoiceDate, retentionMonths),
  };

  if (existing) {
    const before = { ...existing };
    const updated = await prisma.advanceLedgerEntry.update({
      where: { id: existing.id },
      data,
    });
    await writeAuditLog({
      entityType: "AdvanceLedgerEntry",
      entityId: updated.id,
      action: "UPDATE",
      before,
      after: updated,
      actorUserId: opts?.actorUserId,
    });
    return updated;
  }

  const created = await prisma.advanceLedgerEntry.create({ data });
  await writeAuditLog({
    entityType: "AdvanceLedgerEntry",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actorUserId: opts?.actorUserId,
  });
  return created;
}

/** Net advance received − refunded − adjusted (active rows only) */
export async function advanceBalance(opts?: {
  gstEntity?: string | null;
  financialYear?: string;
}) {
  const where: {
    struckOutAt: null;
    gstEntity?: string;
    financialYear?: string;
  } = { struckOutAt: null };
  if (opts?.gstEntity) where.gstEntity = opts.gstEntity;
  if (opts?.financialYear) where.financialYear = opts.financialYear;

  const rows = await prisma.advanceLedgerEntry.findMany({ where });
  let balance = 0;
  for (const r of rows) {
    if (r.kind === "RECEIVED") balance += r.amount + r.taxAmount;
    else if (r.kind === "REFUNDED" || r.kind === "ADJUSTED" || r.kind === "PAID") {
      balance -= r.amount + r.taxAmount;
    }
  }
  return { balance, count: rows.length };
}
