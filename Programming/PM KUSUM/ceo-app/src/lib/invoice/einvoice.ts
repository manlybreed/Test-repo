/**
 * E-invoice INV-01 scaffold — builds payload shape for IRP/GSP.
 * Not submitted until CompanyProfile.eInvoiceEnabled && AATO band allows.
 */

import { getSellerProfile, normalizeGstEntity } from "@/lib/gst-entities";
import type { Invoice, InvoiceLine } from "@prisma/client";

export type EinvoiceGate = {
  allowed: boolean;
  reason: string;
};

export function canGenerateEinvoice(company: {
  eInvoiceEnabled: boolean;
  aatoBand: string;
}): EinvoiceGate {
  if (!company.eInvoiceEnabled) {
    return {
      allowed: false,
      reason: "E-invoice feature flag is off (CompanyProfile.eInvoiceEnabled).",
    };
  }
  if (company.aatoBand !== "OVER_5CR") {
    return {
      allowed: false,
      reason: "AATO band is not OVER_5CR — enable only after practitioner confirmation.",
    };
  }
  return { allowed: true, reason: "Ready for sandbox/IRP submission." };
}

export type Inv01Payload = {
  Version: string;
  TranDtls: { TaxSch: string; SupTyp: string; RegRev: string; EcmGstin: null };
  DocDtls: { Typ: string; No: string; Dt: string };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    Pos: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  ItemList: {
    SlNo: string;
    IsServc: string;
    HsnCd: string;
    Qty: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    TotItemVal: number;
  }[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
};

function docTyp(documentType: string): string {
  if (documentType === "CREDIT_NOTE") return "CRN";
  if (documentType === "DEBIT_NOTE") return "DBN";
  return "INV";
}

export function buildInv01Payload(
  invoice: Invoice & { lines: InvoiceLine[] },
): Inv01Payload {
  const seller = getSellerProfile(normalizeGstEntity(invoice.gstEntity));
  const pos =
    invoice.placeOfSupplyStateCode ||
    invoice.buyerStateCode ||
    seller.stateCode;
  const dt = invoice.invoiceDate;
  const dtStr = `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;

  const lineCount = Math.max(invoice.lines.length, 1);
  const perLineIgst = invoice.igstAmount / lineCount;
  const perLineCgst = invoice.cgstAmount / lineCount;
  const perLineSgst = invoice.sgstAmount / lineCount;

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: invoice.reverseCharge ? "Y" : "N",
      EcmGstin: null,
    },
    DocDtls: {
      Typ: docTyp(invoice.documentType),
      No: invoice.number,
      Dt: dtStr,
    },
    SellerDtls: {
      Gstin: seller.gstin,
      LglNm: seller.legalName,
      Addr1: seller.addressLine1,
      Loc: seller.city,
      Pin: Number(seller.pincode) || 110017,
      Stcd: seller.stateCode,
    },
    BuyerDtls: {
      Gstin: (invoice.buyerGstin || "URP").toUpperCase(),
      LglNm: invoice.buyerName,
      Pos: pos,
      Addr1: invoice.buyerAddress || invoice.buyerName,
      Loc: invoice.buyerState || "NA",
      Pin: 0,
      Stcd: invoice.buyerStateCode || pos,
    },
    ItemList: invoice.lines.map((l, i) => ({
      SlNo: String(i + 1),
      IsServc: "Y",
      HsnCd: l.hsn,
      Qty: l.quantity,
      Unit: l.uqc || "OTH",
      UnitPrice: l.rate,
      TotAmt: l.amount,
      AssAmt: l.amount,
      GstRt: l.taxRate ?? 18,
      IgstAmt: Math.round(perLineIgst * 100) / 100,
      CgstAmt: Math.round(perLineCgst * 100) / 100,
      SgstAmt: Math.round(perLineSgst * 100) / 100,
      TotItemVal:
        l.amount +
        Math.round(perLineIgst * 100) / 100 +
        Math.round(perLineCgst * 100) / 100 +
        Math.round(perLineSgst * 100) / 100,
    })),
    ValDtls: {
      AssVal: invoice.taxableTotal,
      CgstVal: invoice.cgstAmount,
      SgstVal: invoice.sgstAmount,
      IgstVal: invoice.igstAmount,
      RndOffAmt: invoice.roundOff,
      TotInvVal: invoice.grandTotal,
    },
  };
}

/** Placeholder IRP client — sandbox wiring later */
export async function submitInv01ToIrp(
  _payload: Inv01Payload,
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: "IRP/GSP client not configured — scaffold only.",
  };
}
