"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { amountInWordsINR } from "@/lib/utils";
import { renderInvoicePdf } from "@/lib/docgen/invoice";
import { normalizeGstEntity } from "@/lib/gst-entities";
import { classifyInvoiceGstEntity } from "@/lib/ai/classify-gst-entity";
import { invoiceNumbersMatch } from "@/lib/upload";
import { allocateDocumentNumber } from "@/lib/invoice/numbering";
import { computeInvoiceTax } from "@/lib/invoice/tax-engine";
import { hasBlockingErrors, validateInvoiceDraft } from "@/lib/invoice/validate";
import { invoiceToPdfInput } from "@/lib/invoice/pdf-payload";
import { buildGstr1Export, gstr1ToCsv } from "@/lib/invoice/gstr1";
import {
  buildInv01Payload,
  canGenerateEinvoice,
  submitInv01ToIrp,
} from "@/lib/invoice/einvoice";
import { matchBuyerToClient } from "@/lib/ai/invoice-match";
import { validateInvoiceDraftSmart } from "@/lib/ai/invoice-validate-ai";
import { draftInvoiceFromText } from "@/lib/ai/invoice-draft";
import { adviseRefundPath } from "@/lib/ai/invoice-refund-advise";
import type { InvoiceDocumentType, InvoiceLineCalcInput } from "@/lib/invoice/types";
import { financialYearFromDate } from "@/lib/invoice/financial-year";
import { syncLedgersForInvoice } from "@/lib/ledgers/sync";

export type InvoiceLineInput = InvoiceLineCalcInput;

function revalidateInvoicePaths() {
  revalidatePath("/ceo/invoices");
  revalidatePath("/ceo");
}

async function renderAndStorePdf(
  invoice: Awaited<ReturnType<typeof prisma.invoice.findFirstOrThrow>> & {
    lines: Awaited<ReturnType<typeof prisma.invoiceLine.findMany>>;
    originalInvoice?: Awaited<ReturnType<typeof prisma.invoice.findFirst>> | null;
  },
) {
  const pdfBuf = await renderInvoicePdf(invoiceToPdfInput(invoice));
  const safeName = invoice.number.replace(/\//g, "-");
  const filePath = await writeStorageFile("invoices", `${safeName}.pdf`, pdfBuf);
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { filePath },
  });
  return filePath;
}

export async function previewNextDocumentNumber(
  documentType: InvoiceDocumentType = "TAX_INVOICE",
  invoiceDate?: string,
) {
  await requireCeo();
  const date = invoiceDate ? new Date(invoiceDate) : new Date();
  const fy = financialYearFromDate(date);
  // Read-only peek — does not allocate
  const { SERIES_BY_DOCUMENT_TYPE } = await import("@/lib/invoice/types");
  const { formatDocumentNumber, sequenceKey } = await import("@/lib/invoice/numbering");
  const seriesCode = SERIES_BY_DOCUMENT_TYPE[documentType];
  const seq = await prisma.invoiceSequence.findUnique({
    where: { id: sequenceKey(seriesCode, fy) },
  });
  const next = (seq?.lastNum ?? 0) + 1;
  return formatDocumentNumber(seriesCode, fy, next);
}

/** @deprecated use previewNextDocumentNumber */
export async function nextInvoiceNumber(): Promise<string> {
  return previewNextDocumentNumber("TAX_INVOICE");
}

export async function createInvoice(input: {
  clientId?: string;
  agreementId?: string;
  buyerName: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  buyerStateCode?: string;
  placeOfSupplyState?: string;
  placeOfSupplyStateCode?: string;
  invoiceDate?: string;
  remarks?: string;
  lines: InvoiceLineInput[];
  gstEntity?: string;
  documentType?: InvoiceDocumentType;
  reverseCharge?: boolean;
  /** DRAFT skips numbering/PDF issue; ISSUED (default) allocates and locks */
  status?: "DRAFT" | "ISSUED";
  aiSuggestionLog?: string;
  convertedFromId?: string;
  originalInvoiceId?: string;
}) {
  await requireCeo();

  const documentType: InvoiceDocumentType = input.documentType ?? "TAX_INVOICE";
  const status = input.status ?? "ISSUED";

  const issues = validateInvoiceDraft({
    documentType,
    buyerName: input.buyerName,
    buyerGstin: input.buyerGstin,
    buyerStateCode: input.buyerStateCode,
    placeOfSupplyStateCode:
      input.placeOfSupplyStateCode || input.buyerStateCode,
    gstEntity: input.gstEntity,
    reverseCharge: input.reverseCharge,
    lines: input.lines,
    remarks: input.remarks,
  });

  if (status === "ISSUED" && hasBlockingErrors(issues)) {
    throw new Error(issues.filter((i) => i.level === "error").map((i) => i.message).join(" "));
  }

  const company = await prisma.companyProfile.findFirst();
  if (!company) throw new Error("Company profile not seeded");

  let clientId = input.clientId || null;
  if (!clientId && input.buyerName) {
    const matches = await matchBuyerToClient({
      buyerName: input.buyerName,
      buyerGstin: input.buyerGstin,
    });
    if (matches[0] && matches[0].score >= 0.85) {
      clientId = matches[0].clientId;
    }
  }

  const gstEntity = normalizeGstEntity(input.gstEntity);
  const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
  const posCode =
    input.placeOfSupplyStateCode?.trim() ||
    input.buyerStateCode?.trim() ||
    null;
  const posState = input.placeOfSupplyState?.trim() || input.buyerState || null;

  const tax = computeInvoiceTax({
    gstEntity,
    buyerStateCode: input.buyerStateCode,
    placeOfSupplyStateCode: posCode,
    lines: input.lines,
    defaultHsn: company.hsnDefault,
  });

  const invoice = await prisma.$transaction(async (tx) => {
    let number: string;
    let financialYear: string | null = null;
    let seriesCode: string | null = null;
    let sequenceNo: number | null = null;

    if (status === "ISSUED") {
      const alloc = await allocateDocumentNumber(tx, documentType, invoiceDate);
      number = alloc.number;
      financialYear = alloc.financialYear;
      seriesCode = alloc.seriesCode;
      sequenceNo = alloc.sequenceNo;
    } else {
      number = `DRAFT-${Date.now().toString(36).toUpperCase()}`;
    }

    return tx.invoice.create({
      data: {
        number,
        documentType,
        status,
        financialYear,
        seriesCode,
        sequenceNo,
        clientId,
        agreementId: input.agreementId || null,
        buyerName: input.buyerName.trim(),
        buyerAddress: input.buyerAddress || null,
        buyerGstin: input.buyerGstin || null,
        buyerState: input.buyerState || null,
        buyerStateCode: input.buyerStateCode || null,
        placeOfSupplyState: posState,
        placeOfSupplyStateCode: posCode || tax.placeOfSupplyStateCode,
        reverseCharge: Boolean(input.reverseCharge),
        roundOff: tax.roundOff,
        invoiceDate,
        remarks: input.remarks || null,
        taxableTotal: tax.taxableTotal,
        cgstAmount: tax.cgstAmount,
        sgstAmount: tax.sgstAmount,
        igstAmount: tax.igstAmount,
        grandTotal: tax.grandTotal,
        amountInWords: amountInWordsINR(tax.grandTotal),
        gstEntity,
        paymentStatus: documentType === "TAX_INVOICE" ? "UNPAID" : null,
        aiSuggestionLog: input.aiSuggestionLog || null,
        convertedFromId: input.convertedFromId || null,
        originalInvoiceId: input.originalInvoiceId || null,
        lines: {
          create: tax.lines.map((l) => ({
            description: l.description,
            hsn: l.hsn,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
            taxRate: l.taxRate,
            discount: l.discount,
            uqc: l.uqc,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  let filePath: string | null = null;
  if (status === "ISSUED") {
    filePath = await renderAndStorePdf(invoice);
    await syncLedgersForInvoice(invoice);
  }

  revalidateInvoicePaths();
  return {
    id: invoice.id,
    number: invoice.number,
    filePath,
    grandTotal: invoice.grandTotal,
    status: invoice.status,
    documentType: invoice.documentType,
    validationWarnings: issues.filter((i) => i.level === "warning"),
  };
}

export async function issueDraftInvoice(id: string) {
  await requireCeo();
  const draft = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!draft) throw new Error("Invoice not found");
  if (draft.status !== "DRAFT") throw new Error("Only DRAFT documents can be issued");

  const issues = validateInvoiceDraft({
    documentType: draft.documentType as InvoiceDocumentType,
    buyerName: draft.buyerName,
    buyerGstin: draft.buyerGstin,
    buyerStateCode: draft.buyerStateCode,
    placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
    gstEntity: draft.gstEntity,
    reverseCharge: draft.reverseCharge,
    lines: draft.lines,
    remarks: draft.remarks,
  });
  if (hasBlockingErrors(issues)) {
    throw new Error(issues.filter((i) => i.level === "error").map((i) => i.message).join(" "));
  }

  const issued = await prisma.$transaction(async (tx) => {
    const alloc = await allocateDocumentNumber(
      tx,
      draft.documentType as InvoiceDocumentType,
      draft.invoiceDate,
    );
    return tx.invoice.update({
      where: { id },
      data: {
        status: "ISSUED",
        number: alloc.number,
        financialYear: alloc.financialYear,
        seriesCode: alloc.seriesCode,
        sequenceNo: alloc.sequenceNo,
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  const filePath = await renderAndStorePdf(issued);
  await syncLedgersForInvoice(issued);
  revalidateInvoicePaths();
  return { id: issued.id, number: issued.number, filePath };
}

export async function convertProformaToTaxInvoice(proformaId: string) {
  await requireCeo();
  const pf = await prisma.invoice.findUnique({
    where: { id: proformaId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!pf) throw new Error("Proforma not found");
  if (pf.documentType !== "PROFORMA") throw new Error("Not a proforma");
  if (pf.status !== "ISSUED" && pf.status !== "DRAFT") {
    throw new Error("Proforma not convertible");
  }

  return createInvoice({
    clientId: pf.clientId ?? undefined,
    agreementId: pf.agreementId ?? undefined,
    buyerName: pf.buyerName,
    buyerAddress: pf.buyerAddress ?? undefined,
    buyerGstin: pf.buyerGstin ?? undefined,
    buyerState: pf.buyerState ?? undefined,
    buyerStateCode: pf.buyerStateCode ?? undefined,
    placeOfSupplyState: pf.placeOfSupplyState ?? undefined,
    placeOfSupplyStateCode: pf.placeOfSupplyStateCode ?? undefined,
    remarks: pf.remarks ?? undefined,
    gstEntity: pf.gstEntity ?? undefined,
    reverseCharge: pf.reverseCharge,
    documentType: "TAX_INVOICE",
    status: "ISSUED",
    convertedFromId: pf.id,
    lines: pf.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      taxRate: l.taxRate,
      discount: l.discount,
      uqc: l.uqc,
    })),
  });
}

export type ImportInvoiceInput = {
  invoiceNumber?: string;
  invoiceDate: string;
  dueDate?: string;
  buyerName: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  buyerStateCode?: string;
  serviceDesc?: string;
  lines: {
    description: string;
    hsn?: string;
    quantity?: number;
    rate: number;
    amount: number;
  }[];
  taxableTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
  paymentStatus?: string;
  remarks?: string;
  sourceFilePath?: string;
  rawExtract?: string;
  gstEntity?: string;
  /** When true, recompute tax via engine and regenerate BluRidge PDF as ISSUED */
  normalizeToCompliant?: boolean;
};

export async function importInvoice(input: ImportInvoiceInput) {
  await requireCeo();
  if (!input.buyerName?.trim()) throw new Error("Buyer name is required");

  const matches = await matchBuyerToClient({
    buyerName: input.buyerName,
    buyerGstin: input.buyerGstin,
  });
  const clientId =
    matches[0] && matches[0].score >= 0.8 ? matches[0].clientId : null;

  if (input.normalizeToCompliant !== false) {
    // Prefer compliant path: draft via engine
    const created = await createInvoice({
      clientId: clientId ?? undefined,
      buyerName: input.buyerName,
      buyerAddress: input.buyerAddress,
      buyerGstin: input.buyerGstin,
      buyerState: input.buyerState,
      buyerStateCode: input.buyerStateCode,
      placeOfSupplyState: input.buyerState,
      placeOfSupplyStateCode: input.buyerStateCode,
      invoiceDate: input.invoiceDate,
      remarks: input.remarks,
      gstEntity: input.gstEntity,
      documentType: "TAX_INVOICE",
      status: "ISSUED",
      lines: input.lines.map((l) => ({
        description: l.description,
        hsn: l.hsn,
        quantity: l.quantity ?? 1,
        rate: l.rate,
      })),
      aiSuggestionLog: JSON.stringify({
        importedNumber: input.invoiceNumber,
        rawTaxable: input.taxableTotal,
        rawGrand: input.grandTotal,
      }),
    });

    await prisma.invoice.update({
      where: { id: created.id },
      data: {
        isImported: true,
        sourceFilePath: input.sourceFilePath || null,
        rawExtract: input.rawExtract || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        serviceDesc: input.serviceDesc || null,
        paymentStatus: input.paymentStatus || "UNPAID",
      },
    });

    revalidateInvoicePaths();
    return {
      id: created.id,
      number: created.number,
      grandTotal: created.grandTotal,
    };
  }

  // Legacy preserve-external-number path (rare)
  const invoice = await prisma.$transaction(async (tx) => {
    let number = input.invoiceNumber?.trim();
    if (number) {
      const existsExact = await tx.invoice.findUnique({
        where: { number },
        select: { id: true },
      });
      if (existsExact) number = undefined;
      else {
        const recent = await tx.invoice.findMany({
          select: { number: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        });
        if (recent.some((r) => invoiceNumbersMatch(r.number, number!))) {
          number = undefined;
        }
      }
    }
    if (!number) {
      const alloc = await allocateDocumentNumber(
        tx,
        "TAX_INVOICE",
        new Date(input.invoiceDate),
      );
      number = alloc.number;
    }

    return tx.invoice.create({
      data: {
        number,
        documentType: "TAX_INVOICE",
        status: "ISSUED",
        clientId,
        buyerName: input.buyerName.trim(),
        buyerAddress: input.buyerAddress || null,
        buyerGstin: input.buyerGstin || null,
        buyerState: input.buyerState || null,
        buyerStateCode: input.buyerStateCode || null,
        placeOfSupplyState: input.buyerState || null,
        placeOfSupplyStateCode: input.buyerStateCode || null,
        invoiceDate: new Date(input.invoiceDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        serviceDesc: input.serviceDesc || null,
        remarks: input.remarks || null,
        taxableTotal: input.taxableTotal,
        cgstAmount: input.cgstAmount,
        sgstAmount: input.sgstAmount,
        igstAmount: input.igstAmount,
        grandTotal: input.grandTotal,
        amountInWords: amountInWordsINR(input.grandTotal),
        paymentStatus: input.paymentStatus || "UNPAID",
        gstEntity: normalizeGstEntity(input.gstEntity),
        isImported: true,
        sourceFilePath: input.sourceFilePath || null,
        rawExtract: input.rawExtract || null,
        lines: {
          create: input.lines.map((l, i) => ({
            description: l.description,
            hsn: l.hsn || "998313",
            quantity: l.quantity ?? 1,
            rate: l.rate,
            amount: l.amount,
            sortOrder: i,
          })),
        },
      },
    });
  });

  revalidateInvoicePaths();
  return { id: invoice.id, number: invoice.number, grandTotal: invoice.grandTotal };
}

export async function checkInvoiceNumberExists(number: string) {
  await requireCeo();
  const trimmed = number.trim();
  if (!trimmed) return { exists: false as const };

  const select = {
    number: true,
    buyerName: true,
    invoiceDate: true,
    grandTotal: true,
    paymentStatus: true,
    isImported: true,
  } as const;

  let inv = await prisma.invoice.findUnique({
    where: { number: trimmed },
    select,
  });

  if (!inv) {
    const candidates = await prisma.invoice.findMany({
      select,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    inv = candidates.find((c) => invoiceNumbersMatch(c.number, trimmed)) ?? null;
  }

  if (!inv) return { exists: false as const };
  return {
    exists: true as const,
    invoice: {
      number: inv.number,
      buyerName: inv.buyerName,
      invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
      grandTotal: inv.grandTotal,
      paymentStatus: inv.paymentStatus,
      isImported: inv.isImported,
    },
  };
}

export async function updateInvoicePayment(input: {
  id: string;
  paymentStatus: string;
  tdsDeducted: boolean;
  tdsPercent?: number | null;
}) {
  await requireCeo();
  if (!input.id) throw new Error("Invoice ID required");
  const inv = await prisma.invoice.findUnique({ where: { id: input.id } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "CANCELLED") throw new Error("Cancelled document");

  const valid = ["PAID", "UNPAID", "PARTIAL", "OVERDUE"];
  if (!valid.includes(input.paymentStatus)) throw new Error("Invalid payment status");

  await prisma.invoice.update({
    where: { id: input.id },
    data: {
      paymentStatus: input.paymentStatus,
      tdsDeducted: input.tdsDeducted,
      tdsPercent:
        input.tdsDeducted && input.tdsPercent != null ? input.tdsPercent : null,
      tdsAmount: null,
    },
  });

  revalidateInvoicePaths();
}

/** DRAFT-only hard delete. ISSUED documents cannot be deleted. */
export async function deleteInvoice(id: string) {
  await requireCeo();
  if (!id) throw new Error("Invoice ID required");
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "DRAFT") {
    throw new Error(
      "Issued documents cannot be deleted. Issue a Credit Note / cancel with reason instead.",
    );
  }
  await prisma.invoice.delete({ where: { id } });
  revalidateInvoicePaths();
}

export async function cancelInvoice(id: string, reason: string) {
  await requireCeo();
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "DRAFT") {
    await prisma.invoice.delete({ where: { id } });
  } else if (inv.status === "ISSUED") {
    if (!reason?.trim()) throw new Error("Cancel reason required");
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: reason.trim() },
    });
    await syncLedgersForInvoice(updated);
  }
  revalidateInvoicePaths();
}

export async function createCreditOrDebitNote(input: {
  originalInvoiceId: string;
  noteType: "CREDIT_NOTE" | "DEBIT_NOTE";
  reason: string;
  /** Omit for full; otherwise partial lines */
  lines?: InvoiceLineInput[];
  refundAmount?: number;
  refundDate?: string;
  refundMode?: string;
  refundReference?: string;
}) {
  await requireCeo();
  const original = await prisma.invoice.findUnique({
    where: { id: input.originalInvoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!original) throw new Error("Original invoice not found");
  if (original.documentType !== "TAX_INVOICE") {
    throw new Error("Credit/Debit notes must link to a tax invoice");
  }
  if (original.status !== "ISSUED") {
    throw new Error("Original must be an issued tax invoice");
  }

  const lines: InvoiceLineInput[] =
    input.lines?.length
      ? input.lines
      : original.lines.map((l) => ({
          description: l.description,
          hsn: l.hsn,
          quantity: l.quantity,
          rate: l.rate,
          taxRate: l.taxRate,
          discount: l.discount,
          uqc: l.uqc,
        }));

  const company = await prisma.companyProfile.findFirst();
  const gstEntity = normalizeGstEntity(original.gstEntity);
  const tax = computeInvoiceTax({
    gstEntity,
    buyerStateCode: original.buyerStateCode,
    placeOfSupplyStateCode: original.placeOfSupplyStateCode,
    lines,
    defaultHsn: company?.hsnDefault,
  });

  const note = await prisma.$transaction(async (tx) => {
    const alloc = await allocateDocumentNumber(
      tx,
      input.noteType,
      new Date(),
    );
    return tx.invoice.create({
      data: {
        number: alloc.number,
        documentType: input.noteType,
        status: "ISSUED",
        financialYear: alloc.financialYear,
        seriesCode: alloc.seriesCode,
        sequenceNo: alloc.sequenceNo,
        clientId: original.clientId,
        agreementId: original.agreementId,
        buyerName: original.buyerName,
        buyerAddress: original.buyerAddress,
        buyerGstin: original.buyerGstin,
        buyerState: original.buyerState,
        buyerStateCode: original.buyerStateCode,
        placeOfSupplyState: original.placeOfSupplyState,
        placeOfSupplyStateCode: original.placeOfSupplyStateCode,
        reverseCharge: original.reverseCharge,
        roundOff: tax.roundOff,
        invoiceDate: new Date(),
        remarks: input.reason,
        taxableTotal: tax.taxableTotal,
        cgstAmount: tax.cgstAmount,
        sgstAmount: tax.sgstAmount,
        igstAmount: tax.igstAmount,
        grandTotal: tax.grandTotal,
        amountInWords: amountInWordsINR(tax.grandTotal),
        gstEntity: original.gstEntity,
        originalInvoiceId: original.id,
        refundAmount: input.refundAmount ?? null,
        refundDate: input.refundDate ? new Date(input.refundDate) : null,
        refundMode: input.refundMode || null,
        refundReference: input.refundReference || null,
        refundReason: input.noteType === "CREDIT_NOTE" ? input.reason : null,
        lines: {
          create: tax.lines.map((l) => ({
            description: l.description,
            hsn: l.hsn,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
            taxRate: l.taxRate,
            discount: l.discount,
            uqc: l.uqc,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        originalInvoice: true,
      },
    });
  });

  const filePath = await renderAndStorePdf(note);
  await syncLedgersForInvoice(note);
  revalidateInvoicePaths();
  return { id: note.id, number: note.number, filePath, grandTotal: note.grandTotal };
}

/** GST-compliant refund: creates Credit Note (+ optional payment refund metadata). */
export async function issueRefundViaCreditNote(input: {
  invoiceId: string;
  reason?: string;
  partialAmount?: number;
  refundDate?: string;
  refundMode?: string;
  refundReference?: string;
}) {
  await requireCeo();
  const inv = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!inv) throw new Error("Invoice not found");
  if (inv.documentType !== "TAX_INVOICE" || inv.status !== "ISSUED") {
    throw new Error("Refund via CN requires an issued tax invoice");
  }

  const advice = await adviseRefundPath({
    hasIssuedTaxInvoice: true,
    hasReceiptVoucherOnly: false,
    reason: input.reason,
    invoiceNumber: inv.number,
    grandTotal: inv.grandTotal,
    requestedAmount: input.partialAmount,
  });

  let lines: InvoiceLineInput[] | undefined;
  if (
    input.partialAmount != null &&
    input.partialAmount > 0 &&
    input.partialAmount < inv.grandTotal
  ) {
    // Approximate partial as single line at taxable ratio
    const ratio = input.partialAmount / inv.grandTotal;
    const taxable = Math.round(inv.taxableTotal * ratio * 100) / 100;
    lines = [
      {
        description: `Partial credit — ${inv.number}`,
        hsn: inv.lines[0]?.hsn || "998313",
        quantity: 1,
        rate: taxable,
      },
    ];
  }

  return createCreditOrDebitNote({
    originalInvoiceId: inv.id,
    noteType: "CREDIT_NOTE",
    reason: advice.reasonText,
    lines,
    refundAmount: input.partialAmount ?? inv.grandTotal,
    refundDate: input.refundDate ?? new Date().toISOString().slice(0, 10),
    refundMode: input.refundMode,
    refundReference: input.refundReference,
  });
}

export async function createReceiptVoucher(input: {
  buyerName: string;
  buyerGstin?: string;
  buyerAddress?: string;
  buyerState?: string;
  buyerStateCode?: string;
  gstEntity?: string;
  amount: number;
  remarks?: string;
  clientId?: string;
}) {
  await requireCeo();
  return createInvoice({
    documentType: "RECEIPT_VOUCHER",
    status: "ISSUED",
    buyerName: input.buyerName,
    buyerGstin: input.buyerGstin,
    buyerAddress: input.buyerAddress,
    buyerState: input.buyerState,
    buyerStateCode: input.buyerStateCode || "07",
    placeOfSupplyStateCode: input.buyerStateCode || "07",
    gstEntity: input.gstEntity,
    clientId: input.clientId,
    remarks: input.remarks,
    lines: [
      {
        description: "Advance received",
        hsn: "998313",
        quantity: 1,
        rate: input.amount,
      },
    ],
  });
}

export async function createRefundVoucher(input: {
  receiptVoucherId: string;
  reason?: string;
  refundDate?: string;
  refundMode?: string;
  refundReference?: string;
}) {
  await requireCeo();
  const rv = await prisma.invoice.findUnique({
    where: { id: input.receiptVoucherId },
    include: { lines: true },
  });
  if (!rv || rv.documentType !== "RECEIPT_VOUCHER" || rv.status !== "ISSUED") {
    throw new Error("Valid issued receipt voucher required");
  }

  const advice = await adviseRefundPath({
    hasIssuedTaxInvoice: false,
    hasReceiptVoucherOnly: true,
    reason: input.reason,
  });

  const company = await prisma.companyProfile.findFirst();
  const tax = computeInvoiceTax({
    gstEntity: rv.gstEntity,
    buyerStateCode: rv.buyerStateCode,
    placeOfSupplyStateCode: rv.placeOfSupplyStateCode,
    lines: rv.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
    })),
    defaultHsn: company?.hsnDefault,
  });

  const note = await prisma.$transaction(async (tx) => {
    const alloc = await allocateDocumentNumber(tx, "REFUND_VOUCHER", new Date());
    return tx.invoice.create({
      data: {
        number: alloc.number,
        documentType: "REFUND_VOUCHER",
        status: "ISSUED",
        financialYear: alloc.financialYear,
        seriesCode: alloc.seriesCode,
        sequenceNo: alloc.sequenceNo,
        clientId: rv.clientId,
        buyerName: rv.buyerName,
        buyerAddress: rv.buyerAddress,
        buyerGstin: rv.buyerGstin,
        buyerState: rv.buyerState,
        buyerStateCode: rv.buyerStateCode,
        placeOfSupplyState: rv.placeOfSupplyState,
        placeOfSupplyStateCode: rv.placeOfSupplyStateCode,
        roundOff: tax.roundOff,
        invoiceDate: new Date(),
        remarks: advice.reasonText,
        taxableTotal: tax.taxableTotal,
        cgstAmount: tax.cgstAmount,
        sgstAmount: tax.sgstAmount,
        igstAmount: tax.igstAmount,
        grandTotal: tax.grandTotal,
        amountInWords: amountInWordsINR(tax.grandTotal),
        gstEntity: rv.gstEntity,
        originalInvoiceId: rv.id,
        refundAmount: tax.grandTotal,
        refundDate: input.refundDate ? new Date(input.refundDate) : new Date(),
        refundMode: input.refundMode || null,
        refundReference: input.refundReference || null,
        refundReason: advice.reasonText,
        lines: {
          create: tax.lines.map((l) => ({
            description: l.description,
            hsn: l.hsn,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
            taxRate: l.taxRate,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: { lines: true, originalInvoice: true },
    });
  });

  const filePath = await renderAndStorePdf(note);
  await syncLedgersForInvoice(note);
  revalidateInvoicePaths();
  return { id: note.id, number: note.number, filePath };
}

export async function getRefundAdvice(invoiceId: string, reason?: string) {
  await requireCeo();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new Error("Not found");
  return adviseRefundPath({
    hasIssuedTaxInvoice:
      inv.documentType === "TAX_INVOICE" && inv.status === "ISSUED",
    hasReceiptVoucherOnly: inv.documentType === "RECEIPT_VOUCHER",
    reason,
    invoiceNumber: inv.number,
    grandTotal: inv.grandTotal,
  });
}

export async function validateDraftAction(input: {
  documentType?: InvoiceDocumentType;
  buyerName?: string;
  buyerGstin?: string;
  buyerStateCode?: string;
  placeOfSupplyStateCode?: string;
  gstEntity?: string;
  reverseCharge?: boolean;
  remarks?: string;
  lines: InvoiceLineInput[];
  useAi?: boolean;
}) {
  await requireCeo();
  return validateInvoiceDraftSmart(
    {
      documentType: input.documentType ?? "TAX_INVOICE",
      buyerName: input.buyerName,
      buyerGstin: input.buyerGstin,
      buyerStateCode: input.buyerStateCode,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode,
      gstEntity: input.gstEntity,
      reverseCharge: input.reverseCharge,
      lines: input.lines,
      remarks: input.remarks,
    },
    { useAi: input.useAi },
  );
}

export async function aiDraftInvoiceAction(prompt: string) {
  await requireCeo();
  return draftInvoiceFromText(prompt);
}

export async function matchBuyerAction(buyerName: string, buyerGstin?: string) {
  await requireCeo();
  return matchBuyerToClient({ buyerName, buyerGstin });
}

export async function exportGstr1Action(opts?: {
  from?: string;
  to?: string;
}) {
  await requireCeo();
  const where: {
    status: string;
    invoiceDate?: { gte?: Date; lte?: Date };
  } = { status: "ISSUED" };
  if (opts?.from || opts?.to) {
    where.invoiceDate = {};
    if (opts.from) where.invoiceDate.gte = new Date(opts.from);
    if (opts.to) where.invoiceDate.lte = new Date(opts.to);
  }

  const rows = await prisma.invoice.findMany({
    where,
    include: {
      lines: true,
      originalInvoice: true,
    },
    orderBy: { invoiceDate: "asc" },
  });

  const data = buildGstr1Export(rows);
  const csv = gstr1ToCsv(data);
  return { ...data, csv };
}

export async function buildEinvoicePayloadAction(invoiceId: string) {
  await requireCeo();
  const company = await prisma.companyProfile.findFirst();
  if (!company) throw new Error("Company profile missing");
  const gate = canGenerateEinvoice(company);
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!inv) throw new Error("Invoice not found");
  if (
    inv.documentType !== "TAX_INVOICE" &&
    inv.documentType !== "CREDIT_NOTE" &&
    inv.documentType !== "DEBIT_NOTE"
  ) {
    throw new Error("E-invoice only for tax invoice / CN / DN");
  }
  const payload = buildInv01Payload(inv);
  let submitResult: { ok: false; error: string } | null = null;
  if (gate.allowed) {
    submitResult = await submitInv01ToIrp(payload);
  }
  return { gate, payload, submitResult };
}

export async function classifyAllInvoiceGstEntities() {
  await requireCeo();

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      buyerName: true,
      buyerAddress: true,
      buyerGstin: true,
      buyerState: true,
      buyerStateCode: true,
      taxableTotal: true,
      cgstAmount: true,
      sgstAmount: true,
      igstAmount: true,
      grandTotal: true,
      remarks: true,
      rawExtract: true,
      filePath: true,
      sourceFilePath: true,
      gstEntity: true,
    },
  });

  const results: {
    number: string;
    previous: string | null;
    gstEntity: string;
    confidence: number;
    method: string;
    reason: string;
  }[] = [];

  for (const inv of invoices) {
    const classification = await classifyInvoiceGstEntity(inv);
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { gstEntity: classification.gstEntity },
    });
    results.push({
      number: inv.number,
      previous: inv.gstEntity,
      gstEntity: classification.gstEntity,
      confidence: classification.confidence,
      method: classification.method,
      reason: classification.reason,
    });
  }

  revalidateInvoicePaths();
  return { updated: results.length, results };
}

export async function backfillInvoiceGstEntities() {
  await requireCeo();
  const result = await prisma.invoice.updateMany({
    where: { gstEntity: null },
    data: { gstEntity: "DEL" },
  });
  revalidatePath("/ceo/invoices");
  return { updated: result.count };
}

/** One-time: mark existing rows as TAX_INVOICE ISSUED and backfill POS from buyer state */
export async function migrateLegacyInvoicesCompliance() {
  await requireCeo();
  const rows = await prisma.invoice.findMany({
    where: {
      OR: [
        { documentType: "TAX_INVOICE", financialYear: null },
        { placeOfSupplyStateCode: null },
      ],
    },
  });
  let updated = 0;
  for (const inv of rows) {
    const fy = financialYearFromDate(inv.invoiceDate);
    // Parse legacy INV-09 → sequence
    let sequenceNo = inv.sequenceNo;
    let seriesCode = inv.seriesCode;
    if (!seriesCode && /^INV-?\d+$/i.test(inv.number.replace(/\s/g, ""))) {
      seriesCode = "INV";
      const m = inv.number.match(/(\d+)/);
      sequenceNo = m ? Number(m[1]) : sequenceNo;
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        documentType: inv.documentType || "TAX_INVOICE",
        status: inv.status || "ISSUED",
        financialYear: inv.financialYear || fy,
        seriesCode: seriesCode || inv.seriesCode,
        sequenceNo,
        placeOfSupplyState: inv.placeOfSupplyState || inv.buyerState,
        placeOfSupplyStateCode:
          inv.placeOfSupplyStateCode || inv.buyerStateCode,
      },
    });
    updated++;
  }
  revalidateInvoicePaths();
  return { updated };
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
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      originalInvoice: { select: { id: true, number: true } },
    },
  });
}

export async function getInvoiceById(id: string) {
  await requireCeo();
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      originalInvoice: true,
      client: true,
      agreement: true,
    },
  });
}

export async function isInvoiceMailConfigured() {
  await requireCeo();
  const { mailConfigured } = await import("@/lib/mail/config");
  return mailConfigured();
}

/** Email an issued invoice/proforma PDF; always CCs accounts@thebluridge.com */
export async function emailInvoice(input: {
  invoiceId: string;
  to: string;
  extraCc?: string[];
}) {
  await requireCeo();
  if (!input.invoiceId) throw new Error("Invoice ID required");
  if (!input.to?.trim()) throw new Error("Recipient email required");

  const inv = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { client: true },
  });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "ISSUED") {
    throw new Error("Only issued documents can be emailed");
  }
  if (!inv.filePath) {
    throw new Error("No PDF on file — re-issue or regenerate the document first");
  }

  const { sendInvoiceEmail } = await import("@/lib/mail/send-invoice");
  const result = await sendInvoiceEmail({
    to: input.to.trim(),
    documentType: inv.documentType,
    number: inv.number,
    buyerName: inv.buyerName,
    invoiceDate: inv.invoiceDate,
    grandTotal: inv.grandTotal,
    gstEntity: inv.gstEntity,
    filePath: inv.filePath,
    extraCc: input.extraCc,
  });

  await prisma.invoice.update({
    where: { id: inv.id },
    data: {
      aiSuggestionLog: JSON.stringify({
        ...(safeJson(inv.aiSuggestionLog) || {}),
        lastEmailedAt: new Date().toISOString(),
        lastEmailedTo: result.to,
        lastEmailedCc: result.cc,
        lastEmailMessageId: result.messageId,
      }),
    },
  });

  revalidateInvoicePaths();
  return result;
}

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
