import { DOCUMENT_TITLE, type InvoiceDocumentType } from "@/lib/invoice/types";
import { DEFAULT_ACCOUNTS_CC } from "@/lib/mail/config";

export type InvoiceMailDraft = {
  to: string;
  cc: string[];
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
};

export function composeInvoiceEmail(input: {
  to: string;
  documentType: InvoiceDocumentType | string;
  number: string;
  buyerName: string;
  invoiceDate: Date;
  grandTotal: number;
  gstEntity?: string | null;
  accountsCc?: string;
  extraCc?: string[];
}): InvoiceMailDraft {
  const to = input.to.trim();
  if (!to || !to.includes("@")) {
    throw new Error("Valid recipient email is required");
  }

  const docLabel =
    DOCUMENT_TITLE[input.documentType as InvoiceDocumentType] ||
    String(input.documentType).replace(/_/g, " ");
  const dateStr = input.invoiceDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const amount = input.grandTotal.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const accounts = (input.accountsCc || DEFAULT_ACCOUNTS_CC).trim();
  const cc = [
    accounts,
    ...(input.extraCc ?? []).map((c) => c.trim()).filter(Boolean),
  ].filter((c, i, arr) => c && arr.indexOf(c) === i && c.toLowerCase() !== to.toLowerCase());

  const subject = `${docLabel} ${input.number} — BluRidge Consulting`;
  const entityNote = input.gstEntity
    ? ` (raised under BluRidge ${input.gstEntity} GST)`
    : "";

  const text = [
    `Dear ${input.buyerName},`,
    "",
    `Please find attached ${docLabel} ${input.number} dated ${dateStr} for ${amount}${entityNote}.`,
    "",
    "This email is sent from BluRidge Consulting Private Limited.",
    "For billing queries, reply to this email or contact accounts@thebluridge.com.",
    "",
    "Regards,",
    "BluRidge Consulting",
  ].join("\n");

  const html = `
    <p>Dear ${escapeHtml(input.buyerName)},</p>
    <p>Please find attached <strong>${escapeHtml(docLabel)} ${escapeHtml(input.number)}</strong>
    dated ${escapeHtml(dateStr)} for <strong>${escapeHtml(amount)}</strong>${escapeHtml(entityNote)}.</p>
    <p style="color:#555;font-size:13px">This email is sent from BluRidge Consulting Private Limited.
    For billing queries, contact <a href="mailto:accounts@thebluridge.com">accounts@thebluridge.com</a>.</p>
    <p>Regards,<br/>BluRidge Consulting</p>
  `.trim();

  const safeName = input.number.replace(/\//g, "-");
  return {
    to,
    cc,
    subject,
    text,
    html,
    attachmentFilename: `${safeName}.pdf`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
