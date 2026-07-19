"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { exportLedgerCsv, type LedgerRegister } from "@/lib/ledgers/export";
import { strikeOutwardEntry } from "@/lib/ledgers/outward";
import { strikeInwardEntry } from "@/lib/ledgers/inward";
import { advanceBalance } from "@/lib/ledgers/advance";
import {
  seedFromGstr1Json,
  seedFromGstr2bJson,
  parseInwardCsv,
  seedInwardFromCsvRows,
} from "@/lib/ledgers/portal-seed";
import { syncLedgersForInvoice } from "@/lib/ledgers/sync";
import { postInwardFromExpense } from "@/lib/ledgers/inward";
import { financialYearFromDate } from "@/lib/invoice/financial-year";

function revalidateLedgers() {
  revalidatePath("/ceo/ledgers");
  revalidatePath("/ceo/invoices");
  revalidatePath("/ceo/expenses");
}

export async function listOutwardEntries(opts?: {
  financialYear?: string;
  gstEntity?: string;
  includeStruck?: boolean;
}) {
  await requireCeo();
  return prisma.outwardSupplyEntry.findMany({
    where: {
      ...(opts?.financialYear ? { financialYear: opts.financialYear } : {}),
      ...(opts?.gstEntity ? { gstEntity: opts.gstEntity } : {}),
      ...(opts?.includeStruck ? {} : { struckOutAt: null }),
    },
    orderBy: { documentDate: "desc" },
    take: 500,
  });
}

export async function listInwardEntries(opts?: {
  financialYear?: string;
  gstEntity?: string;
  includeStruck?: boolean;
}) {
  await requireCeo();
  return prisma.inwardSupplyEntry.findMany({
    where: {
      ...(opts?.financialYear ? { financialYear: opts.financialYear } : {}),
      ...(opts?.gstEntity ? { gstEntity: opts.gstEntity } : {}),
      ...(opts?.includeStruck ? {} : { struckOutAt: null }),
    },
    orderBy: { billDate: "desc" },
    take: 500,
  });
}

export async function listItcEntries(opts?: {
  financialYear?: string;
  gstEntity?: string;
}) {
  await requireCeo();
  return prisma.itcLedgerEntry.findMany({
    where: {
      struckOutAt: null,
      ...(opts?.financialYear ? { financialYear: opts.financialYear } : {}),
      ...(opts?.gstEntity ? { gstEntity: opts.gstEntity } : {}),
    },
    orderBy: { periodYm: "desc" },
    take: 500,
  });
}

export async function listAdvanceEntries(opts?: {
  financialYear?: string;
  gstEntity?: string;
}) {
  await requireCeo();
  return prisma.advanceLedgerEntry.findMany({
    where: {
      struckOutAt: null,
      ...(opts?.financialYear ? { financialYear: opts.financialYear } : {}),
      ...(opts?.gstEntity ? { gstEntity: opts.gstEntity } : {}),
    },
    orderBy: { documentDate: "desc" },
    take: 500,
  });
}

export async function listAuditLogs(take = 200) {
  await requireCeo();
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getLedgerSummary(opts?: {
  financialYear?: string;
  gstEntity?: string;
}) {
  await requireCeo();
  const fy = opts?.financialYear;
  const gstEntity = opts?.gstEntity;
  const whereBase = {
    struckOutAt: null as null,
    ...(fy ? { financialYear: fy } : {}),
    ...(gstEntity ? { gstEntity } : {}),
  };

  const [outward, inward, itc, adv] = await Promise.all([
    prisma.outwardSupplyEntry.aggregate({
      where: whereBase,
      _sum: { taxableValue: true, grandTotal: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
      _count: true,
    }),
    prisma.inwardSupplyEntry.aggregate({
      where: whereBase,
      _sum: { taxableValue: true, grandTotal: true },
      _count: true,
    }),
    prisma.itcLedgerEntry.aggregate({
      where: { ...whereBase, status: { in: ["ELIGIBLE", "CLAIMED"] } },
      _sum: { totalItc: true },
      _count: true,
    }),
    advanceBalance({ financialYear: fy, gstEntity }),
  ]);

  const company = await prisma.companyProfile.findFirst();
  return {
    outwardCount: outward._count,
    outwardTaxable: outward._sum.taxableValue || 0,
    outwardGrand: outward._sum.grandTotal || 0,
    outwardTax:
      (outward._sum.cgstAmount || 0) +
      (outward._sum.sgstAmount || 0) +
      (outward._sum.igstAmount || 0),
    inwardCount: inward._count,
    inwardTaxable: inward._sum.taxableValue || 0,
    itcTotal: itc._sum.totalItc || 0,
    itcCount: itc._count,
    advanceBalance: adv.balance,
    maintainsStockLedger: company?.maintainsStockLedger ?? false,
    retentionMonths: company?.retentionMonths ?? 72,
  };
}

export async function exportLedgerAction(input: {
  register: LedgerRegister;
  from?: string;
  to?: string;
  gstEntity?: string;
  financialYear?: string;
}) {
  await requireCeo();
  return exportLedgerCsv(input);
}

export async function strikeLedgerEntryAction(input: {
  register: "outward" | "inward";
  id: string;
  reason: string;
}) {
  await requireCeo();
  if (!input.reason?.trim()) throw new Error("Strike reason required");
  if (input.register === "outward") {
    await strikeOutwardEntry(input.id, input.reason.trim());
  } else {
    await strikeInwardEntry(input.id, input.reason.trim());
  }
  revalidateLedgers();
}

export async function seedPortalJsonAction(input: {
  kind: "GSTR2B" | "GSTR1";
  jsonText: string;
  gstEntity?: string;
}) {
  await requireCeo();
  let json: unknown;
  try {
    json = JSON.parse(input.jsonText);
  } catch {
    throw new Error("Invalid JSON");
  }
  const result =
    input.kind === "GSTR2B"
      ? await seedFromGstr2bJson(json, { gstEntity: input.gstEntity })
      : await seedFromGstr1Json(json, { gstEntity: input.gstEntity });
  revalidateLedgers();
  return result;
}

export async function seedPortalCsvAction(input: {
  csvText: string;
  gstEntity?: string;
}) {
  await requireCeo();
  const rows = parseInwardCsv(input.csvText);
  if (!rows.length) throw new Error("No CSV rows parsed");
  const result = await seedInwardFromCsvRows(rows, {
    gstEntity: input.gstEntity,
  });
  revalidateLedgers();
  return result;
}

/** Backfill ledgers from existing ISSUED invoices + ACTIVE expenses */
export async function backfillLedgersAction() {
  await requireCeo();
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["ISSUED", "CANCELLED"] } },
  });
  let invPosted = 0;
  for (const inv of invoices) {
    await syncLedgersForInvoice(inv);
    invPosted++;
  }

  const expenses = await prisma.expense.findMany({
    where: { status: "ACTIVE" },
  });
  let expPosted = 0;
  for (const exp of expenses) {
    await postInwardFromExpense(exp);
    expPosted++;
  }

  revalidateLedgers();
  return {
    invoices: invPosted,
    expenses: expPosted,
    financialYearHint: financialYearFromDate(new Date()),
  };
}
