"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";
import { requireCeoAction as requireCeo } from "@/lib/session";

export type ExpenseInput = {
  date: string;
  vendor: string;
  amount: number;
  category: string;
  subCategory?: string;
  description?: string;
  paymentMode?: string;
  gstAmount?: number;
  gstEntity?: string;
  invoiceNo?: string;
  filePath?: string;
  rawExtract?: string;
  notes?: string;
  needsReview?: boolean;
};

function normalizeGstEntity(v?: string | null) {
  return v === "DEL" || v === "RAJ" ? v : null;
}

export async function createExpense(data: ExpenseInput) {
  await requireCeo();
  const expense = await prisma.expense.create({
    data: {
      date:        new Date(data.date),
      vendor:      data.vendor,
      amount:      new Decimal(data.amount),
      category:    data.category,
      subCategory: data.subCategory,
      description: data.description,
      paymentMode: data.paymentMode,
      gstAmount:   data.gstAmount != null ? new Decimal(data.gstAmount) : null,
      gstEntity:   normalizeGstEntity(data.gstEntity),
      invoiceNo:   data.invoiceNo,
      filePath:    data.filePath,
      rawExtract:  data.rawExtract,
      notes:       data.notes,
      needsReview: data.needsReview ?? false,
    },
  });
  revalidatePath("/ceo/expenses");
  return serializeExpense(expense);
}

export async function updateExpense(id: string, data: Partial<ExpenseInput>) {
  await requireCeo();
  if (!id) throw new Error("Expense ID required");
  const expense = await prisma.expense.update({
    where: { id },
    data: {
      ...(data.date       && { date: new Date(data.date) }),
      ...(data.vendor     && { vendor: data.vendor }),
      ...(data.amount     != null && { amount: new Decimal(data.amount) }),
      ...(data.category   && { category: data.category }),
      ...(data.subCategory !== undefined && { subCategory: data.subCategory }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.paymentMode !== undefined && { paymentMode: data.paymentMode }),
      ...(data.gstAmount  !== undefined && {
        gstAmount: data.gstAmount != null ? new Decimal(data.gstAmount) : null,
      }),
      ...(data.gstEntity  !== undefined && { gstEntity: normalizeGstEntity(data.gstEntity) }),
      ...(data.invoiceNo  !== undefined && { invoiceNo: data.invoiceNo }),
      ...(data.notes      !== undefined && { notes: data.notes }),
      ...(data.needsReview !== undefined && { needsReview: data.needsReview }),
    },
  });
  revalidatePath("/ceo/expenses");
  return serializeExpense(expense);
}

export async function deleteExpense(id: string) {
  await requireCeo();
  if (!id) throw new Error("Expense ID required");
  await prisma.expense.delete({ where: { id } });
  revalidatePath("/ceo/expenses");
}

export async function listExpenses(category?: string) {
  await requireCeo();
  return prisma.expense.findMany({
    where: category ? { category } : undefined,
    orderBy: { date: "desc" },
  });
}

function serializeExpense(e: {
  id: string; date: Date; vendor: string;
  amount: Decimal; category: string; subCategory: string | null;
  description: string | null; paymentMode: string | null;
  gstAmount: Decimal | null; gstEntity: string | null;
  invoiceNo: string | null;
  filePath: string | null; rawExtract: string | null;
  notes: string | null; needsReview: boolean;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:          e.id,
    date:        e.date.toISOString(),
    vendor:      e.vendor,
    amount:      Number(e.amount),
    category:    e.category,
    subCategory: e.subCategory,
    description: e.description,
    paymentMode: e.paymentMode,
    gstAmount:   e.gstAmount != null ? Number(e.gstAmount) : null,
    gstEntity:   e.gstEntity,
    invoiceNo:   e.invoiceNo,
    filePath:    e.filePath,
    rawExtract:  e.rawExtract,
    notes:       e.notes,
    needsReview: e.needsReview,
    createdAt:   e.createdAt.toISOString(),
    updatedAt:   e.updatedAt.toISOString(),
  };
}

export async function getExpenseSummary() {
  await requireCeo();
  const expenses = await prisma.expense.findMany({ orderBy: { date: "desc" } });
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
