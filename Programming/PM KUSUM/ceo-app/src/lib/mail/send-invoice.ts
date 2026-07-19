import fs from "fs/promises";
import type { Transporter } from "nodemailer";
import { composeInvoiceEmail } from "@/lib/mail/compose-invoice";
import { getMailConfig } from "@/lib/mail/config";
import { createSmtpTransport } from "@/lib/mail/transport";
import { resolveStoragePath } from "@/lib/storage";
import type { InvoiceDocumentType } from "@/lib/invoice/types";

export type SendInvoiceMailInput = {
  to: string;
  documentType: InvoiceDocumentType | string;
  number: string;
  buyerName: string;
  invoiceDate: Date;
  grandTotal: number;
  gstEntity?: string | null;
  /** Relative storage path e.g. invoices/INV-2526-0001.pdf */
  filePath: string;
  extraCc?: string[];
  transport?: Transporter;
};

export type SendInvoiceMailResult = {
  messageId: string;
  to: string;
  cc: string[];
  subject: string;
  accepted: string[];
};

export async function sendInvoiceEmail(
  input: SendInvoiceMailInput,
): Promise<SendInvoiceMailResult> {
  const cfg = getMailConfig();
  const draft = composeInvoiceEmail({
    to: input.to,
    documentType: input.documentType,
    number: input.number,
    buyerName: input.buyerName,
    invoiceDate: input.invoiceDate,
    grandTotal: input.grandTotal,
    gstEntity: input.gstEntity,
    accountsCc: cfg?.accountsCc,
    extraCc: input.extraCc,
  });

  const abs = resolveStoragePath(input.filePath);
  const pdf = await fs.readFile(abs);

  const transport = input.transport ?? createSmtpTransport();
  const from =
    cfg?.from || process.env.MAIL_FROM || "invoices@thebluridge.com";

  const info = await transport.sendMail({
    from,
    to: draft.to,
    cc: draft.cc.length ? draft.cc.join(", ") : undefined,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    attachments: [
      {
        filename: draft.attachmentFilename,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    messageId: String(info.messageId || ""),
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    accepted: (info.accepted || []).map(String),
  };
}
