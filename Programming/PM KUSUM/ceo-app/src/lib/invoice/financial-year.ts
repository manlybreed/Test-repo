/** Indian GST financial year helpers (1 Apr – 31 Mar). */

export function financialYearFromDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based
  const startYear = m >= 3 ? y : y - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

/** Short FY token for invoice numbers, e.g. 2025-26 → 2526 */
export function financialYearShort(fy: string): string {
  const [a, b] = fy.split("-");
  if (!a || !b) return fy.replace(/[^0-9]/g, "").slice(0, 4);
  return `${a.slice(-2)}${b.padStart(2, "0").slice(-2)}`;
}
