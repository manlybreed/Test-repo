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

/** Map BluRidge seller GSTIN → DEL / RAJ (client-safe) */
export function gstEntityFromSellerGstin(gstin?: string | null): GstEntity | null {
  if (!gstin?.trim()) return null;
  const normalized = gstin.trim().toUpperCase();
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
