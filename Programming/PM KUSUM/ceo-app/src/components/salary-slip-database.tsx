"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  SalarySlipDeleteButton,
  SalarySlipRegenerateButton,
} from "@/components/salary-slip-row-actions";
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
  filePath: string | null;
};

type TdsFilter = "ALL" | "YES" | "NO";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function SalarySlipDatabase({ slips }: { slips: SalarySlipDbRow[] }) {
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [tds, setTds] = useState<TdsFilter>("ALL");

  const employeeOptions = useMemo(() => {
    const names = [...new Set(slips.map((s) => s.employeeName))].sort((a, b) =>
      a.localeCompare(b),
    );
    return names;
  }, [slips]);

  const departmentOptions = useMemo(() => {
    const deps = [
      ...new Set(slips.map((s) => s.department).filter(Boolean) as string[]),
    ].sort((a, b) => a.localeCompare(b));
    return deps;
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
      if (eq && !s.employeeName.toLowerCase().includes(eq) && !(s.employeeCode || "").toLowerCase().includes(eq)) {
        return false;
      }
      if (dq && !(s.department || "").toLowerCase().includes(dq)) return false;
      if (yearN != null && !Number.isNaN(yearN) && s.year !== yearN) return false;
      if (monthN != null && !Number.isNaN(monthN) && s.month !== monthN) return false;
      if (min != null && !Number.isNaN(min) && s.netPay < min) return false;
      if (max != null && !Number.isNaN(max) && s.netPay > max) return false;
      if (tds === "YES" && s.tds <= 0) return false;
      if (tds === "NO" && s.tds > 0) return false;
      return true;
    });
  }, [slips, employee, department, year, month, amountMin, amountMax, tds]);

  const hasFilters =
    employee ||
    department ||
    year ||
    month ||
    amountMin ||
    amountMax ||
    tds !== "ALL";

  function clearFilters() {
    setEmployee("");
    setDepartment("");
    setYear("");
    setMonth("");
    setAmountMin("");
    setAmountMax("");
    setTds("ALL");
  }

  const filteredNet = filtered.reduce((sum, s) => sum + s.netPay, 0);

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Salary slips database</h2>
          <span
            className="text-xs px-2 py-0.5 rounded-md tabular-nums"
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
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
          View / PDF · Modify regenerates from employee salary · Del removes slip
        </p>
      </div>

      <div
        className="rounded-xl p-4 mb-4 space-y-3"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p
            className="text-[0.6rem] uppercase tracking-[0.16em] font-semibold"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            Filters
          </p>
          <div className="flex items-center gap-3">
            {hasFilters && (
              <p className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
                Showing {formatINR(filteredNet)} net across {filtered.length} slip
                {filtered.length === 1 ? "" : "s"}
              </p>
            )}
            {hasFilters && (
              <button type="button" className="btn btn-ghost text-xs py-1 px-2" onClick={clearFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2">
            <label className="label">Employee</label>
            <input
              className="input"
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

          <div>
            <label className="label">Department</label>
            <input
              className="input"
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

          <div>
            <label className="label">Year</label>
            <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Month</label>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Net min (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="0"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Net max (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="Any"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <div>
            <p className="label mb-1.5">TDS</p>
            <div className="flex gap-1.5">
              {(
                [
                  { id: "ALL", label: "All" },
                  { id: "YES", label: "With TDS" },
                  { id: "NO", label: "No TDS" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setTds(v.id)}
                  className="text-[0.65rem] font-bold px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background:
                      tds === v.id ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.02)",
                    color: tds === v.id ? "#a78bfa" : "rgba(255,255,255,0.4)",
                    border: `1px solid ${
                      tds === v.id ? "rgba(139,92,246,0.35)" : "rgba(255,255,255,0.08)"
                    }`,
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <table className="data">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Employee</th>
              <th>Period</th>
              <th>Department</th>
              <th>Gross</th>
              <th>TDS</th>
              <th>Deductions</th>
              <th>Net Pay</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const period = `${monthName(s.month)} ${s.year}`;
              const downloadName = `Salary_${s.employeeCode || s.employeeName.replace(/\s+/g, "_")}_${s.year}_${String(s.month).padStart(2, "0")}.pdf`;
              return (
                <tr key={s.id}>
                  <td>
                    <p className="font-medium text-sm">{s.employeeName}</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {[s.employeeCode, s.designation].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {(s.emailOfficial || s.phone) && (
                      <p
                        className="text-xs mt-0.5 truncate max-w-[220px]"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                      >
                        {[s.emailOfficial, s.phone].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.82rem" }}>
                    {period}
                  </td>
                  <td style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.82rem" }}>
                    {s.department || "—"}
                  </td>
                  <td className="tabular-nums text-sm" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {formatINR(s.gross)}
                  </td>
                  <td className="tabular-nums text-sm" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {s.tds > 0 ? formatINR(s.tds) : "—"}
                  </td>
                  <td className="tabular-nums text-sm" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {formatINR(s.totalDeduct)}
                  </td>
                  <td>
                    <span className="tabular-nums font-semibold" style={{ color: "#34d399" }}>
                      {formatINR(s.netPay)}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 flex-wrap">
                      {s.filePath && (
                        <>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(99,102,241,0.08)",
                              border: "1px solid rgba(99,102,241,0.2)",
                              color: "#818cf8",
                            }}
                            href={`/api/files/${s.filePath}`}
                            target="_blank"
                            title="View PDF"
                          >
                            View
                          </Link>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(240,180,41,0.08)",
                              border: "1px solid rgba(240,180,41,0.2)",
                              color: "#fbbf24",
                            }}
                            href={`/api/files/${s.filePath}`}
                            download={downloadName}
                            title="Download PDF"
                          >
                            PDF
                          </Link>
                        </>
                      )}
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
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12">
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
