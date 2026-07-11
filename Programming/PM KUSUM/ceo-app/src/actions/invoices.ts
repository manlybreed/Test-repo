"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { amountInWordsINR } from "@/lib/utils";
import { renderInvoicePdf } from "@/lib/docgen/invoice";

export type InvoiceLineInput = {
  description: string;
  hsn?: string;
  quantity?: number;
  rate: number;
};

export async function nextInvoiceNumber(): Promise<string> {
  await requireCeo();
  const seq = await prisma.invoiceSequence.upsert({
    where: { id: "default" },
    create: { id: "default", lastNum: 8 },
    update: {},
  });
  const next = seq.lastNum + 1;
  return `INV-${String(next).padStart(2, "0")}`;
}

export async function createInvoice(input: {
  clientId?: string;
  buyerName: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  buyerStateCode?: string;
  invoiceDate?: string;
  remarks?: string;
  lines: InvoiceLineInput[];
  useIgst?: boolean;
}) {
  await requireCeo();

  if (!input.buyerName?.trim()) throw new Error("Buyer name is required");
  if (!input.lines?.length) throw new Error("At least one line item is required");

  const company = await prisma.companyProfile.findFirst();
  if (!company) throw new Error("Company profile not seeded");

  const lines = input.lines.map((l, i) => {
    const qty = l.quantity ?? 1;
    const amount = qty * l.rate;
    return {
      description: l.description,
      hsn: l.hsn || company.hsnDefault,
      quantity: qty,
      rate: l.rate,
      amount,
      sortOrder: i,
    };
  });

  const taxableTotal = lines.reduce((s, l) => s + l.amount, 0);
  const useIgst = Boolean(input.useIgst);
  const cgstAmount = useIgst ? 0 : taxableTotal * 0.09;
  const sgstAmount = useIgst ? 0 : taxableTotal * 0.09;
  const igstAmount = useIgst ? taxableTotal * 0.18 : 0;
  const grandTotal = taxableTotal + cgstAmount + sgstAmount + igstAmount;

  const invoice = await prisma.$transaction(async (tx) => {
    const seq = await tx.invoiceSequence.upsert({
      where: { id: "default" },
      create: { id: "default", lastNum: 8 },
      update: { lastNum: { increment: 1 } },
    });
    const number = `INV-${String(seq.lastNum).padStart(2, "0")}`;

    return tx.invoice.create({
      data: {
        number,
        clientId: input.clientId || null,
        buyerName: input.buyerName.trim(),
        buyerAddress: input.buyerAddress || null,
        buyerGstin: input.buyerGstin || null,
        buyerState: input.buyerState || null,
        buyerStateCode: input.buyerStateCode || null,
        invoiceDate: input.invoiceDate
          ? new Date(input.invoiceDate)
          : new Date(),
        remarks: input.remarks || null,
        taxableTotal,
        cgstAmount,
        sgstAmount,
        igstAmount,
        grandTotal,
        amountInWords: amountInWordsINR(grandTotal),
        lines: { create: lines },
      },
      include: { lines: true },
    });
  });

  const sellerAddress = [company.addressLine1, company.addressLine2]
    .filter(Boolean)
    .join(", ");
  const pdfBuf = await renderInvoicePdf({
    number: invoice.number,
    date: invoice.invoiceDate,
    seller: {
      legalName: company.legalName,
      addressLine1: sellerAddress,
      city: company.city,
      state: company.state,
      stateCode: company.stateCode,
      gstin: company.gstin,
    },
    buyer: {
      name: invoice.buyerName,
      address: invoice.buyerAddress,
      gstin: invoice.buyerGstin,
      state: invoice.buyerState,
      stateCode: invoice.buyerStateCode,
    },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
    })),
    taxableTotal: invoice.taxableTotal,
    cgstAmount: invoice.cgstAmount,
    sgstAmount: invoice.sgstAmount,
    igstAmount: invoice.igstAmount,
    grandTotal: invoice.grandTotal,
    remarks: invoice.remarks,
  });

  const filePath = await writeStorageFile(
    "invoices",
    `${invoice.number}.pdf`,
    pdfBuf,
  );

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { filePath },
  });

  revalidatePath("/ceo/invoices");
  revalidatePath("/ceo");
  return { id: invoice.id, number: invoice.number, filePath, grandTotal };
}

export async function listInvoices(query?: string) {
  await requireCeo();
  return prisma.invoice.findMany({
    where: query
      ? {
          OR: [
            { number: { contains: query, mode: "insensitive" } },
            { buyerName: { contains: query, mode: "insensitive" } },
            { remarks: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}
