import {
  GST_ENTITIES,
  extractGstinsFromText,
  gstEntityFromSellerGstin,
  isGstEntity,
  normalizeGstinCandidate,
  type GstEntity,
} from "@/lib/gst-entities";

const COMPANY_ALIASES = [
  "BLURIDGE CONSULTING PRIVATE LIMITED",
  "BLURIDGE CONSULTING PVT LTD",
  "BLURIDGE CONSULTING PVT. LTD.",
  "BLURIDGE CONSULTING PVT. LTD",
  "BLU RIDGE CONSULTING",
  "BLURIDGE CONSULTING",
  "THE BLURIDGE",
];

function normText(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if text looks like our legal / trade name (not requiring GSTIN). */
export function textMentionsBluridgeCompany(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const n = normText(text);
  return COMPANY_ALIASES.some((alias) => n.includes(normText(alias)));
}

/** Find BluRidge DEL/RAJ GSTINs in free text (handles glued OCR like GST08AANCB…). */
export function findBluridgeGstinsInText(text: string | null | undefined): {
  gstins: string[];
  entity: GstEntity | null;
} {
  const all = extractGstinsFromText(text);
  const gstins = all.filter(
    (g) =>
      g === GST_ENTITIES.DEL.gstin.toUpperCase() ||
      g === GST_ENTITIES.RAJ.gstin.toUpperCase(),
  );
  let entity: GstEntity | null = null;
  for (const g of gstins) {
    entity = gstEntityFromSellerGstin(g);
    if (entity) break;
  }
  return { gstins, entity };
}

export type ExpenseGstFlags = {
  billedTo?: string | null;
  ourGstMentioned?: boolean | null;
  billedGstin?: string | null;
  gstEntity?: string | null;
  description?: string | null;
  vendor?: string | null;
  rawExtract?: string | null;
  /** Extra OCR / PDF text from the bill itself (preferred for GSTIN scan). */
  documentText?: string | null;
};

export type ReconciledExpenseGst = {
  billedTo: string | null;
  ourGstMentioned: boolean;
  billedGstin: string | null;
  /** Which GSTIN appeared on the bill — null if only company name / none. */
  gstOnBill: GstEntity | null;
  /**
   * Booking entity for the expense form. Only auto-set from a GSTIN on the bill;
   * company-name-only does NOT pick DEL/RAJ.
   */
  gstEntity: GstEntity | null;
  note: string | null;
};

/**
 * Authoritative check: our GST counts as "mentioned" only when a BluRidge GSTIN
 * is present (or AI returns a clean DEL/RAJ + matching GSTIN field).
 * Company name alone → billedTo filled, ourGstMentioned = false.
 */
export function reconcileExpenseGstFlags(input: ExpenseGstFlags): ReconciledExpenseGst {
  const blob = [
    input.documentText,
    input.billedTo,
    input.billedGstin,
    input.description,
    input.vendor,
    input.rawExtract,
  ]
    .filter(Boolean)
    .join("\n");

  const fromField = gstEntityFromSellerGstin(input.billedGstin);
  const fromText = findBluridgeGstinsInText(blob);
  let gstOnBill = fromField || fromText.entity;
  let billedGstin =
    (fromField && normalizeGstinCandidate(input.billedGstin)) ||
    fromText.gstins[0] ||
    null;

  // AI said DEL/RAJ + GST mentioned, and GSTIN field normalizes or matches entity
  if (!gstOnBill && input.ourGstMentioned === true && isGstEntity(input.gstEntity)) {
    const aiGstin = normalizeGstinCandidate(input.billedGstin);
    const entityGstin = GST_ENTITIES[input.gstEntity].gstin.toUpperCase();
    if (!aiGstin || aiGstin === entityGstin) {
      gstOnBill = input.gstEntity;
      billedGstin = aiGstin || entityGstin;
    }
  }

  const companyOnBill =
    textMentionsBluridgeCompany(input.billedTo) ||
    textMentionsBluridgeCompany(input.description) ||
    textMentionsBluridgeCompany(blob);

  let billedTo = (input.billedTo || "").trim() || null;
  if (!billedTo && (companyOnBill || gstOnBill)) {
    billedTo = GST_ENTITIES.DEL.legalName;
  }

  const ourGstMentioned = Boolean(gstOnBill && billedGstin);

  let note: string | null = null;
  if (companyOnBill && !ourGstMentioned) {
    note =
      "BluRidge company name appears on the bill, but no BluRidge GSTIN — marked as GST not mentioned.";
  } else if (ourGstMentioned) {
    note = `BluRidge GSTIN on bill (${billedGstin} → ${gstOnBill}).`;
  }

  return {
    billedTo,
    ourGstMentioned,
    billedGstin: ourGstMentioned ? billedGstin : null,
    gstOnBill: ourGstMentioned ? gstOnBill : null,
    gstEntity: ourGstMentioned ? gstOnBill : null,
    note,
  };
}
