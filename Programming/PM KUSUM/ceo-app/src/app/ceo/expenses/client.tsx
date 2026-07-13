"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { ExpenseUploader } from "@/components/expense-uploader";
import { getCategoryById, EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { deleteExpense, updateExpense } from "@/actions/expenses";
import { ConfirmDeleteDialog, ConfirmModifyDialog } from "@/components/confirm-dialogs";
import { GstEntityBadge } from "@/components/gst-entity-select";
import type { GstEntity } from "@/lib/gst-entities";

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
  gstEntity?: string | null;
  billedTo?: string;
  billedToCanonical?: string | null;
  ourGstMentioned?: boolean | null;
  billedGstin?: string;
  notes?: string;
};

type EditForm = {
  date: string;
  vendor: string;
  amount: string;
  category: string;
  description: string;
  paymentMode: string;
  invoiceNo: string;
  gstAmount: string;
  gstEntity: GstEntity | "";
  billedTo: string;
  ourGstMentioned: boolean;
  billedGstin: string;
  notes: string;
};

function toEditForm(e: ExpenseRow): EditForm {
  return {
    date: e.date,
    vendor: e.vendor,
    amount: String(e.amount),
    category: e.category,
    description: e.description || "",
    paymentMode: e.paymentMode || "",
    invoiceNo: e.invoiceNo || "",
    gstAmount: e.gstAmount != null ? String(e.gstAmount) : "",
    gstEntity: e.gstEntity === "RAJ" || e.gstEntity === "DEL" ? e.gstEntity : "DEL",
    billedTo: e.billedTo || "",
    ourGstMentioned: Boolean(e.ourGstMentioned),
    billedGstin: e.billedGstin || "",
    notes: e.notes || "",
  };
}

export function ExpensesClient({
  expenses,
  activeFilter,
}: {
  expenses: ExpenseRow[];
  activeFilter?: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);
  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [confirmModify, setConfirmModify] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function openEdit(e: ExpenseRow) {
    setError("");
    setEditTarget(e);
    setEditForm(toEditForm(e));
    setConfirmModify(false);
  }

  function requestSaveEdit() {
    if (!editForm) return;
    if (!editForm.vendor.trim() || !editForm.amount || !editForm.date || !editForm.category) {
      setError("Vendor, amount, date and category are required.");
      return;
    }
    setConfirmModify(true);
  }

  function confirmSaveEdit() {
    if (!editTarget || !editForm) return;
    setError("");
    start(async () => {
      try {
        await updateExpense(editTarget.id, {
          date: editForm.date,
          vendor: editForm.vendor.trim(),
          amount: Number(editForm.amount),
          category: editForm.category,
          description: editForm.description || undefined,
          paymentMode: editForm.paymentMode || undefined,
          invoiceNo: editForm.invoiceNo || undefined,
          gstAmount: editForm.gstAmount ? Number(editForm.gstAmount) : undefined,
          gstEntity: editForm.ourGstMentioned
            ? editForm.gstEntity || undefined
            : null,
          billedTo: editForm.billedTo || undefined,
          ourGstMentioned: editForm.ourGstMentioned,
          billedGstin: editForm.ourGstMentioned
            ? editForm.billedGstin || undefined
            : null,
          notes: editForm.notes || undefined,
          needsReview: false,
        });
        setConfirmModify(false);
        setEditTarget(null);
        setEditForm(null);
        router.refresh();
      } catch (e) {
        setConfirmModify(false);
        setError(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    start(async () => {
      try {
        await deleteExpense(deleteTarget.id);
        setDeleteTarget(null);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed");
      }
    });
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
                Upload a bill / invoice — AI auto-extracts & categorises. Tag DEL or RAJ GST.
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
                    <ExpenseUploader
                      onSaved={(meta) => {
                        router.refresh();
                        if (!meta?.hasMore) setShowForm(false);
                      }}
                    />
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
                <th>Billed to</th>
                <th>Category</th>
                <th>GST</th>
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
                  <tr key={e.id}>
                    <td style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.82rem" }}>
                      {new Date(e.date).toLocaleDateString("en-IN")}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{e.vendor}</p>
                        {e.needsReview && (
                          <span
                            className="relative group inline-flex items-center gap-1 text-[0.65rem] px-1.5 py-0.5 rounded-md font-semibold cursor-help"
                            style={{
                              background: "rgba(251,191,36,0.12)",
                              color: "#fbbf24",
                              border: "1px solid rgba(251,191,36,0.3)",
                            }}
                            aria-label="Needs review — AI was unsure about some fields"
                          >
                            !
                            <span
                              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+6px)] z-20 hidden group-hover:block w-48 px-2.5 py-1.5 rounded-md text-[0.65rem] font-normal leading-snug text-left"
                              style={{
                                background: "#1a1a22",
                                border: "1px solid rgba(251,191,36,0.35)",
                                color: "rgba(255,255,255,0.85)",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                              }}
                            >
                              Needs review — AI was unsure about amount, vendor, or category. Open edit to verify, then save to clear this flag.
                            </span>
                          </span>
                        )}
                      </div>
                      {e.invoiceNo && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>#{e.invoiceNo}</p>
                      )}
                      {e.ourGstMentioned && (
                        <p className="text-[0.65rem] mt-0.5" style={{ color: "#34d399" }}>
                          Our GST{e.billedGstin ? `: ${e.billedGstin}` : ""}
                        </p>
                      )}
                      {e.ourGstMentioned === false && (
                        <p className="text-[0.65rem] mt-0.5" style={{ color: "var(--text-dim)" }}>
                          Our GST not on bill
                        </p>
                      )}
                    </td>
                    <td style={{ maxWidth: 180 }}>
                      {e.billedToCanonical || e.billedTo ? (
                        <div>
                          <p className="text-sm font-medium truncate" title={e.billedToCanonical || e.billedTo}>
                            {e.billedToCanonical || e.billedTo}
                          </p>
                          {e.billedToCanonical &&
                            e.billedTo &&
                            e.billedToCanonical !== e.billedTo && (
                              <p
                                className="text-[0.65rem] mt-0.5 truncate"
                                style={{ color: "var(--text-dim)" }}
                                title={e.billedTo}
                              >
                                as “{e.billedTo}”
                              </p>
                            )}
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
                        style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.color}22` }}>
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </span>
                    </td>
                    <td>
                      {e.ourGstMentioned ? (
                        <GstEntityBadge value={e.gstEntity} />
                      ) : (
                        <span
                          className="text-xs"
                          style={{ color: "var(--text-dim)" }}
                          title="BluRidge GSTIN was not printed on the bill"
                        >
                          Not on bill
                        </span>
                      )}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.82rem", maxWidth: 180 }}>
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
                          onClick={() => openEdit(e)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                          style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8", cursor: "pointer" }}
                          title="Edit expense"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(e)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                          style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer" }}
                          title="Delete expense"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4h8v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-14">
                    <p className="text-2xl mb-2">🧾</p>
                    <p style={{ color: "var(--text-dim)" }}>No expenses yet — upload your first bill above.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit modal */}
      {editTarget && editForm && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9990] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending && !confirmModify) {
              setEditTarget(null);
              setEditForm(null);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: "var(--bg-card, #1a1f2e)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold">Modify expense</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                  Changes require a separate confirmation before saving.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditTarget(null); setEditForm(null); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ color: "var(--text-dim)", cursor: "pointer", background: "transparent", border: "none" }}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Vendor *</label>
                <input className="input" value={editForm.vendor}
                  onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })} />
              </div>
              <div>
                <label className="label">Amount (₹) *</label>
                <input className="input" type="number" step="0.01" value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="label">Date *</label>
                <input className="input" type="date" value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div>
                <label className="label">Invoice No.</label>
                <input className="input" value={editForm.invoiceNo}
                  onChange={(e) => setEditForm({ ...editForm, invoiceNo: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Billed to</label>
                <input className="input" value={editForm.billedTo}
                  onChange={(e) => setEditForm({ ...editForm, billedTo: e.target.value })} />
              </div>
              <div>
                <label className="label">Our GST on bill?</label>
                <select
                  className="input"
                  value={editForm.ourGstMentioned ? "yes" : "no"}
                  onChange={(e) => {
                    const yes = e.target.value === "yes";
                    setEditForm({
                      ...editForm,
                      ourGstMentioned: yes,
                      ...(yes ? {} : { billedGstin: "", gstEntity: "" }),
                    });
                  }}
                >
                  <option value="no">No — company name only / not mentioned</option>
                  <option value="yes">Yes — BluRidge GSTIN printed</option>
                </select>
              </div>
              <div>
                <label className="label">BluRidge GSTIN</label>
                <input
                  className="input"
                  value={editForm.billedGstin}
                  onChange={(e) => setEditForm({ ...editForm, billedGstin: e.target.value })}
                  disabled={!editForm.ourGstMentioned}
                  placeholder={editForm.ourGstMentioned ? "07… / 08…" : "Not on bill"}
                />
              </div>
              <div>
                <label className="label">GST Amount (₹)</label>
                <input className="input" type="number" step="0.01" value={editForm.gstAmount}
                  onChange={(e) => setEditForm({ ...editForm, gstAmount: e.target.value })} />
              </div>
              <div>
                <label className="label">Payment Mode</label>
                <select className="input" value={editForm.paymentMode}
                  onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value })}>
                  <option value="">— select —</option>
                  {["UPI", "Cash", "Card", "Net Banking", "NEFT", "IMPS", "Cheque"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">BluRidge GST on bill</label>
                <div className="mt-1">
                  {editForm.ourGstMentioned ? (
                    <GstEntityBadge value={editForm.gstEntity || null} />
                  ) : (
                    <p
                      className="text-sm px-3 py-2.5 rounded-lg"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "var(--text-dim)",
                      }}
                    >
                      Not on bill — company name only (or neither)
                    </p>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <input className="input" value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Category *</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1">
                  {EXPENSE_CATEGORIES.map((c) => {
                    const selected = editForm.category === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, category: c.id })}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[0.65rem] transition-all"
                        style={{
                          background: selected ? c.bg : "rgba(255,255,255,0.03)",
                          border: `1px solid ${selected ? c.color + "55" : "rgba(255,255,255,0.07)"}`,
                          color: selected ? c.color : "var(--text-muted)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>{c.icon}</span>
                        <span className="leading-tight truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-2">
                <label className="label">Notes</label>
                <input className="input" value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>

            {error && (
              <p className="text-xs mt-3 px-3 py-2 rounded-lg"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                className="btn btn-ghost text-sm"
                onClick={() => { setEditTarget(null); setEditForm(null); }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary text-sm"
                onClick={requestSaveEdit}
                disabled={pending}
              >
                Save changes…
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmModifyDialog
        open={confirmModify}
        title="Confirm expense modification"
        description={
          editTarget
            ? `Save changes to “${editTarget.vendor}” (₹${editForm?.amount || editTarget.amount})?`
            : undefined
        }
        pending={pending}
        onCancel={() => setConfirmModify(false)}
        onConfirm={confirmSaveEdit}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title="Delete expense"
        itemLabel={
          deleteTarget
            ? `${deleteTarget.vendor} · ₹${deleteTarget.amount.toLocaleString("en-IN")} · ${deleteTarget.date}`
            : undefined
        }
        description="The expense record and its category mapping will be permanently removed."
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
