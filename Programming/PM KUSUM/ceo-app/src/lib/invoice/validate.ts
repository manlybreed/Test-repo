import { isValidGstin } from "@/lib/invoice/gstin";
import { computeInvoiceTax, unregisteredHighValueWarning } from "@/lib/invoice/tax-engine";
import type { InvoiceDocumentType, InvoiceLineCalcInput } from "@/lib/invoice/types";
import { normalizeGstEntity } from "@/lib/gst-entities";

export type ValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
};

export type DraftValidationInput = {
  documentType: InvoiceDocumentType;
  buyerName?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  gstEntity?: string | null;
  reverseCharge?: boolean;
  lines?: InvoiceLineCalcInput[];
  /** Soft check: wording that looks like proforma on tax invoice */
  remarks?: string | null;
  serviceDesc?: string | null;
};

export function validateInvoiceDraft(input: DraftValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.buyerName?.trim()) {
    issues.push({ level: "error", code: "BUYER_NAME", message: "Buyer name is required." });
  }

  if (!input.lines?.length) {
    issues.push({ level: "error", code: "LINES", message: "At least one line item is required." });
  } else {
    input.lines.forEach((l, i) => {
      if (!l.description?.trim()) {
        issues.push({
          level: "error",
          code: "LINE_DESC",
          message: `Line ${i + 1}: description is required.`,
        });
      }
      if (l.rate == null || Number.isNaN(l.rate)) {
        issues.push({
          level: "error",
          code: "LINE_RATE",
          message: `Line ${i + 1}: rate is required.`,
        });
      }
    });
  }

  const gstin = input.buyerGstin?.trim();
  if (gstin && !isValidGstin(gstin)) {
    issues.push({
      level: "error",
      code: "GSTIN_CHECKSUM",
      message: "Buyer GSTIN failed format or checksum validation.",
    });
  }

  const pos =
    input.placeOfSupplyStateCode?.trim() || input.buyerStateCode?.trim();
  if (!pos && input.documentType !== "PROFORMA") {
    issues.push({
      level: "error",
      code: "POS",
      message: "Place of supply (state code) is required before issue.",
    });
  }

  if (input.lines?.length && pos) {
    const tax = computeInvoiceTax({
      gstEntity: normalizeGstEntity(input.gstEntity),
      buyerStateCode: input.buyerStateCode,
      placeOfSupplyStateCode: pos,
      lines: input.lines,
    });
    const warn = unregisteredHighValueWarning({
      buyerGstin: gstin,
      taxableTotal: tax.taxableTotal,
    });
    if (warn) {
      issues.push({ level: "warning", code: "UNREG_50K", message: warn });
    }
  }

  if (input.documentType === "TAX_INVOICE") {
    const blob = `${input.remarks ?? ""} ${input.serviceDesc ?? ""}`.toLowerCase();
    if (blob.includes("proforma") || blob.includes("pro forma")) {
      issues.push({
        level: "warning",
        code: "PROFORMA_WORDING",
        message: "Document is a tax invoice but text mentions proforma — confirm document type.",
      });
    }
  }

  if (input.reverseCharge) {
    issues.push({
      level: "warning",
      code: "RCM",
      message: "Reverse charge is marked — ensure buyer liability is correctly stated on the PDF.",
    });
  }

  return issues;
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
