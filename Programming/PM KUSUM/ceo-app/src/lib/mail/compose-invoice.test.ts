import { describe, expect, it } from "vitest";
import { composeInvoiceEmail } from "./compose-invoice";
import { DEFAULT_ACCOUNTS_CC } from "./config";

describe("composeInvoiceEmail", () => {
  it("builds subject and always CCs accounts@", () => {
    const draft = composeInvoiceEmail({
      to: "buyer@example.com",
      documentType: "TAX_INVOICE",
      number: "INV/2526/0009",
      buyerName: "Acme Solar",
      invoiceDate: new Date("2025-06-15"),
      grandTotal: 118000,
      gstEntity: "DEL",
    });
    expect(draft.to).toBe("buyer@example.com");
    expect(draft.cc).toContain(DEFAULT_ACCOUNTS_CC);
    expect(draft.subject).toContain("Tax Invoice");
    expect(draft.subject).toContain("INV/2526/0009");
    expect(draft.attachmentFilename).toBe("INV-2526-0009.pdf");
    expect(draft.text).toContain("Acme Solar");
    expect(draft.html).toContain("accounts@thebluridge.com");
  });

  it("labels proforma distinctly", () => {
    const draft = composeInvoiceEmail({
      to: "client@co.in",
      documentType: "PROFORMA",
      number: "PF/2526/0001",
      buyerName: "Client",
      invoiceDate: new Date("2025-07-01"),
      grandTotal: 35400,
    });
    expect(draft.subject).toContain("Proforma Invoice");
  });

  it("does not duplicate CC when To is accounts", () => {
    const draft = composeInvoiceEmail({
      to: "accounts@thebluridge.com",
      documentType: "TAX_INVOICE",
      number: "INV/2526/0001",
      buyerName: "Internal",
      invoiceDate: new Date(),
      grandTotal: 1000,
    });
    expect(draft.cc).not.toContain("accounts@thebluridge.com");
  });

  it("rejects invalid To", () => {
    expect(() =>
      composeInvoiceEmail({
        to: "not-an-email",
        documentType: "TAX_INVOICE",
        number: "INV/1",
        buyerName: "X",
        invoiceDate: new Date(),
        grandTotal: 1,
      }),
    ).toThrow(/Valid recipient/);
  });
});
