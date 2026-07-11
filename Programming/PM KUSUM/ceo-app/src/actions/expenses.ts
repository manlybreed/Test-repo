"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "@prisma/client/runtime/library";

export type ExpenseInput = {
  date: string;
  vendor: string;
  amount: number;
  category: string;
  subCategory?: string;
  description?: string;
  paymentMode?: string;
  gstAmount?: number;
  invoiceNo?: string;
  filePath?: string;
  rawExtract?: string;
  notes?: string;
  needsReview?: boolean;
};

export async function createExpense(data: ExpenseInput) {
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
      invoiceNo:   data.invoiceNo,
      filePath:    data.filePath,
      rawExtract:  data.rawExtract,
      notes:       data.notes,
      needsReview: data.needsReview ?? false,
    },
  });
  revalidatePath("/ceo/expenses");
  return expense;
}

export async function updateExpense(id: string, data: Partial<ExpenseInput>) {
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
      ...(data.gstAmount  != null && { gstAmount: new Decimal(data.gstAmount) }),
      ...(data.invoiceNo  !== undefined && { invoiceNo: data.invoiceNo }),
      ...(data.notes      !== undefined && { notes: data.notes }),
      ...(data.needsReview !== undefined && { needsReview: data.needsReview }),
    },
  });
  revalidatePath("/ceo/expenses");
  return expense;
}

export async function deleteExpense(id: string) {
  await prisma.expense.delete({ where: { id } });
  revalidatePath("/ceo/expenses");
}

export async function listExpenses(category?: string) {
  return prisma.expense.findMany({
    where: category ? { category } : undefined,
    orderBy: { date: "desc" },
  });
}

export async function getExpenseSummary() {
  const expenses = await prisma.expense.findMany({ orderBy: { date: "desc" } });
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const needsReview = expenses.filter((e) => e.needsReview).length;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount);
  }

  // Month-wise for current year
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = expenses
    .filter((e) => e.date >= thisMonthStart)
    .reduce((s, e) => s + Number(e.amount), 0);

  return { total, thisMonth, byCategory, needsReview, count: expenses.length };
}

