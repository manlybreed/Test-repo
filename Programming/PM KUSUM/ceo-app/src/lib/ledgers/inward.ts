import { prisma } from "@/lib/prisma";
import { financialYearFromDate } from "@/lib/invoice/financial-year";
import {
  periodYmFromDate,
  retentionUntilForDate,
} from "@/lib/ledgers/retention";
import { writeAuditLog } from "@/lib/ledgers/audit";
import type { Expense } from "@prisma/client";

/** Categories where ITC is typically blocked / restricted for BluRidge consulting books */
const ITC_BLOCKED_CATEGORIES = new Set([
  "food",
  "personal",
  "entertainment",
  "motor_car",
]);

export function isItcEligibleCategory(category: string, explicit?: boolean | null) {
  if (explicit === false) return false;
  if (explicit === true) return true;
  return !ITC_BLOCKED_CATEGORIES.has(category.toLowerCase());
}

function taxHeadsFromExpense(expense: Expense) {
  const cgst = expense.cgstAmount != null ? Number(expense.cgstAmount) : 0;
  const sgst = expense.sgstAmount != null ? Number(expense.sgstAmount) : 0;
  const igst = expense.igstAmount != null ? Number(expense.igstAmount) : 0;
  const lump = expense.gstAmount != null ? Number(expense.gstAmount) : 0;
  if (cgst || sgst || igst) {
    return { cgst, sgst, igst, totalTax: cgst + sgst + igst };
  }
  // Lump GST → assume IGST if unknown split (portal/seed may refine)
  return { cgst: 0, sgst: 0, igst: lump, totalTax: lump };
}

export async function postInwardFromExpense(
  expense: Expense,
  opts?: { actorUserId?: string | null; source?: string },
) {
  if (expense.status === "STRUCK") {
    const existing = await prisma.inwardSupplyEntry.findFirst({
      where: { expenseId: expense.id, struckOutAt: null },
    });
    if (existing) {
      await strikeInwardEntry(
        existing.id,
        expense.struckOutReason || "Expense struck",
        opts?.actorUserId,
      );
    }
    return null;
  }

  const company = await prisma.companyProfile.findFirst();
  const retentionMonths = company?.retentionMonths ?? 72;
  const fy = financialYearFromDate(expense.date);
  const heads = taxHeadsFromExpense(expense);
  const amount = Number(expense.amount);
  const taxableValue = Math.max(0, amount - heads.totalTax);
  const itcEligible = isItcEligibleCategory(expense.category, expense.itcEligible);

  const data = {
    financialYear: fy,
    gstEntity: expense.gstEntity,
    supplierName: expense.vendor,
    supplierGstin: expense.vendorGstin,
    supplierAddress: expense.vendorAddress,
    billNumber: expense.invoiceNo,
    billDate: expense.date,
    hsn: expense.hsn,
    placeOfSupplyStateCode: expense.placeOfSupplyStateCode,
    reverseCharge: false,
    taxableValue,
    cgstAmount: heads.cgst,
    sgstAmount: heads.sgst,
    igstAmount: heads.igst,
    grandTotal: amount,
    expenseId: expense.id,
    source: opts?.source || "DOC",
    itcEligible,
    retentionUntil: retentionUntilForDate(expense.date, retentionMonths),
  };

  const existing = await prisma.inwardSupplyEntry.findFirst({
    where: { expenseId: expense.id, struckOutAt: null },
  });

  let inward;
  if (existing) {
    const before = { ...existing };
    inward = await prisma.inwardSupplyEntry.update({
      where: { id: existing.id },
      data,
    });
    await writeAuditLog({
      entityType: "InwardSupplyEntry",
      entityId: inward.id,
      action: "UPDATE",
      before,
      after: inward,
      actorUserId: opts?.actorUserId,
    });
  } else {
    inward = await prisma.inwardSupplyEntry.create({ data });
    await writeAuditLog({
      entityType: "InwardSupplyEntry",
      entityId: inward.id,
      action: "CREATE",
      after: inward,
      actorUserId: opts?.actorUserId,
    });
  }

  await postItcFromInward(inward.id, opts?.actorUserId);
  return inward;
}

export async function postItcFromInward(
  inwardEntryId: string,
  actorUserId?: string | null,
) {
  const inward = await prisma.inwardSupplyEntry.findUnique({
    where: { id: inwardEntryId },
  });
  if (!inward || inward.struckOutAt) return null;

  const totalTax = inward.cgstAmount + inward.sgstAmount + inward.igstAmount;
  const status = inward.itcEligible && totalTax > 0 ? "ELIGIBLE" : "INELIGIBLE";
  const periodYm = periodYmFromDate(inward.billDate);

  const existing = await prisma.itcLedgerEntry.findFirst({
    where: { inwardEntryId, struckOutAt: null },
  });

  const data = {
    financialYear: inward.financialYear,
    gstEntity: inward.gstEntity,
    periodYm,
    inwardEntryId: inward.id,
    status,
    cgstAmount: inward.itcEligible ? inward.cgstAmount : 0,
    sgstAmount: inward.itcEligible ? inward.sgstAmount : 0,
    igstAmount: inward.itcEligible ? inward.igstAmount : 0,
    totalItc: inward.itcEligible ? totalTax : 0,
    source: inward.source,
    retentionUntil: inward.retentionUntil,
    notes: inward.itcEligible ? null : "ITC not eligible for this supply",
  };

  if (existing) {
    const before = { ...existing };
    const updated = await prisma.itcLedgerEntry.update({
      where: { id: existing.id },
      data,
    });
    await writeAuditLog({
      entityType: "ItcLedgerEntry",
      entityId: updated.id,
      action: "UPDATE",
      before,
      after: updated,
      actorUserId,
    });
    return updated;
  }

  const created = await prisma.itcLedgerEntry.create({ data });
  await writeAuditLog({
    entityType: "ItcLedgerEntry",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actorUserId,
  });
  return created;
}

export async function strikeInwardEntry(
  id: string,
  reason: string,
  actorUserId?: string | null,
) {
  const row = await prisma.inwardSupplyEntry.findUnique({ where: { id } });
  if (!row) throw new Error("Inward entry not found");
  if (row.struckOutAt) throw new Error("Already struck out");

  const updated = await prisma.inwardSupplyEntry.update({
    where: { id },
    data: { struckOutAt: new Date(), struckOutReason: reason },
  });
  await writeAuditLog({
    entityType: "InwardSupplyEntry",
    entityId: id,
    action: "STRIKE",
    before: row,
    after: updated,
    reason,
    actorUserId,
  });

  const itcRows = await prisma.itcLedgerEntry.findMany({
    where: { inwardEntryId: id, struckOutAt: null },
  });
  for (const itc of itcRows) {
    const struck = await prisma.itcLedgerEntry.update({
      where: { id: itc.id },
      data: { struckOutAt: new Date(), struckOutReason: reason, status: "REVERSED" },
    });
    await writeAuditLog({
      entityType: "ItcLedgerEntry",
      entityId: itc.id,
      action: "STRIKE",
      before: itc,
      after: struck,
      reason,
      actorUserId,
    });
  }
  return updated;
}
