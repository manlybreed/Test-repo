import { getSellerProfile, normalizeGstEntity } from "@/lib/gst-entities";
import type { InvoiceDocumentType } from "@/lib/invoice/types";
import type { InvoicePdfInput } from "@/lib/docgen/invoice";
import type { Invoice, InvoiceLine } from "@prisma/client";

export function invoiceToPdfInput(
  invoice: Invoice & { lines: InvoiceLine[]; originalInvoice?: Invoice | null },
): InvoicePdfInput {
  const sellerProfile = getSellerProfile(normalizeGstEntity(invoice.gstEntity));
  const sellerAddress = [sellerProfile.addressLine1, sellerProfile.addressLine2]
    .filter(Boolean)
    .join(", ");

  return {
    number: invoice.number,
    date: invoice.invoiceDate,
    documentType: invoice.documentType as InvoiceDocumentType,
    reverseCharge: invoice.reverseCharge,
    placeOfSupplyState: invoice.placeOfSupplyState,
    placeOfSupplyStateCode:
      invoice.placeOfSupplyStateCode || invoice.buyerStateCode,
    roundOff: invoice.roundOff,
    originalNumber: invoice.originalInvoice?.number ?? null,
    seller: {
      legalName: sellerProfile.legalName,
      addressLine1: sellerAddress,
      city: sellerProfile.city,
      state: sellerProfile.state,
      stateCode: sellerProfile.stateCode,
      gstin: sellerProfile.gstin,
    },
    buyer: {
      name: invoice.buyerName,
      address: invoice.buyerAddress,
      gstin: invoice.buyerGstin,
      state: invoice.buyerState,
      stateCode: invoice.buyerStateCode,
    },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
    })),
    taxableTotal: invoice.taxableTotal,
    cgstAmount: invoice.cgstAmount,
    sgstAmount: invoice.sgstAmount,
    igstAmount: invoice.igstAmount,
    grandTotal: invoice.grandTotal,
    remarks: invoice.remarks,
  };
}
