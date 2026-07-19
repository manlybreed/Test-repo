import { financialYearFromDate } from "@/lib/invoice/financial-year";

/**
 * Sec 36 retention heuristic (not legal advice):
 * retentionUntil = 31 Dec of FY-end calendar year (annual return due proxy) + retentionMonths.
 * Example: FY 2025-26 → annual due ~31 Dec 2026 → +72 months → 31 Dec 2032.
 */
export function retentionUntilForDate(
  documentDate: Date,
  retentionMonths = 72,
): Date {
  const fy = financialYearFromDate(documentDate);
  const startYear = Number(fy.split("-")[0]);
  if (!Number.isFinite(startYear)) {
    const d = new Date(documentDate);
    d.setMonth(d.getMonth() + retentionMonths + 12);
    return d;
  }
  // Annual return due: 31 Dec of the year in which FY ends (FY ends 31 Mar startYear+1)
  const annualDue = new Date(startYear + 1, 11, 31, 23, 59, 59);
  const until = new Date(annualDue);
  until.setMonth(until.getMonth() + retentionMonths);
  return until;
}

export function periodYmFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isWithinRetention(retentionUntil: Date, now = new Date()): boolean {
  return now.getTime() < retentionUntil.getTime();
}
