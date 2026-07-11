"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ExpenseUploader } from "@/components/expense-uploader";
import { getCategoryById, EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { deleteExpense } from "@/actions/expenses";

type ExpenseRow = {
  id: string;
  date: string;
  vendor: string;
  amount: number;
  category: string;
  description?: string;
  paymentMode?: string;
  invoiceNo?: string;
  filePath?: string;
  needsReview: boolean;
  gstAmount?: number;
};

export function ExpensesClient({
  expenses,
  activeFilter,
}: {
  expenses: ExpenseRow[];
  activeFilter?: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    setDeleting(id);
    await deleteExpense(id);
    router.refresh();
    setDeleting(null);
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Upload / add section */}
      <section className="relative overflow-hidden rounded-xl"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 50% at 0% 0%, rgba(99,102,241,0.07) 0%, transparent 55%)" }} />
        <div className="relative">
          {/* Toggle header */}
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="w-full flex items-center gap-3 p-5 transition-colors"
            style={{ cursor: "pointer", background: "transparent", border: "none", textAlign: "left" }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Add New Expense</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                Upload a bill / invoice — AI auto-extracts & categorises
              </p>
            </div>
            <motion.span animate={{ rotate: showForm ? 180 : 0 }} transition={{ duration: 0.2 }}
              style={{ color: "var(--text-dim)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 9l-7 7-7-7"/>
              </svg>
            </motion.span>
          </button>

          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: "hidden" }}
              >
                <div className="px-5 pb-5 pt-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="pt-4">
                    <ExpenseUploader onSaved={() => { setShowForm(false); router.refresh(); }} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Table */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">
              {activeFilter ? `${getCategoryById(activeFilter).label} expenses` : "All Expenses"}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-md tabular-nums"
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
              {expenses.length}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Category filter pills */}
            {activeFilter && (
              <a href="/ceo/expenses"
                className="text-xs px-2.5 py-1 rounded-md transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-muted)" }}>
                ✕ Clear filter
              </a>
            )}
            <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              Total: <span style={{ color: "#f87171" }}>₹{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
            </span>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="data">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Date</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>Description</th>
                <th>Mode</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const cat = getCategoryById(e.category);
                return (
                  <tr key={e.id} style={{ opacity: deleting === e.id ? 0.4 : 1 }}>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      {new Date(e.date).toLocaleDateString("en-IN")}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{e.vendor}</p>
                        {e.needsReview && (
                          <span title="Needs review" className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)", fontSize: "0.6rem" }}>
                            ⚠
                          </span>
                        )}
                      </div>
                      {e.invoiceNo && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>#{e.invoiceNo}</p>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
                        style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.color}22` }}>
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </span>
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.82rem", maxWidth: 200 }}>
                      <p className="truncate">{e.description || "—"}</p>
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>
                      {e.paymentMode ? (
                        <span className="px-1.5 py-0.5 rounded text-xs"
                          style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.07)" }}>
                          {e.paymentMode}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      <div>
                        <p className="tabular-nums font-semibold text-sm" style={{ color: "#f87171" }}>
                          ₹{e.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </p>
                        {e.gstAmount ? (
                          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                            GST ₹{e.gstAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {e.filePath && (
                          <a href={`/${e.filePath}`} target="_blank"
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--text-dim)" }}
                            title="View bill">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 110 6 3 3 0 010-6z"/></svg>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(e.id)}
                          disabled={deleting === e.id}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                          style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer" }}
                          title="Delete">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4h8v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-14">
                    <p className="text-2xl mb-2">🧾</p>
                    <p style={{ color: "var(--text-dim)" }}>No expenses yet — upload your first bill above.</p>
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
