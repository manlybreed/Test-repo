"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { normalizeInvoiceNumber } from "@/lib/upload";
import { type GstEntity } from "@/lib/gst-entities";
import { ensureBilledToParty } from "@/actions/billed-to";
import { reconcileExpenseGstFlags } from "@/lib/expense-gst-check";
import { postInwardFromExpense } from "@/lib/ledgers/inward";
import { isWithinRetention } from "@/lib/ledgers/retention";
import { retentionUntilForDate } from "@/lib/ledgers/retention";

export type ExpenseInput = {
  date: string;
  vendor: string;
  vendorGstin?: string;
  vendorAddress?: string;
  amount: number;
  category: string;
  subCategory?: string;
  description?: string;
  paymentMode?: string;
  gstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  placeOfSupplyStateCode?: string;
  hsn?: string;
  itcEligible?: boolean;
  gstEntity?: string | null;
  invoiceNo?: string;
  billedTo?: string;
  billedToPartyId?: string | null;
  ourGstMentioned?: boolean | null;
  billedGstin?: string | null;
  contentHash?: string;
  filePath?: string;
  rawExtract?: string;
  notes?: string;
  needsReview?: boolean;
  /** When true, save even if a duplicate invoice number / file hash exists. */
  forceDuplicate?: boolean;
};

export type ExpenseDuplicate = {
  id: string;
  vendor: string;
  invoiceNo: string | null;
  amount: number;
  date: string;
  reason: "invoice_number" | "file_hash";
};

function normalizeGstEntity(v?: string | null): GstEntity | null {
  return v === "DEL" || v === "RAJ" ? v : null;
}

function applyGstFields(data: ExpenseInput) {
  const reconciled = reconcileExpenseGstFlags({
    billedTo: data.billedTo,
    ourGstMentioned: data.ourGstMentioned,
    billedGstin: data.billedGstin,
    gstEntity: data.gstEntity,
    description: data.description,
    vendor: data.vendor,
    rawExtract: data.rawExtract,
  });
  // GST entity only when a BluRidge GSTIN is on the bill — never from company name alone.
  return {
    billedTo: reconciled.billedTo ?? data.billedTo ?? null,
    ourGstMentioned: reconciled.ourGstMentioned,
    billedGstin: reconciled.billedGstin,
    gstEntity: reconciled.gstOnBill,
  };
}

async function findExpenseDuplicates(data: ExpenseInput): Promise<ExpenseDuplicate[]> {
  const hits: ExpenseDuplicate[] = [];
  const norm = normalizeInvoiceNumber(data.invoiceNo);

  if (norm) {
    const byNorm = await prisma.expense.findMany({
      where: { invoiceNoNorm: norm },
      orderBy: { date: "desc" },
      take: 5,
    });
    for (const e of byNorm) {
      hits.push({
        id: e.id,
        vendor: e.vendor,
        invoiceNo: e.invoiceNo,
        amount: Number(e.amount),
        date: e.date.toISOString().slice(0, 10),
        reason: "invoice_number",
      });
    }
  }

  if (data.contentHash) {
    const byHash = await prisma.expense.findMany({
      where: { contentHash: data.contentHash },
      orderBy: { date: "desc" },
      take: 5,
    });
    for (const e of byHash) {
      if (hits.some((h) => h.id === e.id)) continue;
      hits.push({
        id: e.id,
        vendor: e.vendor,
        invoiceNo: e.invoiceNo,
        amount: Number(e.amount),
        date: e.date.toISOString().slice(0, 10),
        reason: "file_hash",
      });
    }
  }

  return hits;
}

/** Pre-check for UI before saving an expense. */
export async function checkExpenseDuplicate(input: {
  invoiceNo?: string;
  contentHash?: string;
}): Promise<{ duplicates: ExpenseDuplicate[] }> {
  await requireCeo();
  const duplicates = await findExpenseDuplicates({
    date: new Date().toISOString(),
    vendor: "",
    amount: 0,
    category: "misc",
    invoiceNo: input.invoiceNo,
    contentHash: input.contentHash,
  });
  return { duplicates };
}

export async function createExpense(data: ExpenseInput) {
  await requireCeo();

  const duplicates = await findExpenseDuplicates(data);
  if (duplicates.length && !data.forceDuplicate) {
    const err = new Error(
      `Duplicate expense: invoice already saved (${duplicates[0].invoiceNo || "same file"} — ${duplicates[0].vendor}, ₹${duplicates[0].amount}).`,
    ) as Error & { duplicates?: ExpenseDuplicate[]; code?: string };
    err.code = "DUPLICATE_EXPENSE";
    err.duplicates = duplicates;
    throw err;
  }

  const invoiceNoNorm = normalizeInvoiceNumber(data.invoiceNo) || null;
  const gstFields = applyGstFields(data);
  const gstEntity = gstFields.gstEntity;

  let billedToPartyId: string | null = data.billedToPartyId ?? null;
  const billedTo = gstFields.billedTo;
  if (billedTo?.trim()) {
    billedToPartyId = await ensureBilledToParty({
      rawName: billedTo,
      partyId: billedToPartyId,
    });
  }

  const expense = await prisma.expense.create({
    data: {
      date: new Date(data.date),
      vendor: data.vendor,
      vendorGstin: data.vendorGstin || null,
      vendorAddress: data.vendorAddress || null,
      amount: new Decimal(data.amount),
      category: data.category,
      subCategory: data.subCategory,
      description: data.description,
      paymentMode: data.paymentMode,
      gstAmount: data.gstAmount != null ? new Decimal(data.gstAmount) : null,
      cgstAmount: data.cgstAmount != null ? new Decimal(data.cgstAmount) : null,
      sgstAmount: data.sgstAmount != null ? new Decimal(data.sgstAmount) : null,
      igstAmount: data.igstAmount != null ? new Decimal(data.igstAmount) : null,
      placeOfSupplyStateCode: data.placeOfSupplyStateCode || null,
      hsn: data.hsn || null,
      itcEligible: data.itcEligible ?? true,
      gstEntity,
      invoiceNo: data.invoiceNo || null,
      invoiceNoNorm,
      billedTo,
      billedToPartyId,
      ourGstMentioned: gstFields.ourGstMentioned,
      billedGstin: gstFields.billedGstin,
      contentHash: data.contentHash || null,
      filePath: data.filePath,
      rawExtract: data.rawExtract,
      notes: data.notes,
      needsReview: data.needsReview ?? false,
      status: "ACTIVE",
    },
    include: { billedToParty: true },
  });
  await postInwardFromExpense(expense);
  revalidatePath("/ceo/expenses");
  revalidatePath("/ceo/ledgers");
  return serializeExpense(expense);
}

export async function updateExpense(id: string, data: Partial<ExpenseInput>) {
  await requireCeo();
  if (!id) throw new Error("Expense ID required");

  const invoiceNoNorm =
    data.invoiceNo !== undefined
      ? normalizeInvoiceNumber(data.invoiceNo) || null
      : undefined;

  if (invoiceNoNorm) {
    const clashes = await prisma.expense.findMany({
      where: { invoiceNoNorm, NOT: { id } },
      take: 1,
    });
    if (clashes.length && !data.forceDuplicate) {
      throw new Error(
        `Invoice number already used on another expense (${clashes[0].vendor}, ${clashes[0].invoiceNo}).`,
      );
    }
  }

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) throw new Error("Expense not found");

  const gstTouch =
    data.billedTo !== undefined ||
    data.ourGstMentioned !== undefined ||
    data.billedGstin !== undefined ||
    data.gstEntity !== undefined ||
    data.description !== undefined;

  const gstFields = gstTouch
    ? applyGstFields({
        date: data.date || existing.date.toISOString(),
        vendor: data.vendor || existing.vendor,
        amount: data.amount ?? Number(existing.amount),
        category: data.category || existing.category,
        billedTo: data.billedTo !== undefined ? data.billedTo : existing.billedTo,
        ourGstMentioned:
          data.ourGstMentioned !== undefined
            ? data.ourGstMentioned
            : existing.ourGstMentioned,
        billedGstin:
          data.billedGstin !== undefined ? data.billedGstin : existing.billedGstin,
        gstEntity:
          data.gstEntity !== undefined ? data.gstEntity : existing.gstEntity,
        description:
          data.description !== undefined ? data.description : existing.description,
        rawExtract: existing.rawExtract,
      } as ExpenseInput)
    : null;

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      ...(data.date && { date: new Date(data.date) }),
      ...(data.vendor && { vendor: data.vendor }),
      ...(data.amount != null && { amount: new Decimal(data.amount) }),
      ...(data.category && { category: data.category }),
      ...(data.subCategory !== undefined && { subCategory: data.subCategory }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.paymentMode !== undefined && { paymentMode: data.paymentMode }),
      ...(data.gstAmount !== undefined && {
        gstAmount: data.gstAmount != null ? new Decimal(data.gstAmount) : null,
      }),
      ...(data.cgstAmount !== undefined && {
        cgstAmount: data.cgstAmount != null ? new Decimal(data.cgstAmount) : null,
      }),
      ...(data.sgstAmount !== undefined && {
        sgstAmount: data.sgstAmount != null ? new Decimal(data.sgstAmount) : null,
      }),
      ...(data.igstAmount !== undefined && {
        igstAmount: data.igstAmount != null ? new Decimal(data.igstAmount) : null,
      }),
      ...(data.vendorGstin !== undefined && {
        vendorGstin: data.vendorGstin || null,
      }),
      ...(data.vendorAddress !== undefined && {
        vendorAddress: data.vendorAddress || null,
      }),
      ...(data.placeOfSupplyStateCode !== undefined && {
        placeOfSupplyStateCode: data.placeOfSupplyStateCode || null,
      }),
      ...(data.hsn !== undefined && { hsn: data.hsn || null }),
      ...(data.itcEligible !== undefined && { itcEligible: data.itcEligible }),
      ...(gstFields
        ? {
            gstEntity: gstFields.gstEntity,
            billedTo: gstFields.billedTo,
            ourGstMentioned: gstFields.ourGstMentioned,
            billedGstin: gstFields.billedGstin,
          }
        : {
            ...(data.gstEntity !== undefined && {
              gstEntity: normalizeGstEntity(data.gstEntity),
            }),
            ...(data.billedTo !== undefined && { billedTo: data.billedTo || null }),
            ...(data.ourGstMentioned !== undefined && {
              ourGstMentioned:
                data.ourGstMentioned === null
                  ? null
                  : Boolean(data.ourGstMentioned),
            }),
            ...(data.billedGstin !== undefined && {
              billedGstin: data.billedGstin?.trim().toUpperCase() || null,
            }),
          }),
      ...(data.invoiceNo !== undefined && {
        invoiceNo: data.invoiceNo || null,
        invoiceNoNorm,
      }),
      ...(data.billedToPartyId !== undefined && {
        billedToPartyId: data.billedToPartyId || null,
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.needsReview !== undefined && { needsReview: data.needsReview }),
    },
  });
  await postInwardFromExpense(expense);
  revalidatePath("/ceo/expenses");
  revalidatePath("/ceo/ledgers");
  return serializeExpense(expense);
}

/** Strike-out only — never hard-delete within retention window */
export async function deleteExpense(id: string, reason?: string) {
  await requireCeo();
  if (!id) throw new Error("Expense ID required");
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) throw new Error("Expense not found");

  const until = retentionUntilForDate(existing.date);
  if (isWithinRetention(until)) {
    const struck = await prisma.expense.update({
      where: { id },
      data: {
        status: "STRUCK",
        struckOutAt: new Date(),
        struckOutReason: reason?.trim() || "Struck out by user",
      },
    });
    await postInwardFromExpense(struck);
    revalidatePath("/ceo/expenses");
    revalidatePath("/ceo/ledgers");
    return { struck: true as const };
  }

  // Past retention — still prefer strike over hard delete for audit integrity
  const struck = await prisma.expense.update({
    where: { id },
    data: {
      status: "STRUCK",
      struckOutAt: new Date(),
      struckOutReason: reason?.trim() || "Struck out (past retention)",
    },
  });
  await postInwardFromExpense(struck);
  revalidatePath("/ceo/expenses");
  revalidatePath("/ceo/ledgers");
  return { struck: true as const };
}

export async function listExpenses(category?: string) {
  await requireCeo();
  return prisma.expense.findMany({
    where: {
      status: { not: "STRUCK" },
      ...(category ? { category } : {}),
    },
    orderBy: { date: "desc" },
    include: { billedToParty: { select: { id: true, canonicalName: true } } },
  });
}

function serializeExpense(e: {
  id: string;
  date: Date;
  vendor: string;
  amount: Decimal;
  category: string;
  subCategory: string | null;
  description: string | null;
  paymentMode: string | null;
  gstAmount: Decimal | null;
  gstEntity: string | null;
  invoiceNo: string | null;
  invoiceNoNorm?: string | null;
  billedTo?: string | null;
  billedToPartyId?: string | null;
  billedToParty?: { id: string; canonicalName: string } | null;
  ourGstMentioned?: boolean | null;
  billedGstin?: string | null;
  contentHash?: string | null;
  filePath: string | null;
  rawExtract: string | null;
  notes: string | null;
  needsReview: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    date: e.date.toISOString(),
    vendor: e.vendor,
    amount: Number(e.amount),
    category: e.category,
    subCategory: e.subCategory,
    description: e.description,
    paymentMode: e.paymentMode,
    gstAmount: e.gstAmount != null ? Number(e.gstAmount) : null,
    gstEntity: e.gstEntity,
    invoiceNo: e.invoiceNo,
    billedTo: e.billedTo ?? null,
    billedToPartyId: e.billedToPartyId ?? null,
    billedToCanonical: e.billedToParty?.canonicalName ?? null,
    ourGstMentioned: e.ourGstMentioned ?? null,
    billedGstin: e.billedGstin ?? null,
    contentHash: e.contentHash ?? null,
    filePath: e.filePath,
    rawExtract: e.rawExtract,
    notes: e.notes,
    needsReview: e.needsReview,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function getExpenseSummary() {
  await requireCeo();
  const expenses = await prisma.expense.findMany({
    where: { status: { not: "STRUCK" } },
    orderBy: { date: "desc" },
  });
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const needsReview = expenses.filter((e) => e.needsReview).length;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount);
  }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = expenses
    .filter((e) => e.date >= thisMonthStart)
    .reduce((s, e) => s + Number(e.amount), 0);

  return { total, thisMonth, byCategory, needsReview, count: expenses.length };
}
