"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { upsertEmployee, generateSalarySlip, generateSlipsForMonth } from "@/actions/payroll";

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
  tds: number;
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
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "", employeeCode: "", designation: "", department: "", pan: "", uan: "",
    basic: 50000, hra: 20000, special: 10000, otherAllow: 0, pf: 1800, professionalTax: 200, tds: 0, otherDeduct: 0,
  });

  function submitEmployee(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      try {
        await upsertEmployee(form);
        setMsg(`Saved ${form.name}`);
        setForm((f) => ({ ...f, name: "", employeeCode: "" }));
        setShowAdd(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function genOne(employeeId: string) {
    setError(""); setMsg("");
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
    setError(""); setMsg("");
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
      {/* Month/year selector + bulk generate */}
      <div className="panel p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Month</label>
          <input className="input w-24" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Year</label>
          <input className="input w-28" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={genAll}>
          {pending ? <><span className="loading-spin" /> Generating…</> : "Generate all active slips"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Add employee"}
        </button>
      </div>

      {msg && (
        <motion.p className="text-sm px-4 py-2 panel" style={{ color: "var(--navy-bright)" }}
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          {msg}
        </motion.p>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
      )}

      {/* Add employee form */}
      {showAdd && (
        <motion.section
          className="panel p-6"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <h2 className="text-base font-semibold mb-4">Add employee</h2>
          <form onSubmit={submitEmployee} className="grid sm:grid-cols-3 gap-4">
            {([
              ["name", "Name", "text"], ["employeeCode", "Code", "text"],
              ["designation", "Designation", "text"], ["department", "Department", "text"],
              ["pan", "PAN", "text"], ["uan", "UAN", "text"],
              ["basic", "Basic (₹)", "number"], ["hra", "HRA (₹)", "number"],
              ["special", "Special (₹)", "number"], ["otherAllow", "Other allow. (₹)", "number"],
              ["pf", "PF (₹)", "number"], ["professionalTax", "Prof. tax (₹)", "number"],
              ["tds", "TDS (₹)", "number"], ["otherDeduct", "Other deduct. (₹)", "number"],
            ] as const).map(([key, label, type]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <input
                  className="input"
                  type={type}
                  required={key === "name" || key === "basic"}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
                />
              </div>
            ))}
            <div className="sm:col-span-3">
              <button type="submit" className="btn btn-primary" disabled={pending}>Save employee</button>
            </div>
          </form>
        </motion.section>
      )}

      {/* Employees table */}
      <div className="panel overflow-hidden">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Designation</th>
              <th>Basic</th>
              <th>Net (est.)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const gross = e.basic + e.hra + e.special + e.otherAllow;
              const net = gross - e.pf - e.professionalTax - e.tds - e.otherDeduct;
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td className="text-muted">{e.employeeCode || "—"}</td>
                  <td className="text-muted">{e.designation || "—"}</td>
                  <td className="tabular-nums">₹ {e.basic.toLocaleString("en-IN")}</td>
                  <td className="tabular-nums">₹ {net.toLocaleString("en-IN")}</td>
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
              <tr><td colSpan={6} className="text-muted">No employees yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
