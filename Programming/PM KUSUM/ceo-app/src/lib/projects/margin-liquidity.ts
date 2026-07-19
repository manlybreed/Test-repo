/**
 * PM KUSUM Borrower Disclosure Form v4 — Equity Calculation Guide:
 *
 * Step 1: Total DPR Project Cost
 * Step 2: Margin Money (Promoter Equity + USL) = 30% of DPR
 * Step 3: Minimum Liquid Net Worth Required = 50% of Margin Money
 * Step 4: Unsecured Loans (USL) allowed = up to 70% of Margin Money
 *
 * Liquidity (Section 3.2): compare Total Liquid Assets vs Step 3.
 * Own liquid sources must cover ≥30% of margin; USL ≤70% of margin.
 */

export type FormV4EquityCalc = {
  dprProjectCost: number | null;
  /** Step 2 — 30% of DPR */
  marginMoney: number | null;
  /** Step 3 — 50% of margin */
  minLiquidityRequired: number | null;
  /** Step 4 — 70% of margin */
  maxUslAllowed: number | null;
  /** Typical debt share — 70% of DPR (when loan blank) */
  loanAmountSuggested: number | null;
  /** Own liquid floor — 30% of margin */
  minOwnLiquidEquity: number | null;
  totalLiquidAssets: number | null;
  liquidityMet: "Yes" | "No" | null;
  liquidityShortfall: number | null;
};

/** Parse Indian-format INR strings (commas, ₹, lakh/crore). */
export function parseInrAmount(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  let s = String(v).trim();
  if (!s || /^n\/?a$/i.test(s) || s === "—" || s === "-") return null;

  const lower = s.toLowerCase().replace(/,/g, "");
  const crore = lower.match(/([\d.]+)\s*(cr|crore)s?\b/);
  if (crore) {
    const n = Number(crore[1]);
    return Number.isFinite(n) ? Math.round(n * 1e7) : null;
  }
  const lakh = lower.match(/([\d.]+)\s*(lakh|lac|lacs)\b/);
  if (lakh) {
    const n = Number(lakh[1]);
    return Number.isFinite(n) ? Math.round(n * 1e5) : null;
  }

  s = s.replace(/INR|Rs\.?|₹/gi, "").replace(/,/g, "").replace(/\s+/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function formatInrAmount(n: number): string {
  return `INR ${Math.round(n).toLocaleString("en-IN")}`;
}

/** Format without INR prefix (for fields that already say INR). */
export function formatInrDigits(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

const LIQUID_KEYS = [
  "bankBalance",
  "cash",
  "fd",
  "sharesMf",
  "gold",
  "receivables90d",
  "otherLiquid",
  "totalLiquid",
] as const;

/**
 * Sum Form v4 liquid assets from per-promoter breakdown.
 * Prefer row.totalLiquid when present; else sum line items (excluding totalLiquid).
 */
export function sumPromoterLiquidAssets(
  rows: Array<Record<string, string | null | undefined>> | null | undefined,
): number | null {
  if (!rows?.length) return null;
  let total = 0;
  let any = false;
  for (const row of rows) {
    const stated = parseInrAmount(row.totalLiquid);
    if (stated != null) {
      total += stated;
      any = true;
      continue;
    }
    let rowSum = 0;
    let rowAny = false;
    for (const k of LIQUID_KEYS) {
      if (k === "totalLiquid") continue;
      const n = parseInrAmount(row[k]);
      if (n != null) {
        rowSum += n;
        rowAny = true;
      }
    }
    if (rowAny) {
      total += rowSum;
      any = true;
    }
  }
  return any ? Math.round(total) : null;
}

/** Resolve total liquid: explicit field, else sum of promotersLiquidAssets. */
export function resolveTotalLiquidAssets(section23: {
  totalLiquidAssets?: string | null;
  promotersLiquidAssets?: Array<Record<string, string | null | undefined>> | null;
  notes?: string | null;
}): number | null {
  const direct = parseInrAmount(section23.totalLiquidAssets);
  if (direct != null) return direct;
  const fromRows = sumPromoterLiquidAssets(section23.promotersLiquidAssets);
  if (fromRows != null) return fromRows;
  return parseLiquidHintsFromText(section23.notes);
}

/**
 * Fallback: scrape bank/cash/FD amounts from AI notes when structured liquid rows are missing.
 * Example: "Bank Balance for Bhawana = 7.50 Lac, Cash = 1.25 Lac; Bank Balance for Harendra = 11.29 Lac"
 */
export function parseLiquidHintsFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const re =
    /(?:bank\s*balance|cash(?:\s*in\s*hand)?|fd(?:s)?|fixed\s*deposits?|liquid(?:\s*assets?)?)\s*(?:for\s+[^=]{1,40})?\s*[=:]\s*([\d,.]+)\s*(lac|lakh|lacs|cr|crore)?/gi;
  let total = 0;
  let any = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const raw = m[2] ? `${m[1]} ${m[2]}` : m[1];
    const n = parseInrAmount(raw);
    if (n != null) {
      total += n;
      any = true;
    }
  }
  return any ? Math.round(total) : null;
}

/**
 * Compute Form v4 equity / liquidity figures from DPR cost and/or margin money
 * plus promoter liquid assets.
 */
export function computeFormV4Equity(input: {
  dprProjectCost?: string | number | null;
  marginMoney?: string | number | null;
  totalLiquidAssets?: string | number | null;
}): FormV4EquityCalc {
  let dpr = parseInrAmount(input.dprProjectCost);
  let margin = parseInrAmount(input.marginMoney);

  if (margin == null && dpr != null) margin = Math.round(dpr * 0.3);
  if (dpr == null && margin != null) dpr = Math.round(margin / 0.3);

  const minLiquidityRequired = margin != null ? Math.round(margin * 0.5) : null;
  const maxUslAllowed = margin != null ? Math.round(margin * 0.7) : null;
  const minOwnLiquidEquity = margin != null ? Math.round(margin * 0.3) : null;
  const loanAmountSuggested = dpr != null ? Math.round(dpr * 0.7) : null;

  const totalLiquidAssets = parseInrAmount(input.totalLiquidAssets);
  let liquidityMet: "Yes" | "No" | null = null;
  let liquidityShortfall: number | null = null;

  if (minLiquidityRequired != null && totalLiquidAssets != null) {
    if (totalLiquidAssets + 0.5 >= minLiquidityRequired) {
      liquidityMet = "Yes";
      liquidityShortfall = 0;
    } else {
      liquidityMet = "No";
      liquidityShortfall = Math.round(minLiquidityRequired - totalLiquidAssets);
    }
  }

  return {
    dprProjectCost: dpr,
    marginMoney: margin,
    minLiquidityRequired,
    maxUslAllowed,
    loanAmountSuggested,
    minOwnLiquidEquity,
    totalLiquidAssets,
    liquidityMet,
    liquidityShortfall,
  };
}

/** Human label for "Is Minimum Liquidity Met?" cell on Form v4. */
export function formatLiquidityMetLabel(calc: FormV4EquityCalc): string | null {
  if (calc.liquidityMet === "Yes") return "Yes";
  if (calc.liquidityMet === "No") {
    const gap =
      calc.liquidityShortfall != null && calc.liquidityShortfall > 0
        ? formatInrAmount(calc.liquidityShortfall)
        : "";
    return gap ? `No — shortfall of ${gap}` : "No";
  }
  return null;
}

/** Enrich Section 3 liquidity fields from Form v4 + DPR margin. */
export function applyFormV4LiquidityToSection23(
  section23: {
    directors?: unknown[];
    promotersNetWorth?: unknown[];
    promotersLiquidAssets?: Array<Record<string, string | null | undefined>> | null;
    combinedNetWorth?: string | null;
    totalLiquidAssets?: string | null;
    minLiquidityRequired?: string | null;
    maxUslAllowed?: string | null;
    marginMoneyRequired?: string | null;
    liquidityMet?: string | null;
    liquidityShortfall?: string | null;
    liquidityGapPlan?: string | null;
    notes?: string | null;
  },
  financials?: {
    dprProjectCost?: string | null;
    marginMoney?: string | null;
  } | null,
  notesHint?: string | null,
): typeof section23 {
  const out = { ...section23 };

  // Always materialize totalLiquidAssets from breakdown / notes when missing
  const liquidNum = resolveTotalLiquidAssets({
    ...out,
    notes: notesHint ?? out.notes ?? null,
  });
  if (liquidNum != null) {
    out.totalLiquidAssets = formatInrAmount(liquidNum);
    // Fill per-row totals when line items exist but totalLiquid blank
    if (Array.isArray(out.promotersLiquidAssets)) {
      out.promotersLiquidAssets = out.promotersLiquidAssets.map((row) => {
        if (parseInrAmount(row.totalLiquid) != null) return row;
        let rowSum = 0;
        let any = false;
        for (const k of LIQUID_KEYS) {
          if (k === "totalLiquid") continue;
          const n = parseInrAmount(row[k]);
          if (n != null) {
            rowSum += n;
            any = true;
          }
        }
        return any ? { ...row, totalLiquid: formatInrAmount(rowSum) } : row;
      });
    }
  }

  const calc = computeFormV4Equity({
    dprProjectCost: financials?.dprProjectCost,
    marginMoney: financials?.marginMoney,
    totalLiquidAssets: out.totalLiquidAssets,
  });

  if (calc.marginMoney != null) {
    out.marginMoneyRequired = formatInrAmount(calc.marginMoney);
  }
  if (calc.minLiquidityRequired != null) {
    out.minLiquidityRequired = formatInrAmount(calc.minLiquidityRequired);
  }
  if (calc.maxUslAllowed != null) {
    out.maxUslAllowed = formatInrAmount(calc.maxUslAllowed);
  }
  const metLabel = formatLiquidityMetLabel(calc);
  if (metLabel) {
    out.liquidityMet = metLabel;
    out.liquidityShortfall =
      calc.liquidityShortfall != null && calc.liquidityShortfall > 0
        ? formatInrAmount(calc.liquidityShortfall)
        : calc.liquidityMet === "Yes"
          ? "Nil"
          : out.liquidityShortfall ?? null;
  }
  return out;
}
