import { describe, expect, it } from "vitest";
import { computeInvoiceTax, unregisteredHighValueWarning } from "./tax-engine";
import { isValidGstin, gstinChecksumChar } from "./gstin";
import { financialYearFromDate, financialYearShort } from "./financial-year";
import { formatDocumentNumber } from "./numbering";
import { validateInvoiceDraft, hasBlockingErrors } from "./validate";
import { buildGstr1Export } from "./gstr1";
import { canGenerateEinvoice, buildInv01Payload } from "./einvoice";

describe("financial year", () => {
  it("uses Apr–Mar boundary", () => {
    expect(financialYearFromDate(new Date("2025-03-31"))).toBe("2024-25");
    expect(financialYearFromDate(new Date("2025-04-01"))).toBe("2025-26");
    expect(financialYearShort("2025-26")).toBe("2526");
  });
});

describe("numbering format", () => {
  it("stays within 16 chars", () => {
    const n = formatDocumentNumber("INV", "2025-26", 9);
    expect(n).toBe("INV/2526/0009");
    expect(n.length).toBeLessThanOrEqual(16);
  });
});

describe("GSTIN checksum", () => {
  it("accepts BluRidge GSTINs", () => {
    expect(isValidGstin("07AANCB9956E1Z7")).toBe(true);
    expect(isValidGstin("08AANCB9956E1Z5")).toBe(true);
  });

  it("rejects bad checksum", () => {
    expect(isValidGstin("07AANCB9956E1Z0")).toBe(false);
    expect(gstinChecksumChar("07AANCB9956E1Z")).toBe("7");
  });
});

describe("tax engine", () => {
  it("DEL → Delhi buyer uses CGST+SGST", () => {
    const t = computeInvoiceTax({
      gstEntity: "DEL",
      buyerStateCode: "07",
      lines: [{ description: "TEV", rate: 100000, quantity: 1 }],
    });
    expect(t.useIgst).toBe(false);
    expect(t.cgstAmount).toBe(9000);
    expect(t.sgstAmount).toBe(9000);
    expect(t.igstAmount).toBe(0);
    expect(t.grandTotal).toBe(118000);
  });

  it("DEL → Rajasthan buyer uses IGST", () => {
    const t = computeInvoiceTax({
      gstEntity: "DEL",
      buyerStateCode: "08",
      lines: [{ description: "TEV", rate: 100000 }],
    });
    expect(t.useIgst).toBe(true);
    expect(t.igstAmount).toBe(18000);
    expect(t.cgstAmount).toBe(0);
  });

  it("RAJ → Delhi buyer uses IGST", () => {
    const t = computeInvoiceTax({
      gstEntity: "RAJ",
      placeOfSupplyStateCode: "07",
      lines: [{ description: "Fee", rate: 40000 }],
    });
    expect(t.useIgst).toBe(true);
    expect(t.igstAmount).toBe(7200);
  });

  it("RAJ → Rajasthan uses CGST+SGST", () => {
    const t = computeInvoiceTax({
      gstEntity: "RAJ",
      buyerStateCode: "08",
      lines: [{ description: "Fee", rate: 40000 }],
    });
    expect(t.useIgst).toBe(false);
    expect(t.cgstAmount).toBe(3600);
    expect(t.sgstAmount).toBe(3600);
  });

  it("warns unregistered ≥ 50k", () => {
    expect(
      unregisteredHighValueWarning({ buyerGstin: null, taxableTotal: 50000 }),
    ).toBeTruthy();
    expect(
      unregisteredHighValueWarning({
        buyerGstin: "07AANCB9956E1Z7",
        taxableTotal: 50000,
      }),
    ).toBeNull();
  });

  it("partial credit note tax reverse amount", () => {
    const full = computeInvoiceTax({
      gstEntity: "DEL",
      buyerStateCode: "07",
      lines: [{ description: "A", rate: 100000 }],
    });
    const partial = computeInvoiceTax({
      gstEntity: "DEL",
      buyerStateCode: "07",
      lines: [{ description: "Partial", rate: 50000 }],
      creditNote: true,
    });
    expect(partial.taxableTotal).toBe(50000);
    expect(partial.cgstAmount).toBe(full.cgstAmount / 2);
  });
});

describe("validate draft", () => {
  it("blocks missing POS on tax invoice", () => {
    const issues = validateInvoiceDraft({
      documentType: "TAX_INVOICE",
      buyerName: "Acme",
      lines: [{ description: "x", rate: 1000 }],
    });
    expect(hasBlockingErrors(issues)).toBe(true);
  });

  it("allows valid draft", () => {
    const issues = validateInvoiceDraft({
      documentType: "TAX_INVOICE",
      buyerName: "Acme",
      buyerStateCode: "07",
      buyerGstin: "07AANCB9956E1Z7",
      gstEntity: "DEL",
      lines: [{ description: "x", rate: 1000 }],
    });
    expect(hasBlockingErrors(issues)).toBe(false);
  });
});

describe("gstr1 + einvoice scaffold", () => {
  it("flags CDN without original", () => {
    const { anomalies } = buildGstr1Export([
      {
        id: "1",
        number: "CN/2526/0001",
        documentType: "CREDIT_NOTE",
        status: "ISSUED",
        buyerName: "X",
        buyerGstin: "07AANCB9956E1Z7",
        invoiceDate: new Date("2025-06-01"),
        taxableTotal: 100,
        cgstAmount: 9,
        sgstAmount: 9,
        igstAmount: 0,
        grandTotal: 118,
        originalInvoiceId: null,
        placeOfSupplyStateCode: "07",
        buyerStateCode: "07",
        gstEntity: "DEL",
        reverseCharge: false,
      } as never,
    ]);
    expect(anomalies.some((a) => a.includes("without linked"))).toBe(true);
  });

  it("gates e-invoice on flag + AATO", () => {
    expect(
      canGenerateEinvoice({ eInvoiceEnabled: false, aatoBand: "OVER_5CR" })
        .allowed,
    ).toBe(false);
    expect(
      canGenerateEinvoice({ eInvoiceEnabled: true, aatoBand: "UNDER_5CR" })
        .allowed,
    ).toBe(false);
    expect(
      canGenerateEinvoice({ eInvoiceEnabled: true, aatoBand: "OVER_5CR" })
        .allowed,
    ).toBe(true);
  });

  it("builds INV-01 shape", () => {
    const payload = buildInv01Payload({
      id: "x",
      number: "INV/2526/0001",
      documentType: "TAX_INVOICE",
      status: "ISSUED",
      invoiceDate: new Date("2025-06-15"),
      buyerName: "Buyer",
      buyerGstin: "08AANCB9956E1Z5",
      buyerAddress: "Jaipur",
      buyerState: "Rajasthan",
      buyerStateCode: "08",
      placeOfSupplyStateCode: "08",
      reverseCharge: false,
      gstEntity: "DEL",
      taxableTotal: 100000,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 18000,
      roundOff: 0,
      grandTotal: 118000,
      lines: [
        {
          id: "l1",
          invoiceId: "x",
          description: "TEV",
          hsn: "998313",
          quantity: 1,
          rate: 100000,
          amount: 100000,
          taxRate: 18,
          discount: 0,
          uqc: null,
          sortOrder: 0,
        },
      ],
    } as never);
    expect(payload.DocDtls.Typ).toBe("INV");
    expect(payload.ValDtls.TotInvVal).toBe(118000);
    expect(payload.SellerDtls.Gstin).toBe("07AANCB9956E1Z7");
  });
});
