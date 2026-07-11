import { listEmployees, listSalarySlips } from "@/actions/payroll";
import { PayrollPanel } from "@/components/payroll-panel";
import { SalarySlipDatabase } from "@/components/salary-slip-database";
import { formatINR } from "@/lib/utils";

export default async function PayrollPage() {
  const [employees, slips] = await Promise.all([listEmployees(), listSalarySlips()]);

  const totalNet = slips.reduce((s, sl) => s + sl.netPay, 0);
  const totalGross = slips.reduce((s, sl) => s + sl.gross, 0);
  const activeCount = employees.filter((e) => e.active).length;

  const dbRows = slips.map((s) => ({
    id: s.id,
    employeeId: s.employeeId,
    employeeName: s.employee.name,
    employeeCode: s.employee.employeeCode,
    designation: s.employee.designation,
    department: s.employee.department,
    emailOfficial: s.employee.emailOfficial,
    phone: s.employee.phone,
    month: s.month,
    year: s.year,
    gross: s.gross,
    tds: s.tds,
    totalDeduct: s.totalDeduct,
    netPay: s.netPay,
    paymentStatus: s.paymentStatus ?? "UNPAID",
    filePath: s.filePath,
  }));

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · Payroll
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Payroll</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Indian statutory salary slips — Basic / HRA / Special Allowance / PF / PT / TDS.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          {
            label: "Active staff",
            value: String(activeCount),
            color: "#34d399",
            bg: "rgba(16,185,129,0.1)",
          },
          {
            label: "Total gross",
            value: totalGross > 0 ? formatINR(totalGross) : "—",
            color: "#818cf8",
            bg: "rgba(99,102,241,0.08)",
          },
          {
            label: "Total net paid",
            value: totalNet > 0 ? formatINR(totalNet) : "—",
            color: "#fbbf24",
            bg: "rgba(240,180,41,0.08)",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)`,
              }}
            />
            <p
              className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}
            >
              {s.label}
            </p>
            <p
              className="relative text-xl font-bold tabular-nums leading-tight"
              style={{ color: s.color }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <section
        className="relative overflow-hidden rounded-xl mb-8"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(16,185,129,0.06) 0%, transparent 55%)",
          }}
        />
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 7a4 4 0 110 8 4 4 0 010-8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Generate salary slips</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                Run monthly payroll for active employees — manage staff on Employees
              </p>
            </div>
          </div>
          <PayrollPanel employees={employees} />
        </div>
      </section>

      <SalarySlipDatabase slips={dbRows} />
    </div>
  );
}
