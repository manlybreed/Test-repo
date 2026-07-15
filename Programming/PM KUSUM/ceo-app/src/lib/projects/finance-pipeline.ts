export const FINANCE_STAGES = [
  "DOCUMENTATION",
  "MAIL",
  "FIELD_VISIT",
  "CMA",
  "SANCTION",
  "DISBURSEMENT",
] as const;

export type FinanceStage = (typeof FINANCE_STAGES)[number];

export const FINANCE_STAGE_LABELS: Record<FinanceStage, string> = {
  DOCUMENTATION: "Documentation",
  MAIL: "Mail",
  FIELD_VISIT: "Field visit",
  CMA: "CMA",
  SANCTION: "Sanction",
  DISBURSEMENT: "Disbursement",
};

/** Business verticals that contribute to BluRidge financing income. */
export const FINANCING_VERTICALS = [
  { id: "pm-kusum", label: "PM KUSUM" },
] as const;

export type FinancingVerticalId = (typeof FINANCING_VERTICALS)[number]["id"];

export function isFinanceStage(v: string): v is FinanceStage {
  return (FINANCE_STAGES as readonly string[]).includes(v);
}

export function financeStageIndex(stage: string): number {
  const i = FINANCE_STAGES.indexOf(stage as FinanceStage);
  return i < 0 ? 0 : i;
}

/** 0–100 progress through the 6 financing stages. */
export function financeStageProgress(stage: string): number {
  return Math.round(((financeStageIndex(stage) + 1) / FINANCE_STAGES.length) * 100);
}

export function parseCapacityMw(raw?: string | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** PPA tariff as ₹/kWh from free-text like "3.14" or "₹3.14/kWh". */
export function parseTariff(raw?: string | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ₹ / MW when both sanction and capacity are known. */
export function fundPerMw(
  sanctionAmount?: number | null,
  capacityMw?: string | null,
): number | null {
  const mw = parseCapacityMw(capacityMw);
  if (sanctionAmount == null || mw == null || mw <= 0) return null;
  return sanctionAmount / mw;
}

export function formatFeePercent(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return "";
  return `${v}%`;
}

export function formatFeeFlat(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

/** Display fee as % or flat ₹ depending on what is set. */
export function formatFeeDisplay(
  feePercent?: number | null,
  feeFlat?: number | null,
): string {
  if (feeFlat != null && feeFlat > 0) {
    return `₹${formatFeeFlat(feeFlat)}`;
  }
  return formatFeePercent(feePercent);
}

export function parseFeePercentInput(raw: string): number | null {
  const t = raw.trim().replace(/%/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse a flexible fee field: "1.25%", "1.25", "₹5,50,000", "550000".
 * Empty string clears both. Returns "invalid" when the value cannot be parsed.
 */
export function parseFeeInput(
  raw: string,
): { feePercent: number | null; feeFlat: number | null } | "invalid" {
  const t = raw.trim();
  if (!t) return { feePercent: null, feeFlat: null };

  if (/%/.test(t)) {
    const n = Number(t.replace(/%/g, "").replace(/,/g, "").trim());
    if (!Number.isFinite(n) || n < 0) return "invalid";
    return { feePercent: n, feeFlat: null };
  }

  const hasCurrencyHint = /₹|rs\.?|inr/i.test(t);
  const normalized = t
    .replace(/₹/gi, "")
    .replace(/\brs\.?\b/gi, "")
    .replace(/\binr\b/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  // 5.5L / 5.5Lac / 2Cr
  const lakh = normalized.match(/^([\d.]+)\s*(l|lac|lakh)s?$/i);
  if (lakh) {
    const n = Number(lakh[1]) * 100_000;
    if (!Number.isFinite(n) || n <= 0) return "invalid";
    return { feePercent: null, feeFlat: n };
  }
  const cr = normalized.match(/^([\d.]+)\s*(cr|crore)s?$/i);
  if (cr) {
    const n = Number(cr[1]) * 10_000_000;
    if (!Number.isFinite(n) || n <= 0) return "invalid";
    return { feePercent: null, feeFlat: n };
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return "invalid";

  // Small numbers without currency → treat as percent (typical 0.5–5%).
  if (!hasCurrencyHint && n > 0 && n < 50) {
    return { feePercent: n, feeFlat: null };
  }
  return { feePercent: null, feeFlat: n };
}

/** Resolved success-fee payout for one plant (flat preferred). */
export function resolveFeePayout(input: {
  feePercent?: number | null;
  feeFlat?: number | null;
  sanctionAmount?: number | null;
}): number | null {
  if (input.feeFlat != null && Number.isFinite(input.feeFlat) && input.feeFlat > 0) {
    return input.feeFlat;
  }
  if (
    input.feePercent != null &&
    Number.isFinite(input.feePercent) &&
    input.sanctionAmount != null &&
    Number.isFinite(input.sanctionAmount) &&
    input.sanctionAmount > 0
  ) {
    return (input.sanctionAmount * input.feePercent) / 100;
  }
  return null;
}

export function formatSanctionInput(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

export function parseSanctionInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "").replace(/₹/g, "").replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** AppSetting key for a vertical's target income (₹). */
export function verticalTargetIncomeKey(verticalId: FinancingVerticalId): string {
  return `financingTargetIncome:${verticalId}`;
}

export type PlantFinanceInputs = {
  capacityMw?: string | null;
  tariff?: string | null;
  sanctionAmount?: number | null;
  feePercent?: number | null;
  feeFlat?: number | null;
};

export type VerticalAverages = {
  avgCapacityMw: number | null;
  avgTariff: number | null;
  /** Mean fee % among plants that use %-based fees. */
  avgFeePercent: number | null;
  /** Mean flat fee among plants that use flat fees. */
  avgFeeFlat: number | null;
  /** Observed mean sanction from plants that have one. */
  avgSanctionObserved: number | null;
  /**
   * Tariff×capacity–aware sanction estimate.
   * Prefer k × avgCapacity × avgTariff where k = mean(sanction / (MW × tariff)).
   * Falls back to avg ₹/MW × avgCapacity, then observed avg sanction.
   */
  avgSanctionEstimated: number | null;
  /** Sanction used for deal math (estimated preferred). */
  avgSanction: number | null;
  avgFundPerMw: number | null;
  /** Mean resolved payout per deal (flat or sanction×%). */
  avgPayout: number | null;
  sample: {
    plants: number;
    withSanction: number;
    withFee: number;
    withFeePercent: number;
    withFeeFlat: number;
    withTariff: number;
    withCapacity: number;
  };
};

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Portfolio averages for deal / income planning.
 * Sanction estimate weights tariff and capacity because bank sanction
 * scales with project size and PPA revenue (tariff × MW).
 */
export function computeVerticalAverages(
  plants: PlantFinanceInputs[],
): VerticalAverages {
  const capacities = plants
    .map((p) => parseCapacityMw(p.capacityMw))
    .filter((n): n is number => n != null);
  const tariffs = plants
    .map((p) => parseTariff(p.tariff))
    .filter((n): n is number => n != null);
  const feesPct = plants
    .filter((p) => !(p.feeFlat != null && p.feeFlat > 0))
    .map((p) => p.feePercent)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const feesFlat = plants
    .map((p) => p.feeFlat)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
  const payouts = plants
    .map((p) =>
      resolveFeePayout({
        feePercent: p.feePercent,
        feeFlat: p.feeFlat,
        sanctionAmount: p.sanctionAmount,
      }),
    )
    .filter((n): n is number => n != null);
  const sanctions = plants
    .map((p) => p.sanctionAmount)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);

  const fundPerMwValues: number[] = [];
  const sanctionPerMwTariff: number[] = [];
  for (const p of plants) {
    const mw = parseCapacityMw(p.capacityMw);
    const tariff = parseTariff(p.tariff);
    const sanction = p.sanctionAmount;
    if (sanction != null && mw != null && mw > 0) {
      fundPerMwValues.push(sanction / mw);
      if (tariff != null && tariff > 0) {
        sanctionPerMwTariff.push(sanction / (mw * tariff));
      }
    }
  }

  const avgCapacityMw = mean(capacities);
  const avgTariff = mean(tariffs);
  const avgFeePercent = mean(feesPct);
  const avgFeeFlat = mean(feesFlat);
  const avgSanctionObserved = mean(sanctions);
  const avgFundPerMw = mean(fundPerMwValues);
  const k = mean(sanctionPerMwTariff);

  let avgSanctionEstimated: number | null = null;
  if (k != null && avgCapacityMw != null && avgTariff != null) {
    avgSanctionEstimated = k * avgCapacityMw * avgTariff;
  } else if (avgFundPerMw != null && avgCapacityMw != null) {
    avgSanctionEstimated = avgFundPerMw * avgCapacityMw;
  } else {
    avgSanctionEstimated = avgSanctionObserved;
  }

  const avgSanction = avgSanctionEstimated ?? avgSanctionObserved;
  // Prefer observed mean payout; if none yet, estimate from avg sanction × avg %
  // or avg flat fee.
  let avgPayout = mean(payouts);
  if (avgPayout == null) {
    if (avgFeeFlat != null) avgPayout = avgFeeFlat;
    else if (avgSanction != null && avgFeePercent != null) {
      avgPayout = (avgSanction * avgFeePercent) / 100;
    }
  }

  return {
    avgCapacityMw,
    avgTariff,
    avgFeePercent,
    avgFeeFlat,
    avgSanctionObserved,
    avgSanctionEstimated,
    avgSanction,
    avgFundPerMw,
    avgPayout,
    sample: {
      plants: plants.length,
      withSanction: sanctions.length,
      withFee: payouts.length || feesPct.length + feesFlat.length,
      withFeePercent: feesPct.length,
      withFeeFlat: feesFlat.length,
      withTariff: tariffs.length,
      withCapacity: capacities.length,
    },
  };
}

export type VerticalIncomePlan = {
  targetIncome: number;
  incomeEarned: number;
  incomeGap: number;
  incomePct: number;
  avgPayout: number | null;
  dealsRequired: number | null;
  dealsDone: number;
  dealsRemaining: number | null;
  /** Capital to raise ≈ dealsRequired × avgSanction */
  capitalNeeded: number | null;
  /** MW to close ≈ dealsRequired × avgCapacity */
  mwNeeded: number | null;
};

export function computeIncomePlan(input: {
  targetIncome: number;
  incomeEarned: number;
  dealsDone: number;
  averages: VerticalAverages;
}): VerticalIncomePlan {
  const { targetIncome, incomeEarned, dealsDone, averages } = input;
  const avgPayout = averages.avgPayout;
  const dealsRequired =
    avgPayout != null && avgPayout > 0 && targetIncome > 0
      ? Math.ceil(targetIncome / avgPayout)
      : null;
  const dealsRemaining =
    dealsRequired != null ? Math.max(0, dealsRequired - dealsDone) : null;
  const capitalNeeded =
    dealsRequired != null && averages.avgSanction != null
      ? dealsRequired * averages.avgSanction
      : null;
  const mwNeeded =
    dealsRequired != null && averages.avgCapacityMw != null
      ? dealsRequired * averages.avgCapacityMw
      : null;

  return {
    targetIncome,
    incomeEarned,
    incomeGap: Math.max(0, targetIncome - incomeEarned),
    incomePct:
      targetIncome > 0
        ? Math.min(100, (incomeEarned / targetIncome) * 100)
        : 0,
    avgPayout,
    dealsRequired,
    dealsDone,
    dealsRemaining,
    capitalNeeded,
    mwNeeded,
  };
}
