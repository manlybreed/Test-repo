"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEmployee } from "@/actions/payroll";
import { EmployeeForm, type EmployeeEditSeed } from "@/components/employee-form";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";
import { employeeSalaryTotals } from "@/lib/employee-salary";
import { formatINR } from "@/lib/utils";

export type EmployeeListItem = EmployeeEditSeed & {
  active: boolean;
};

export function EmployeesClient({ employees }: { employees: EmployeeListItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<EmployeeEditSeed | null>(null);
  const [deleting, setDeleting] = useState<EmployeeListItem | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function confirmDelete() {
    if (!deleting) return;
    setError("");
    start(async () => {
      try {
        await deleteEmployee(deleting.id);
        if (editing?.id === deleting.id) setEditing(null);
        setDeleting(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
        setDeleting(null);
      }
    });
  }

  return (
    <div className="grid lg:grid-cols-5 gap-6 mb-10">
      <section
        className="lg:col-span-3 rounded-xl p-5"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-base font-semibold mb-1">
          {editing ? "Modify employee" : "Add employee"}
        </h2>
        <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
          {editing
            ? "Update details, then confirm to save."
            : "Documents: PAN · Aadhaar · Photograph · Salary slip · Agreement · Passbook / bank statement"}
        </p>
        <EmployeeForm
          key={editing?.id ?? "new"}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      </section>

      <aside
        className="lg:col-span-2 rounded-xl p-5 h-fit"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold">Directory</h2>
          <span
            className="text-xs px-2 py-0.5 rounded-md tabular-nums"
            style={{
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.25)",
              color: "#a5b4fc",
            }}
          >
            {employees.length}
          </span>
        </div>

        {error && (
          <p className="text-xs mb-3" style={{ color: "#f87171" }}>
            {error}
          </p>
        )}

        {employees.length === 0 ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
            No employees yet. Add one from documents or manually.
          </p>
        ) : (
          <ul className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {employees.map((e) => {
              const { netPay } = employeeSalaryTotals(e);
              return (
                <li
                  key={e.id}
                  className="rounded-lg p-3"
                  style={{
                    background:
                      editing?.id === e.id ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.025)",
                    border: `1px solid ${editing?.id === e.id ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.06)"}`,
                    opacity: e.active ? 1 : 0.55,
                  }}
                >
                  <div className="flex items-start gap-3">
                    {e.photoPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/${e.photoPath}`}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                        style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
                        style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}
                      >
                        {e.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold leading-snug">{e.name}</p>
                        {e.employeeCode && (
                          <span
                            className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)" }}
                          >
                            {e.employeeCode}
                          </span>
                        )}
                      </div>
                      {(e.designation || e.department) && (
                        <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                          {[e.designation, e.department].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <p className="text-xs mt-1 tabular-nums" style={{ color: "#34d399" }}>
                        Net {formatINR(netPay)}
                        {e.tdsPercent > 0 ? ` · TDS ${e.tdsPercent}%` : ""}
                      </p>
                      <p className="text-[0.65rem] mt-1 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {[e.phone, e.email, e.emailOfficial].filter(Boolean).join(" · ")}
                      </p>
                      <div className="flex gap-2 mt-2.5">
                        <button
                          type="button"
                          className="text-[0.65rem] font-semibold px-2 py-1 rounded-md"
                          style={{
                            background: "rgba(99,102,241,0.12)",
                            color: "#a5b4fc",
                            border: "1px solid rgba(99,102,241,0.25)",
                          }}
                          onClick={() => {
                            setEditing(e);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Modify
                        </button>
                        <button
                          type="button"
                          className="text-[0.65rem] font-semibold px-2 py-1 rounded-md"
                          style={{
                            background: "rgba(239,68,68,0.1)",
                            color: "#f87171",
                            border: "1px solid rgba(239,68,68,0.25)",
                          }}
                          onClick={() => setDeleting(e)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Delete employee?"
        itemLabel={
          deleting
            ? `${deleting.name}${deleting.employeeCode ? ` (${deleting.employeeCode})` : ""}`
            : undefined
        }
        description="All salary slips for this employee will also be removed."
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        pending={pending}
      />
    </div>
  );
}
