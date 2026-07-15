"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  getFinancingDashboard,
  setVerticalTargetIncome,
} from "@/actions/plant-registry";
import {
  FINANCE_STAGES,
  FINANCE_STAGE_LABELS,
  formatSanctionInput,
  parseSanctionInput,
  type FinanceStage,
  type FinancingVerticalId,
} from "@/lib/projects/finance-pipeline";
import { formatINR } from "@/lib/utils";
import { FinanceProgressCell } from "@/components/plant-finance-pipeline";

type Dashboard = Awaited<ReturnType<typeof getFinancingDashboard>>;

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        className="text-[0.65rem] uppercase tracking-wider font-semibold mb-2"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </p>
      <p
        className="text-xl font-bold tabular-nums tracking-tight"
        style={{ color: accent || "var(--text)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.min(100, Math.max(2, pct))}%`,
            background: "linear-gradient(90deg, #6366f1, #34d399)",
          }}
        />
      </div>
    </div>
  );
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function FinancingClient({ initial }: { initial: Dashboard }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [incomeDrafts, setIncomeDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        initial.verticals.map((v) => [
          v.id,
          formatSanctionInput(v.targetIncome || null) || "",
        ]),
      ),
  );

  const { progress: p, growth, byStage, showFees, portfolio, verticals } = data;

  function saveVerticalIncome(verticalId: FinancingVerticalId) {
    start(async () => {
      try {
        setError("");
        const raw = incomeDrafts[verticalId] || "";
        const targetIncome = parseSanctionInput(raw);
        if (targetIncome !== null && Number.isNaN(targetIncome)) {
          setError("Invalid target income");
          return;
        }
        await setVerticalTargetIncome(verticalId, targetIncome ?? 0);
        const next = await getFinancingDashboard();
        setData(next);
        setIncomeDrafts(
          Object.fromEntries(
            next.verticals.map((v) => [
              v.id,
              formatSanctionInput(v.targetIncome || null) || "",
            ]),
          ),
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="space-y-8">
      {error && (
        <p
          className="text-xs px-3 py-2 rounded-lg"
          style={{ color: "#fecaca", background: "rgba(239,68,68,0.12)" }}
        >
          {error}
        </p>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Target income (all verticals)"
          value={
            portfolio.totalTargetIncome > 0
              ? formatINR(portfolio.totalTargetIncome)
              : "—"
          }
          sub={
            showFees
              ? `Earned ${formatINR(portfolio.totalIncomeEarned)}`
              : "Set per-vertical targets below"
          }
          accent="#a5b4fc"
        />
        <StatCard
          label="Deals required (derived)"
          value={
            portfolio.totalDealsRequired != null
              ? String(portfolio.totalDealsRequired)
              : "—"
          }
          sub={
            portfolio.totalDealsRemaining != null
              ? `${portfolio.totalDealsDone} done · ${portfolio.totalDealsRemaining} left`
              : "Needs fee + sanction averages"
          }
        />
        <StatCard
          label="Income progress"
          value={`${Math.round(portfolio.incomePct)}%`}
          sub={
            showFees && portfolio.totalTargetIncome > 0
              ? `Gap ${formatINR(portfolio.totalIncomeGap)}`
              : "—"
          }
          accent="#6ee7b7"
        />
        <StatCard
          label="Interest (avg / min)"
          value={
            p.avgInterest != null
              ? `${p.avgInterest.toFixed(2)}% / ${p.minInterest?.toFixed(2) ?? "—"}%`
              : "—"
          }
          sub="Lower is better"
        />
      </section>

      {verticals.map((v) => {
        const a = v.averages;
        const plan = v.plan;
        return (
          <section
            key={v.id}
            className="rounded-xl p-5 space-y-5"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p
                  className="text-[0.6rem] tracking-[0.22em] uppercase font-semibold mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  Vertical
                </p>
                <h2 className="text-lg font-semibold">{v.label}</h2>
                <p className="text-xs mt-1 max-w-xl" style={{ color: "var(--text-muted)" }}>
                  Deals required = target income ÷ avg payout. Avg payout = estimated
                  sanction × fee (% or flat). Sanction estimate uses tariff × capacity from the
                  portfolio (bank sanction scales with PPA revenue and plant size).
                </p>
              </div>
              <div className="flex items-end gap-2">
                <label className="block min-w-[12rem]">
                  <span className="label">Target income (₹)</span>
                  <input
                    className="input text-sm py-2"
                    value={incomeDrafts[v.id] || ""}
                    placeholder="e.g. 2,00,00,000"
                    disabled={pending}
                    onChange={(e) =>
                      setIncomeDrafts((d) => ({
                        ...d,
                        [v.id]: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const n = parseSanctionInput(incomeDrafts[v.id] || "");
                      if (n !== null && !Number.isNaN(n)) {
                        setIncomeDrafts((d) => ({
                          ...d,
                          [v.id]: formatSanctionInput(n),
                        }));
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn text-xs py-2 px-3"
                  disabled={pending}
                  onClick={() => saveVerticalIncome(v.id)}
                >
                  Save
                </button>
              </div>
            </div>

            {showFees ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <StatCard
                    label="Avg capacity"
                    value={a.avgCapacityMw != null ? `${fmtNum(a.avgCapacityMw)} MW` : "—"}
                  />
                  <StatCard
                    label="Avg tariff"
                    value={
                      a.avgTariff != null ? `₹${fmtNum(a.avgTariff)}/kWh` : "—"
                    }
                  />
                  <StatCard
                    label="Avg fee"
                    value={
                      a.avgFeeFlat != null && !(a.avgFeePercent != null)
                        ? formatINR(Math.round(a.avgFeeFlat))
                        : a.avgFeePercent != null && !(a.avgFeeFlat != null)
                          ? `${fmtNum(a.avgFeePercent)}%`
                          : a.avgFeePercent != null && a.avgFeeFlat != null
                            ? `${fmtNum(a.avgFeePercent)}% · ${formatINR(Math.round(a.avgFeeFlat))}`
                            : "—"
                    }
                    sub={
                      a.sample.withFeeFlat > 0 && a.sample.withFeePercent > 0
                        ? "Mix of % and flat"
                        : a.sample.withFeeFlat > 0
                          ? "Flat fee deals"
                          : a.sample.withFeePercent > 0
                            ? "% of sanction"
                            : undefined
                    }
                  />
                  <StatCard
                    label="Avg sanction"
                    value={
                      a.avgSanction != null
                        ? formatINR(Math.round(a.avgSanction))
                        : "—"
                    }
                    sub={
                      a.avgSanctionEstimated != null &&
                      a.avgSanctionObserved != null &&
                      Math.round(a.avgSanctionEstimated) !==
                        Math.round(a.avgSanctionObserved)
                        ? `Observed ${formatINR(Math.round(a.avgSanctionObserved))}`
                        : "From tariff × MW"
                    }
                  />
                  <StatCard
                    label="Avg payout / deal"
                    value={
                      a.avgPayout != null
                        ? formatINR(Math.round(a.avgPayout))
                        : "—"
                    }
                    accent="#6ee7b7"
                  />
                  <StatCard
                    label="Avg ₹ / MW"
                    value={
                      a.avgFundPerMw != null
                        ? formatINR(Math.round(a.avgFundPerMw))
                        : "—"
                    }
                  />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    label="Deals required"
                    value={
                      plan.dealsRequired != null
                        ? String(plan.dealsRequired)
                        : "—"
                    }
                    sub={
                      plan.dealsRemaining != null
                        ? `${plan.dealsDone} done · ${plan.dealsRemaining} left`
                        : "Add fee (% or flat ₹) and sanctions on plants"
                    }
                    accent="#a5b4fc"
                  />
                  <StatCard
                    label="Income earned"
                    value={formatINR(plan.incomeEarned)}
                    sub={
                      plan.targetIncome > 0
                        ? `of ${formatINR(plan.targetIncome)}`
                        : "Set target income"
                    }
                  />
                  <StatCard
                    label="Capital to raise"
                    value={
                      plan.capitalNeeded != null
                        ? formatINR(Math.round(plan.capitalNeeded))
                        : "—"
                    }
                    sub="deals × avg sanction"
                  />
                  <StatCard
                    label="MW to close"
                    value={
                      plan.mwNeeded != null
                        ? `${fmtNum(plan.mwNeeded, 1)} MW`
                        : "—"
                    }
                    sub="deals × avg capacity"
                  />
                </div>

                <ProgressBar
                  pct={plan.incomePct}
                  label={`${v.label} income vs target`}
                />
                {plan.dealsRequired != null && (
                  <ProgressBar
                    pct={
                      plan.dealsRequired > 0
                        ? Math.min(
                            100,
                            (plan.dealsDone / plan.dealsRequired) * 100,
                          )
                        : 0
                    }
                    label={`${v.label} deals vs required`}
                  />
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Fee / income planning is visible to the finance owner. Pipeline
                progress below is still available to everyone.
              </p>
            )}
          </section>
        );
      })}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-xl p-5 space-y-4"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
          }}
        >
          <h2 className="text-base font-semibold">PM KUSUM pipeline</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Active plants"
              value={String(p.plants)}
              sub={`${p.sanctionedMw.toFixed(1)} / ${p.totalMw.toFixed(1)} MW sanctioned`}
            />
            <StatCard
              label="Disbursed"
              value={
                p.totalDisbursed != null ? formatINR(p.totalDisbursed) : "—"
              }
              sub={
                p.totalSanctioned != null
                  ? `Sanctioned ${formatINR(p.totalSanctioned)}`
                  : undefined
              }
            />
          </div>
        </div>

        <div
          className="rounded-xl p-5 space-y-4"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
          }}
        >
          <h2 className="text-base font-semibold">Growth</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Sanctions · 30 days"
              value={String(growth.sanctions30d)}
              accent="#34d399"
            />
            <StatCard
              label="Sanctions · 90 days"
              value={String(growth.sanctions90d)}
            />
          </div>
          <h3
            className="text-xs uppercase tracking-wider font-semibold pt-2"
            style={{ color: "var(--text-dim)" }}
          >
            By stage
          </h3>
          <div className="space-y-2">
            {FINANCE_STAGES.map((stage) => {
              const count = byStage[stage] || 0;
              const pct = p.plants > 0 ? (count / p.plants) * 100 : 0;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span
                    className="text-xs w-24 shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {FINANCE_STAGE_LABELS[stage]}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(count > 0 ? 4 : 0, pct)}%`,
                        background: "linear-gradient(90deg, #6366f1, #34d399)",
                      }}
                    />
                  </div>
                  <span className="text-xs tabular-nums w-6 text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Plants in pipeline</h2>
          <Link
            href="/ceo/projects"
            className="text-xs underline"
            style={{ color: "#a5b4fc" }}
          >
            Open projects
          </Link>
        </div>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <table className="data">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Plant</th>
                <th>MW</th>
                <th>Tariff</th>
                <th>Bank</th>
                <th>Pipeline</th>
                <th>Interest</th>
                {showFees && <th>₹ / MW</th>}
                {showFees && <th>Sanction</th>}
              </tr>
            </thead>
            <tbody>
              {data.plants.map((plant) => (
                <tr key={plant.id}>
                  <td className="font-medium">
                    <Link
                      href="/ceo/projects"
                      className="hover:underline"
                      style={{ color: "inherit" }}
                    >
                      {plant.name}
                    </Link>
                  </td>
                  <td className="tabular-nums text-sm">
                    {plant.capacityMw || "—"}
                  </td>
                  <td className="tabular-nums text-sm">
                    {plant.tariff || "—"}
                  </td>
                  <td className="text-sm">{plant.bankName || "—"}</td>
                  <td>
                    <FinanceProgressCell
                      stage={
                        (plant.financeStage || "DOCUMENTATION") as FinanceStage
                      }
                      progress={plant.financeProgress}
                    />
                  </td>
                  <td className="tabular-nums text-sm">
                    {plant.interestRate != null
                      ? `${plant.interestRate}%`
                      : "—"}
                  </td>
                  {showFees && (
                    <td className="tabular-nums text-sm">
                      {plant.fundPerMw != null
                        ? formatINR(Math.round(plant.fundPerMw))
                        : "—"}
                    </td>
                  )}
                  {showFees && (
                    <td className="tabular-nums text-sm">
                      {plant.sanctionAmount != null
                        ? formatINR(plant.sanctionAmount)
                        : "—"}
                    </td>
                  )}
                </tr>
              ))}
              {data.plants.length === 0 && (
                <tr>
                  <td
                    colSpan={showFees ? 8 : 6}
                    className="text-center text-sm py-8"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No active plants yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
