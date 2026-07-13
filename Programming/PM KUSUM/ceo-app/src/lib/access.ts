/**
 * Sensitive finance surfaces (agreements, plant fee/sanction) are limited to
 * Akshay Royal. Override with FINANCE_OWNER_EMAIL if needed.
 */
export const FINANCE_OWNER_EMAIL = (
  process.env.FINANCE_OWNER_EMAIL || "akshay@thebluridge.com"
)
  .trim()
  .toLowerCase();

export function isFinanceOwnerEmail(email?: string | null): boolean {
  return (email || "").trim().toLowerCase() === FINANCE_OWNER_EMAIL;
}

export function assertFinanceOwnerEmail(email?: string | null): void {
  if (!isFinanceOwnerEmail(email)) {
    throw new Error("Access denied — this area is restricted.");
  }
}
