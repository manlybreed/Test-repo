/**
 * GSTIN format + checksum (Modulo 36) validation.
 * Character set: 0-9 A-Z
 */

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function isGstinFormat(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin.toUpperCase());
}

export function gstinChecksumChar(body14: string): string {
  const upper = body14.toUpperCase();
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(upper[i]!);
    if (code < 0) return "";
    let product = factor * code;
    factor = factor === 1 ? 2 : 1;
    product = Math.floor(product / 36) + (product % 36);
    sum += product;
  }
  const checkCode = (36 - (sum % 36)) % 36;
  return GSTIN_CHARS[checkCode]!;
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin?.trim()) return false;
  const g = gstin.trim().toUpperCase();
  if (!isGstinFormat(g)) return false;
  return gstinChecksumChar(g.slice(0, 14)) === g[14];
}

export function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.trim().slice(0, 2);
}
