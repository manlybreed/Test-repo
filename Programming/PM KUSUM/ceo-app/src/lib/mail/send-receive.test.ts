import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { composeInvoiceEmail } from "./compose-invoice";
import { findRecentBySubject } from "./imap";
import { sendInvoiceEmail } from "./send-invoice";
import { writeStorageFile, storageRoot } from "@/lib/storage";

/**
 * Ethereal (nodemailer test account) — verifies SMTP send + IMAP receive
 * without depending on production mail.thebluridge.com credentials.
 */
describe("invoice mail send + receive (Ethereal)", () => {
  let account: nodemailer.TestAccount;
  let transport: nodemailer.Transporter;
  let relativePdf: string;
  const marker = `BLURIDGE-MAIL-TEST-${Date.now()}`;

  beforeAll(async () => {
    account = await nodemailer.createTestAccount();
    transport = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
    });

    // Minimal PDF bytes (enough for attachment; not a valid PDF parser check)
    const pdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
      "utf8",
    );
    relativePdf = await writeStorageFile(
      "invoices",
      `mail-test-${Date.now()}.pdf`,
      pdfBytes,
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await fs.unlink(path.join(storageRoot(), relativePdf));
    } catch {
      // ignore
    }
  });

  it("sends invoice email with PDF and CCs accounts", async () => {
    const draft = composeInvoiceEmail({
      to: account.user,
      documentType: "TAX_INVOICE",
      number: `INV/TEST/${marker.slice(-6)}`,
      buyerName: "Mail Test Buyer",
      invoiceDate: new Date(),
      grandTotal: 35400,
      gstEntity: "DEL",
      accountsCc: "accounts@thebluridge.com",
    });

    // Override subject marker into send via number in compose — use custom send
    const info = await transport.sendMail({
      from: `"BluRidge Test" <${account.user}>`,
      to: draft.to,
      cc: draft.cc.join(", "),
      subject: `${draft.subject} ${marker}`,
      text: draft.text,
      html: draft.html,
      attachments: [
        {
          filename: draft.attachmentFilename,
          path: path.join(storageRoot(), relativePdf),
          contentType: "application/pdf",
        },
      ],
    });

    expect(info.messageId).toBeTruthy();
    expect(info.accepted?.length).toBeGreaterThan(0);
    const preview = nodemailer.getTestMessageUrl(info);
    expect(preview).toBeTruthy();
  }, 60_000);

  it("receives the message over IMAP by subject", async () => {
    // Brief wait for Ethereal delivery
    await new Promise((r) => setTimeout(r, 2500));

    const hits = await findRecentBySubject(
      {
        imapHost: "imap.ethereal.email",
        imapPort: 993,
        imapSecure: true,
        user: account.user,
        pass: account.pass,
      },
      marker,
      { sinceMinutes: 60, limit: 20 },
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.subject).toContain(marker);
  }, 90_000);

  it("sendInvoiceEmail helper attaches PDF from storage", async () => {
    const result = await sendInvoiceEmail({
      to: account.user,
      documentType: "PROFORMA",
      number: `PF/TEST/${Date.now().toString().slice(-4)}`,
      buyerName: "Proforma Buyer",
      invoiceDate: new Date(),
      grandTotal: 35400,
      filePath: relativePdf,
      transport,
      extraCc: [],
    });
    expect(result.messageId).toBeTruthy();
    expect(result.cc).toContain("accounts@thebluridge.com");
    expect(result.subject).toContain("Proforma");
  }, 60_000);
});

describe("live mail.thebluridge.com (optional)", () => {
  const live = Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_LIVE_TEST === "1",
  );

  it.skipIf(!live)(
    "verifies SMTP against configured host",
    async () => {
      const { verifySmtp } = await import("./transport");
      await expect(verifySmtp()).resolves.toBe(true);
    },
    30_000,
  );
});
