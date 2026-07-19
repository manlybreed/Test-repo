export const INVOICE_DOCUMENT_TYPES = [
  "PROFORMA",
  "TAX_INVOICE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "RECEIPT_VOUCHER",
  "REFUND_VOUCHER",
] as const;

export type InvoiceDocumentType = (typeof INVOICE_DOCUMENT_TYPES)[number];

export const INVOICE_DOC_STATUSES = ["DRAFT", "ISSUED", "CANCELLED"] as const;
export type InvoiceDocStatus = (typeof INVOICE_DOC_STATUSES)[number];

export const SERIES_BY_DOCUMENT_TYPE: Record<InvoiceDocumentType, string> = {
  PROFORMA: "PF",
  TAX_INVOICE: "INV",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  RECEIPT_VOUCHER: "RV",
  REFUND_VOUCHER: "RFV",
};

export const DOCUMENT_TITLE: Record<InvoiceDocumentType, string> = {
  PROFORMA: "Proforma Invoice",
  TAX_INVOICE: "Tax Invoice",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
  RECEIPT_VOUCHER: "Receipt Voucher",
  REFUND_VOUCHER: "Refund Voucher",
};

export type InvoiceLineCalcInput = {
  description: string;
  hsn?: string;
  quantity?: number;
  rate: number;
  taxRate?: number;
  discount?: number;
  uqc?: string | null;
};

export type TaxComputation = {
  lines: {
    description: string;
    hsn: string;
    quantity: number;
    rate: number;
    discount: number;
    amount: number;
    taxRate: number;
    uqc: string | null;
    sortOrder: number;
  }[];
  taxableTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  grandTotal: number;
  useIgst: boolean;
  placeOfSupplyStateCode: string;
};
