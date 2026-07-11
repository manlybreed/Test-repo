"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { generateSalarySlip, generateSlipsForMonth } from "@/actions/payroll";
import { employeeSalaryTotals } from "@/lib/employee-salary";

type Emp = {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  basic: number;
  hra: number;
  special: number;
  otherAllow: number;
  pf: number;
  professionalTax: number;
  tdsPercent: number;
  otherDeduct: number;
  active: boolean;
};

export function PayrollPanel({ employees }: { employees: Emp[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  function genOne(employeeId: string) {
    setError("");
    setMsg("");
    start(async () => {
      try {
        const res = await generateSalarySlip({ employeeId, month, year });
        setMsg(`Slip ready: ${res.employeeName}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function genAll() {
    setError("");
    setMsg("");
    start(async () => {
      try {
        const res = await generateSlipsForMonth(month, year);
        setMsg(`Generated ${res.length} salary slip${res.length !== 1 ? "s" : ""}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="space-y-8">
      <div className="panel p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Month</label>
          <input
            className="input w-24"
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Year</label>
          <input
            className="input w-28"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={genAll}>
          {pending ? (
            <>
              <span className="loading-spin" /> Generating…
            </>
          ) : (
            "Generate all active slips"
          )}
        </button>
        <Link href="/ceo/employees" className="btn btn-ghost">
          + Add / edit employees
        </Link>
      </div>

      {msg && (
        <motion.p
          className="text-sm px-4 py-2 panel"
          style={{ color: "var(--navy-bright)" }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {msg}
        </motion.p>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="panel overflow-hidden">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Designation</th>
              <th>Basic</th>
              <th>TDS %</th>
              <th>Net (est.)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const { netPay } = employeeSalaryTotals(e);
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td className="text-muted">{e.employeeCode || "—"}</td>
                  <td className="text-muted">{e.designation || "—"}</td>
                  <td className="tabular-nums">₹ {e.basic.toLocaleString("en-IN")}</td>
                  <td className="tabular-nums">{e.tdsPercent}%</td>
                  <td className="tabular-nums">₹ {netPay.toLocaleString("en-IN")}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      disabled={pending}
                      onClick={() => genOne(e.id)}
                    >
                      Generate slip
                    </button>
                  </td>
                </tr>
              );
            })}
            {employees.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-8">
                  No employees — add them under Employees.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
