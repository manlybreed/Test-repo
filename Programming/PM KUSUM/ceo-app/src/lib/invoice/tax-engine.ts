import { getSellerProfile, shouldUseIgst, type GstEntity } from "@/lib/gst-entities";
import type { InvoiceLineCalcInput, TaxComputation } from "@/lib/invoice/types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Deterministic GST tax computation for BluRidge consulting invoices.
 * Default rate 18%. Same-state → CGST+SGST; otherwise IGST.
 */
export function computeInvoiceTax(input: {
  gstEntity: GstEntity | string | null | undefined;
  buyerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  lines: InvoiceLineCalcInput[];
  defaultHsn?: string;
  /** When true, amounts reduce tax liability (credit notes) — signs stay positive; caller stores as CN. */
  creditNote?: boolean;
}): TaxComputation {
  const posCode =
    input.placeOfSupplyStateCode?.trim() ||
    input.buyerStateCode?.trim() ||
    getSellerProfile(input.gstEntity).stateCode;

  const useIgst = shouldUseIgst(input.gstEntity, posCode);
  const defaultHsn = input.defaultHsn || "998313";

  const lines = input.lines.map((l, i) => {
    const quantity = l.quantity ?? 1;
    const discount = l.discount ?? 0;
    const amount = round2(Math.max(0, quantity * l.rate - discount));
    return {
      description: l.description,
      hsn: l.hsn || defaultHsn,
      quantity,
      rate: l.rate,
      discount,
      amount,
      taxRate: l.taxRate ?? 18,
      uqc: l.uqc ?? null,
      sortOrder: i,
    };
  });

  const taxableTotal = round2(lines.reduce((s, l) => s + l.amount, 0));

  // BluRidge consulting: single 18% rate on taxable total
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  if (useIgst) {
    igstAmount = round2(taxableTotal * 0.18);
  } else {
    cgstAmount = round2(taxableTotal * 0.09);
    sgstAmount = round2(taxableTotal * 0.09);
  }

  const beforeRound = round2(taxableTotal + cgstAmount + sgstAmount + igstAmount);
  const grandTotal = Math.round(beforeRound);
  const roundOff = round2(grandTotal - beforeRound);

  return {
    lines,
    taxableTotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    roundOff,
    grandTotal,
    useIgst,
    placeOfSupplyStateCode: posCode,
  };
}

/** Unregistered buyer + taxable ≥ ₹50,000 → warning (Rule 46 / B2CL consideration). */
export function unregisteredHighValueWarning(opts: {
  buyerGstin?: string | null;
  taxableTotal: number;
}): string | null {
  if (opts.buyerGstin?.trim()) return null;
  if (opts.taxableTotal >= 50000) {
    return "Buyer is unregistered and taxable value is ₹50,000 or more — confirm B2C treatment and place of supply.";
  }
  return null;
}
