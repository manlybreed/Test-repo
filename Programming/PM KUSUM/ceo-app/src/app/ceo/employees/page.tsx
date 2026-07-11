import Link from "next/link";
import { listEmployees } from "@/actions/payroll";
import { EmployeesClient } from "./client";

export default async function EmployeesPage() {
  const employees = await listEmployees();
  const active = employees.filter((e) => e.active);

  const rows = employees.map((e) => ({
    id: e.id,
    name: e.name,
    employeeCode: e.employeeCode,
    designation: e.designation,
    department: e.department,
    email: e.email,
    emailOfficial: e.emailOfficial,
    phone: e.phone,
    pan: e.pan,
    aadhaar: e.aadhaar,
    uan: e.uan,
    addressLine1: e.addressLine1,
    city: e.city,
    state: e.state,
    pincode: e.pincode,
    bankAccount: e.bankAccount,
    bankIfsc: e.bankIfsc,
    bankName: e.bankName,
    bankBranch: e.bankBranch,
    basic: e.basic,
    hra: e.hra,
    special: e.special,
    otherAllow: e.otherAllow,
    pf: e.pf,
    professionalTax: e.professionalTax,
    tdsPercent: e.tdsPercent,
    otherDeduct: e.otherDeduct,
    joinDate: e.joinDate ? e.joinDate.toISOString().slice(0, 10) : null,
    notes: e.notes,
    photoPath: e.photoPath,
    panDocPath: e.panDocPath,
    aadhaarDocPath: e.aadhaarDocPath,
    agreementPath: e.agreementPath,
    bankDocPath: e.bankDocPath,
    salarySlipPath: e.salarySlipPath,
    active: e.active,
  }));

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · People
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Employees</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Onboard staff with KYC docs, salary breakup (TDS as %), personal & official email.
          Generate slips from{" "}
          <Link href="/ceo/payroll" className="underline" style={{ color: "#a5b4fc" }}>
            Payroll
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 mb-8 max-w-md">
        {[
          { label: "Total staff", value: String(employees.length), color: "#818cf8" },
          { label: "Active", value: String(active.length), color: "#34d399" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <p
              className="text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-1"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              {s.label}
            </p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <EmployeesClient employees={rows} />
    </div>
  );
}
