"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  SalarySlipDeleteButton,
  SalarySlipRegenerateButton,
} from "@/components/salary-slip-row-actions";
import { SalarySlipStatusCell } from "@/components/salary-slip-status-cell";
import { GlassSelect } from "@/components/glass-select";
import { formatINR, monthName } from "@/lib/utils";

export type SalarySlipDbRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  emailOfficial: string | null;
  phone: string | null;
  month: number;
  year: number;
  gross: number;
  tds: number;
  totalDeduct: number;
  netPay: number;
  paymentStatus: string;
  filePath: string | null;
};

type TdsFilter = "ALL" | "YES" | "NO";
type PayFilter = "ALL" | "PAID" | "UNPAID";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const compactInput: CSSProperties = {
  padding: "0.35rem 0.6rem",
  fontSize: "0.8rem",
  minHeight: 32,
};

function Chip({
  active,
  label,
  onClick,
  activeColor = "#a78bfa",
  activeBg = "rgba(139,92,246,0.15)",
  activeBorder = "rgba(139,92,246,0.35)",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  activeColor?: string;
  activeBg?: string;
  activeBorder?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[0.6rem] font-bold px-2 py-0.5 rounded-md transition-all"
      style={{
        background: active ? activeBg : "rgba(255,255,255,0.02)",
        color: active ? activeColor : "rgba(255,255,255,0.4)",
        border: `1px solid ${active ? activeBorder : "rgba(255,255,255,0.08)"}`,
      }}
    >
      {label}
    </button>
  );
}

export function SalarySlipDatabase({ slips }: { slips: SalarySlipDbRow[] }) {
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [tds, setTds] = useState<TdsFilter>("ALL");
  const [pay, setPay] = useState<PayFilter>("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});

  const employeeOptions = useMemo(() => {
    return [...new Set(slips.map((s) => s.employeeName))].sort((a, b) => a.localeCompare(b));
  }, [slips]);

  const departmentOptions = useMemo(() => {
    return [
      ...new Set(slips.map((s) => s.department).filter(Boolean) as string[]),
    ].sort((a, b) => a.localeCompare(b));
  }, [slips]);

  const yearOptions = useMemo(() => {
    return [...new Set(slips.map((s) => s.year))].sort((a, b) => b - a);
  }, [slips]);

  const filtered = useMemo(() => {
    const eq = employee.trim().toLowerCase();
    const dq = department.trim().toLowerCase();
    const min = amountMin.trim() === "" ? null : Number(amountMin);
    const max = amountMax.trim() === "" ? null : Number(amountMax);
    const yearN = year.trim() === "" ? null : Number(year);
    const monthN = month.trim() === "" ? null : Number(month);

    return slips.filter((s) => {
      const status = statusOverrides[s.id] ?? s.paymentStatus;
      if (
        eq &&
        !s.employeeName.toLowerCase().includes(eq) &&
        !(s.employeeCode || "").toLowerCase().includes(eq)
      ) {
        return false;
      }
      if (dq && !(s.department || "").toLowerCase().includes(dq)) return false;
      if (yearN != null && !Number.isNaN(yearN) && s.year !== yearN) return false;
      if (monthN != null && !Number.isNaN(monthN) && s.month !== monthN) return false;
      if (min != null && !Number.isNaN(min) && s.netPay < min) return false;
      if (max != null && !Number.isNaN(max) && s.netPay > max) return false;
      if (tds === "YES" && s.tds <= 0) return false;
      if (tds === "NO" && s.tds > 0) return false;
      if (pay === "PAID" && status !== "PAID") return false;
      if (pay === "UNPAID" && status === "PAID") return false;
      return true;
    });
  }, [
    slips,
    employee,
    department,
    year,
    month,
    amountMin,
    amountMax,
    tds,
    pay,
    statusOverrides,
  ]);

  const hasFilters =
    !!(employee ||
      department ||
      year ||
      month ||
      amountMin ||
      amountMax ||
      tds !== "ALL" ||
      pay !== "ALL");

  function clearFilters() {
    setEmployee("");
    setDepartment("");
    setYear("");
    setMonth("");
    setAmountMin("");
    setAmountMax("");
    setTds("ALL");
    setPay("ALL");
  }

  const filteredNet = filtered.reduce((sum, s) => sum + s.netPay, 0);

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Salary slips database</h2>
          <span
            className="text-[0.65rem] px-1.5 py-0.5 rounded tabular-nums"
            style={{
              background: "rgba(16,185,129,0.1)",
              border: "1px solid rgba(16,185,129,0.2)",
              color: "#34d399",
            }}
          >
            {filtered.length}
            {hasFilters ? ` / ${slips.length}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <span className="text-[0.65rem] tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
              {formatINR(filteredNet)} net
            </span>
          )}
          <button
            type="button"
            className="text-[0.65rem] font-semibold px-2.5 py-1 rounded-lg transition-all"
            style={{
              background: filtersOpen || hasFilters ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${
                filtersOpen || hasFilters ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.1)"
              }`,
              color: filtersOpen || hasFilters ? "#a5b4fc" : "rgba(255,255,255,0.55)",
            }}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            {filtersOpen ? "Hide filters" : hasFilters ? "Filters on" : "Filters"}
          </button>
          {hasFilters && (
            <button type="button" className="btn btn-ghost text-[0.65rem] py-1 px-2" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div
          className="rounded-xl px-3 py-2.5 mb-2.5"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow" style={{ minWidth: 140, flexBasis: 160 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Employee
              </label>
              <input
                className="input"
                style={compactInput}
                list="salary-employee-filter"
                placeholder="Name or code…"
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
              />
              <datalist id="salary-employee-filter">
                {employeeOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div style={{ minWidth: 110, flexBasis: 120 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Dept
              </label>
              <input
                className="input"
                style={compactInput}
                list="salary-dept-filter"
                placeholder="Any"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
              <datalist id="salary-dept-filter">
                {departmentOptions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div style={{ minWidth: 100, flexBasis: 100 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Year
              </label>
              <GlassSelect
                value={year}
                onChange={setYear}
                placeholder="All"
                buttonStyle={compactInput}
                options={[
                  { value: "", label: "All years" },
                  ...yearOptions.map((y) => ({ value: String(y), label: String(y) })),
                ]}
              />
            </div>
            <div style={{ minWidth: 110, flexBasis: 110 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Month
              </label>
              <GlassSelect
                value={month}
                onChange={setMonth}
                placeholder="All"
                buttonStyle={compactInput}
                options={[
                  { value: "", label: "All months" },
                  ...MONTHS.map((m) => ({ value: String(m), label: monthName(m) })),
                ]}
              />
            </div>
            <div style={{ minWidth: 88, flexBasis: 88 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Net min
              </label>
              <input
                className="input"
                style={compactInput}
                type="number"
                min={0}
                placeholder="0"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
            </div>
            <div style={{ minWidth: 88, flexBasis: 88 }}>
              <label className="label mb-0.5" style={{ fontSize: "0.58rem" }}>
                Net max
              </label>
              <input
                className="input"
                style={compactInput}
                type="number"
                min={0}
                placeholder="Any"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 pb-0.5">
              <span className="label mb-0" style={{ fontSize: "0.58rem" }}>
                Payment
              </span>
              <div className="flex gap-1">
                <Chip active={pay === "ALL"} label="All" onClick={() => setPay("ALL")} />
                <Chip
                  active={pay === "UNPAID"}
                  label="Unpaid"
                  onClick={() => setPay("UNPAID")}
                  activeColor="#f87171"
                  activeBg="rgba(248,113,113,0.12)"
                  activeBorder="rgba(248,113,113,0.35)"
                />
                <Chip
                  active={pay === "PAID"}
                  label="Paid"
                  onClick={() => setPay("PAID")}
                  activeColor="#34d399"
                  activeBg="rgba(16,185,129,0.15)"
                  activeBorder="rgba(52,211,153,0.35)"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 pb-0.5">
              <span className="label mb-0" style={{ fontSize: "0.58rem" }}>
                TDS
              </span>
              <div className="flex gap-1">
                <Chip active={tds === "ALL"} label="All" onClick={() => setTds("ALL")} />
                <Chip active={tds === "YES"} label="With" onClick={() => setTds("YES")} />
                <Chip active={tds === "NO"} label="None" onClick={() => setTds("NO")} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className="rounded-xl overflow-auto"
        style={{ border: "1px solid var(--border)", maxHeight: "min(58vh, 560px)" }}
      >
        <table className="data" style={{ fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {["Employee", "Period", "Dept", "Status", "Gross", "TDS", "Net", "Actions"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: "rgba(14, 16, 24, 0.95)",
                      backdropFilter: "blur(8px)",
                      padding: "0.5rem 0.75rem",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const period = `${monthName(s.month)} ${s.year}`;
              const status = statusOverrides[s.id] ?? s.paymentStatus;
              const isPaid = status === "PAID";
              const downloadName = `Salary_${s.employeeCode || s.employeeName.replace(/\s+/g, "_")}_${s.year}_${String(s.month).padStart(2, "0")}.pdf`;
              return (
                <tr
                  key={s.id}
                  style={isPaid ? { background: "rgba(16,185,129,0.03)" } : undefined}
                >
                  <td style={{ padding: "0.45rem 0.75rem" }}>
                    <p className="font-medium leading-tight" style={{ fontSize: "0.82rem" }}>
                      {s.employeeName}
                    </p>
                    <p
                      className="truncate max-w-[180px] leading-tight"
                      style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem" }}
                    >
                      {[s.employeeCode, s.designation].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </td>
                  <td style={{ padding: "0.45rem 0.75rem", color: "rgba(255,255,255,0.72)" }}>
                    {period}
                  </td>
                  <td style={{ padding: "0.45rem 0.75rem", color: "rgba(255,255,255,0.55)" }}>
                    {s.department || "—"}
                  </td>
                  <td style={{ padding: "0.35rem 0.75rem" }}>
                    <SalarySlipStatusCell
                      slipId={s.id}
                      initialStatus={status}
                      onStatusChange={(next) =>
                        setStatusOverrides((prev) => ({ ...prev, [s.id]: next }))
                      }
                    />
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ padding: "0.45rem 0.75rem", color: "rgba(255,255,255,0.72)" }}
                  >
                    {formatINR(s.gross)}
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ padding: "0.45rem 0.75rem", color: "rgba(255,255,255,0.72)" }}
                  >
                    {s.tds > 0 ? formatINR(s.tds) : "—"}
                  </td>
                  <td style={{ padding: "0.45rem 0.75rem" }}>
                    <span className="tabular-nums font-semibold" style={{ color: "#34d399" }}>
                      {formatINR(s.netPay)}
                    </span>
                  </td>
                  <td style={{ padding: "0.35rem 0.75rem" }}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {s.filePath && (
                        <>
                          <Link
                            className="px-1.5 py-0.5 rounded text-[0.65rem] font-medium hover:opacity-80"
                            style={{
                              background: "rgba(99,102,241,0.08)",
                              border: "1px solid rgba(99,102,241,0.2)",
                              color: "#818cf8",
                            }}
                            href={`/api/files/${s.filePath}`}
                            target="_blank"
                          >
                            View
                          </Link>
                          <Link
                            className="px-1.5 py-0.5 rounded text-[0.65rem] font-medium hover:opacity-80"
                            style={{
                              background: "rgba(240,180,41,0.08)",
                              border: "1px solid rgba(240,180,41,0.2)",
                              color: "#fbbf24",
                            }}
                            href={`/api/files/${s.filePath}`}
                            download={downloadName}
                          >
                            PDF
                          </Link>
                        </>
                      )}
                      {isPaid ? (
                        <span
                          className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: "rgba(16,185,129,0.08)",
                            border: "1px solid rgba(52,211,153,0.2)",
                            color: "#6ee7b7",
                          }}
                        >
                          Locked
                        </span>
                      ) : (
                        <>
                          <SalarySlipRegenerateButton
                            slipId={s.id}
                            employeeName={s.employeeName}
                            periodLabel={period}
                          />
                          <SalarySlipDeleteButton
                            slipId={s.id}
                            employeeName={s.employeeName}
                            periodLabel={period}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-10">
                  <p style={{ color: "rgba(255,255,255,0.4)" }}>
                    {slips.length === 0
                      ? "No salary slips yet — generate slips above."
                      : "No salary slips match these filters."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
