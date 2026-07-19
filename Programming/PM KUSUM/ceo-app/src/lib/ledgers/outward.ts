import { prisma } from "@/lib/prisma";
import { financialYearFromDate } from "@/lib/invoice/financial-year";
import { retentionUntilForDate } from "@/lib/ledgers/retention";
import { writeAuditLog } from "@/lib/ledgers/audit";
import type { Invoice } from "@prisma/client";

const OUTWARD_TYPES = new Set([
  "TAX_INVOICE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
]);

export async function postOutwardFromInvoice(
  invoice: Invoice,
  opts?: { actorUserId?: string | null; source?: string },
) {
  if (invoice.status !== "ISSUED" && invoice.status !== "CANCELLED") return null;
  if (!OUTWARD_TYPES.has(invoice.documentType)) return null;

  const company = await prisma.companyProfile.findFirst();
  const retentionMonths = company?.retentionMonths ?? 72;
  const fy = invoice.financialYear || financialYearFromDate(invoice.invoiceDate);
  const source = opts?.source || (invoice.isImported ? "DOC" : "DOC");

  const existing = await prisma.outwardSupplyEntry.findFirst({
    where: {
      invoiceId: invoice.id,
      struckOutAt: null,
    },
  });

  if (invoice.status === "CANCELLED") {
    if (existing) {
      const before = { ...existing };
      const updated = await prisma.outwardSupplyEntry.update({
        where: { id: existing.id },
        data: {
          struckOutAt: new Date(),
          struckOutReason: invoice.cancelReason || "Invoice cancelled",
        },
      });
      await writeAuditLog({
        entityType: "OutwardSupplyEntry",
        entityId: updated.id,
        action: "STRIKE",
        before,
        after: updated,
        reason: updated.struckOutReason || undefined,
        actorUserId: opts?.actorUserId,
      });
      return updated;
    }
    return null;
  }

  const data = {
    financialYear: fy,
    gstEntity: invoice.gstEntity,
    documentType: invoice.documentType,
    documentNumber: invoice.number,
    documentDate: invoice.invoiceDate,
    invoiceId: invoice.id,
    buyerName: invoice.buyerName,
    buyerGstin: invoice.buyerGstin,
    buyerAddress: invoice.buyerAddress,
    placeOfSupplyStateCode:
      invoice.placeOfSupplyStateCode || invoice.buyerStateCode,
    reverseCharge: invoice.reverseCharge,
    taxableValue: invoice.taxableTotal,
    cgstAmount: invoice.cgstAmount,
    sgstAmount: invoice.sgstAmount,
    igstAmount: invoice.igstAmount,
    grandTotal: invoice.grandTotal,
    source,
    retentionUntil: retentionUntilForDate(invoice.invoiceDate, retentionMonths),
  };

  if (existing) {
    const before = { ...existing };
    const updated = await prisma.outwardSupplyEntry.update({
      where: { id: existing.id },
      data,
    });
    await writeAuditLog({
      entityType: "OutwardSupplyEntry",
      entityId: updated.id,
      action: "UPDATE",
      before,
      after: updated,
      actorUserId: opts?.actorUserId,
    });
    return updated;
  }

  const created = await prisma.outwardSupplyEntry.create({ data });
  await writeAuditLog({
    entityType: "OutwardSupplyEntry",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actorUserId: opts?.actorUserId,
  });
  return created;
}

export async function strikeOutwardEntry(
  id: string,
  reason: string,
  actorUserId?: string | null,
) {
  const row = await prisma.outwardSupplyEntry.findUnique({ where: { id } });
  if (!row) throw new Error("Outward entry not found");
  if (row.struckOutAt) throw new Error("Already struck out");
  const updated = await prisma.outwardSupplyEntry.update({
    where: { id },
    data: { struckOutAt: new Date(), struckOutReason: reason },
  });
  await writeAuditLog({
    entityType: "OutwardSupplyEntry",
    entityId: id,
    action: "STRIKE",
    before: row,
    after: updated,
    reason,
    actorUserId,
  });
  return updated;
}
