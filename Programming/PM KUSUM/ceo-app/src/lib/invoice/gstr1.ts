import type { Invoice, InvoiceLine } from "@prisma/client";

export type Gstr1B2BRow = {
  gstin: string;
  receiverName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: string;
  invoiceType: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  documentType: string;
};

export type Gstr1CdnRow = {
  gstin: string;
  receiverName: string;
  noteNumber: string;
  noteDate: string;
  noteType: "C" | "D";
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  noteValue: number;
  placeOfSupply: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
};

type Inv = Invoice & {
  lines?: InvoiceLine[];
  originalInvoice?: Invoice | null;
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildGstr1Export(invoices: Inv[]): {
  b2b: Gstr1B2BRow[];
  cdn: Gstr1CdnRow[];
  anomalies: string[];
} {
  const b2b: Gstr1B2BRow[] = [];
  const cdn: Gstr1CdnRow[] = [];
  const anomalies: string[] = [];

  const issued = invoices.filter((i) => i.status === "ISSUED");

  for (const inv of issued) {
    if (inv.documentType === "TAX_INVOICE") {
      if (!inv.buyerGstin?.trim()) {
        // B2C — skip B2B sheet; could extend later
        continue;
      }
      b2b.push({
        gstin: inv.buyerGstin.trim().toUpperCase(),
        receiverName: inv.buyerName,
        invoiceNumber: inv.number,
        invoiceDate: isoDate(inv.invoiceDate),
        invoiceValue: inv.grandTotal,
        placeOfSupply: inv.placeOfSupplyStateCode || inv.buyerStateCode || "",
        reverseCharge: inv.reverseCharge ? "Y" : "N",
        invoiceType: "Regular",
        taxableValue: inv.taxableTotal,
        igst: inv.igstAmount,
        cgst: inv.cgstAmount,
        sgst: inv.sgstAmount,
        documentType: inv.documentType,
      });
    }

    if (inv.documentType === "CREDIT_NOTE" || inv.documentType === "DEBIT_NOTE") {
      if (!inv.originalInvoiceId) {
        anomalies.push(`${inv.number}: CDN without linked original invoice`);
      }
      cdn.push({
        gstin: (inv.buyerGstin || "").trim().toUpperCase(),
        receiverName: inv.buyerName,
        noteNumber: inv.number,
        noteDate: isoDate(inv.invoiceDate),
        noteType: inv.documentType === "CREDIT_NOTE" ? "C" : "D",
        originalInvoiceNumber: inv.originalInvoice?.number || "",
        originalInvoiceDate: inv.originalInvoice
          ? isoDate(inv.originalInvoice.invoiceDate)
          : "",
        noteValue: inv.grandTotal,
        placeOfSupply: inv.placeOfSupplyStateCode || inv.buyerStateCode || "",
        taxableValue: inv.taxableTotal,
        igst: inv.igstAmount,
        cgst: inv.cgstAmount,
        sgst: inv.sgstAmount,
      });
    }
  }

  // Series gap detection for tax invoices
  const bySeries = new Map<string, number[]>();
  for (const inv of issued.filter((i) => i.documentType === "TAX_INVOICE")) {
    if (inv.seriesCode && inv.financialYear && inv.sequenceNo != null) {
      const key = `${inv.seriesCode}:${inv.financialYear}`;
      const arr = bySeries.get(key) ?? [];
      arr.push(inv.sequenceNo);
      bySeries.set(key, arr);
    }
  }
  for (const [key, nums] of bySeries) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! > 1) {
        anomalies.push(
          `Series gap in ${key}: ${sorted[i - 1]} → ${sorted[i]}`,
        );
      }
    }
  }

  // Tax head vs POS mismatch
  for (const inv of issued.filter((i) => i.documentType === "TAX_INVOICE")) {
    const pos = inv.placeOfSupplyStateCode || inv.buyerStateCode;
    const sellerCode = inv.gstEntity === "RAJ" ? "08" : "07";
    const expectIgst = pos && pos !== sellerCode;
    if (expectIgst && inv.igstAmount <= 0 && inv.taxableTotal > 0) {
      anomalies.push(`${inv.number}: expected IGST for POS ${pos} but IGST is 0`);
    }
    if (!expectIgst && inv.igstAmount > 0) {
      anomalies.push(`${inv.number}: IGST present on apparent intra-state supply`);
    }
  }

  return { b2b, cdn, anomalies };
}

export function gstr1ToCsv(exportData: {
  b2b: Gstr1B2BRow[];
  cdn: Gstr1CdnRow[];
}): string {
  const lines: string[] = [];
  lines.push("=== B2B ===");
  lines.push(
    [
      "GSTIN",
      "Receiver",
      "InvoiceNumber",
      "InvoiceDate",
      "InvoiceValue",
      "PlaceOfSupply",
      "ReverseCharge",
      "InvoiceType",
      "TaxableValue",
      "IGST",
      "CGST",
      "SGST",
    ].join(","),
  );
  for (const r of exportData.b2b) {
    lines.push(
      [
        r.gstin,
        csvEscape(r.receiverName),
        r.invoiceNumber,
        r.invoiceDate,
        r.invoiceValue,
        r.placeOfSupply,
        r.reverseCharge,
        r.invoiceType,
        r.taxableValue,
        r.igst,
        r.cgst,
        r.sgst,
      ].join(","),
    );
  }
  lines.push("");
  lines.push("=== CDN ===");
  lines.push(
    [
      "GSTIN",
      "Receiver",
      "NoteNumber",
      "NoteDate",
      "NoteType",
      "OriginalInvoice",
      "OriginalDate",
      "NoteValue",
      "PlaceOfSupply",
      "TaxableValue",
      "IGST",
      "CGST",
      "SGST",
    ].join(","),
  );
  for (const r of exportData.cdn) {
    lines.push(
      [
        r.gstin,
        csvEscape(r.receiverName),
        r.noteNumber,
        r.noteDate,
        r.noteType,
        r.originalInvoiceNumber,
        r.originalInvoiceDate,
        r.noteValue,
        r.placeOfSupply,
        r.taxableValue,
        r.igst,
        r.cgst,
        r.sgst,
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
