/** Shared salary math for employees (TDS is a % of gross). */
export function employeeSalaryTotals(e: {
  basic: number;
  hra: number;
  special: number;
  otherAllow: number;
  pf: number;
  professionalTax: number;
  tdsPercent: number;
  otherDeduct: number;
}) {
  const gross = e.basic + e.hra + e.special + e.otherAllow;
  const tdsAmount = Math.round(((gross * (e.tdsPercent || 0)) / 100) * 100) / 100;
  const totalDeduct = e.pf + e.professionalTax + tdsAmount + e.otherDeduct;
  const netPay = gross - totalDeduct;
  return { gross, tdsAmount, totalDeduct, netPay };
}
