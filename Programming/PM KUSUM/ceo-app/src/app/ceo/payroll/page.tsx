import Link from "next/link";
import { listEmployees, listSalarySlips } from "@/actions/payroll";
import { PayrollPanel } from "@/components/payroll-panel";
import { formatINR, monthName } from "@/lib/utils";

export default async function PayrollPage() {
  const [employees, slips] = await Promise.all([listEmployees(), listSalarySlips()]);

  const totalNet   = slips.reduce((s, sl) => s + sl.netPay, 0);
  const totalGross = slips.reduce((s, sl) => s + sl.gross, 0);
  const activeCount = employees.filter((e) => e.active).length;

  return (
    <div>
      {/* Header */}
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · Payroll
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Payroll</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Indian statutory salary slips — Basic / HRA / Special Allowance / PF / PT / TDS.
        </p>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Active staff",   value: String(activeCount),     color: "#34d399", bg: "rgba(16,185,129,0.1)" },
          { label: "Total gross",    value: totalGross > 0 ? formatINR(totalGross) : "—", color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
          { label: "Total net paid", value: totalNet   > 0 ? formatINR(totalNet)   : "—", color: "#fbbf24", bg: "rgba(240,180,41,0.08)" },
        ].map((s) => (
          <div key={s.label} className="relative overflow-hidden rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)` }} />
            <p className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}>{s.label}</p>
            <p className="relative text-xl font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Payroll panel (employee CRUD + slip generator) */}
      <section className="relative overflow-hidden rounded-xl mb-8"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(16,185,129,0.06) 0%, transparent 55%)" }} />
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 7a4 4 0 110 8 4 4 0 010-8z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Employees & Salary Slips</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                Add employees and generate monthly statutory salary slips
              </p>
            </div>
          </div>
          <PayrollPanel employees={employees} />
        </div>
      </section>

      {/* Generated slips */}
      {slips.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold">Generated Slips</h2>
            <span className="text-xs px-2 py-0.5 rounded-md tabular-nums"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399" }}>
              {slips.length}
            </span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <table className="data">
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                  <th>Employee</th>
                  <th>Period</th>
                  <th>Gross</th>
                  <th>Net Pay</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <p className="font-medium text-sm">{s.employee.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                        {s.employee.designation || s.employee.department || ""}
                      </p>
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      {monthName(s.month)} {s.year}
                    </td>
                    <td className="tabular-nums text-sm">{formatINR(s.gross)}</td>
                    <td>
                      <span className="tabular-nums font-semibold" style={{ color: "#34d399" }}>
                        {formatINR(s.netPay)}
                      </span>
                    </td>
                    <td>
                      {s.filePath && (
                        <Link
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399" }}
                          href={`/api/files/${s.filePath}`}
                          target="_blank"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                          PDF
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
