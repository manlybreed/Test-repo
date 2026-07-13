export type GstEntity = "DEL" | "RAJ";

export type SellerGstProfile = {
  code: GstEntity;
  label: string;
  short: string;
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  gstin: string;
  color: string;
  bg: string;
};

/** BluRidge GST registrations — source of truth for invoice letterhead */
export const GST_ENTITIES: Record<GstEntity, SellerGstProfile> = {
  DEL: {
    code: "DEL",
    label: "DEL GST",
    short: "DEL",
    legalName: "BLURIDGE CONSULTING PRIVATE LIMITED",
    addressLine1: "Lower Ground Floor, D-1, Innov8 Ras Vilas",
    addressLine2: "Saket (South Delhi)",
    city: "New Delhi",
    state: "Delhi",
    stateCode: "07",
    pincode: "110017",
    gstin: "07AANCB9956E1Z7",
    color: "#818cf8",
    bg: "rgba(99,102,241,0.12)",
  },
  RAJ: {
    code: "RAJ",
    label: "RAJ GST",
    short: "RAJ",
    legalName: "BLURIDGE CONSULTING PRIVATE LIMITED",
    addressLine1: "Flat No 310, SDC The Destination",
    addressLine2: "Gandhi Path West, Vaishali Nagar",
    city: "Jaipur",
    state: "Rajasthan",
    stateCode: "08",
    pincode: "302021",
    gstin: "08AANCB9956E1Z5",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.12)",
  },
};

export function isGstEntity(v: string | null | undefined): v is GstEntity {
  return v === "DEL" || v === "RAJ";
}

export function normalizeGstEntity(v?: string | null): GstEntity {
  return v === "RAJ" ? "RAJ" : "DEL";
}

/** 15-char GSTIN body (no separators). Matches even when glued to GST/INGST prefixes. */
const GSTIN_BODY_RE = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]/gi;

/**
 * Pull a 15-char GSTIN out of messy OCR / labels like "IN GST08AANCB9956E1Z5",
 * "GSTIN: 08-AANC-B9956-E1Z5", etc.
 */
export function normalizeGstinCandidate(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = compact.match(GSTIN_BODY_RE);
  return m?.[0] ?? null;
}

/** All GSTIN-shaped tokens in free text (deduped, uppercase). */
export function extractGstinsFromText(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const compact = text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  // Also scan original with loose separators so we don't lose spaced GSTINs
  const spaced = text.toUpperCase();
  const found = new Set<string>();
  for (const src of [compact, spaced.replace(/[^A-Z0-9]/g, "")]) {
    for (const m of src.matchAll(GSTIN_BODY_RE)) {
      found.add(m[0]);
    }
  }
  // Direct pass on original with optional separators between chars
  const loose =
    /[0-9]{2}[\s\-]*[A-Z]{5}[\s\-]*[0-9]{4}[\s\-]*[A-Z][\s\-]*[A-Z0-9][\s\-]*Z[\s\-]*[A-Z0-9]/gi;
  for (const m of spaced.matchAll(loose)) {
    const n = normalizeGstinCandidate(m[0]);
    if (n) found.add(n);
  }
  return [...found];
}

/** Map BluRidge GSTIN → DEL / RAJ (client-safe). Accepts messy OCR strings. */
export function gstEntityFromSellerGstin(gstin?: string | null): GstEntity | null {
  const normalized = normalizeGstinCandidate(gstin);
  if (!normalized) return null;
  if (normalized === GST_ENTITIES.DEL.gstin.toUpperCase()) return "DEL";
  if (normalized === GST_ENTITIES.RAJ.gstin.toUpperCase()) return "RAJ";
  return null;
}

export function getSellerProfile(entity?: string | null): SellerGstProfile {
  return GST_ENTITIES[normalizeGstEntity(entity)];
}

export function formatSellerAddress(entity?: string | null): string {
  const s = getSellerProfile(entity);
  return [s.addressLine1, s.addressLine2, s.city, s.state, s.pincode]
    .filter(Boolean)
    .join(", ");
}

/** Same state code → CGST+SGST; otherwise IGST */
export function shouldUseIgst(sellerEntity: GstEntity | string | null | undefined, buyerStateCode?: string | null): boolean {
  const seller = getSellerProfile(sellerEntity);
  const code = buyerStateCode?.trim();
  if (!code) return false;
  return code !== seller.stateCode;
}
