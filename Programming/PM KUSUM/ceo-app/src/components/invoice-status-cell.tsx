"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { updateInvoicePayment } from "@/actions/invoices";

type Status = "PAID" | "UNPAID" | "PARTIAL" | "OVERDUE";

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  PAID:    { label: "PAID",     color: "#34d399", bg: "rgba(16,185,129,0.12)",  border: "rgba(52,211,153,0.3)"  },
  UNPAID:  { label: "UNPAID",   color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)" },
  PARTIAL: { label: "PARTIAL",  color: "#fb923c", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.3)"  },
  OVERDUE: { label: "OVERDUE",  color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)"  },
};

const STATUSES: Status[] = ["UNPAID", "PAID", "PARTIAL", "OVERDUE"];

export function InvoiceStatusCell({
  invoiceId,
  initialStatus,
  initialTdsDeducted,
  initialTdsAmount,
}: {
  invoiceId: string;
  initialStatus: string | null;
  initialTdsDeducted: boolean;
  initialTdsAmount: number | null;
}) {
  const [status, setStatus] = useState<Status>(
    (initialStatus as Status) || "UNPAID"
  );
  const [tdsDeducted, setTdsDeducted] = useState(initialTdsDeducted);
  const [tdsAmount, setTdsAmount] = useState<string>(
    initialTdsAmount != null ? String(initialTdsAmount) : ""
  );
  const [open, setOpen] = useState(false);
  const [showTds, setShowTds] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowTds(false);
      }
    }
    if (open || showTds) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, showTds]);

  function save(newStatus: Status, newTds: boolean, newTdsAmt: string) {
    start(async () => {
      await updateInvoicePayment({
        id: invoiceId,
        paymentStatus: newStatus,
        tdsDeducted: newTds,
        tdsAmount: newTdsAmt ? parseFloat(newTdsAmt) : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function selectStatus(s: Status) {
    setStatus(s);
    setOpen(false);
    save(s, tdsDeducted, tdsAmount);
  }

  function toggleTds() {
    const next = !tdsDeducted;
    setTdsDeducted(next);
    if (!next) setTdsAmount("");
    save(status, next, next ? tdsAmount : "");
  }

  const meta = STATUS_META[status] ?? STATUS_META.UNPAID;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      {/* Status badge — click to open dropdown */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setShowTds(false); }}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold transition-all cursor-pointer"
        style={{
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.border}`,
          opacity: pending ? 0.6 : 1,
        }}
        title="Click to change payment status"
      >
        {meta.label}
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {/* TDS badge */}
      <button
        type="button"
        onClick={() => { setShowTds((v) => !v); setOpen(false); }}
        className="inline-flex items-center gap-1 text-[0.6rem] px-1.5 py-0.5 rounded font-semibold transition-all cursor-pointer"
        style={{
          background: tdsDeducted ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.03)",
          color: tdsDeducted ? "#a78bfa" : "var(--text-dim)",
          border: tdsDeducted ? "1px solid rgba(139,92,246,0.3)" : "1px dashed rgba(255,255,255,0.1)",
        }}
        title="Click to configure TDS"
      >
        {tdsDeducted ? `TDS ₹${tdsAmount || "?"}` : "TDS"}
      </button>

      {/* Status dropdown */}
      {open && (
        <div
          className="absolute top-7 left-0 z-50 rounded-xl overflow-hidden shadow-2xl"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            minWidth: "120px",
          }}
        >
          {STATUSES.map((s) => {
            const m = STATUS_META[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => selectStatus(s)}
                className="w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-2 transition-colors"
                style={{
                  color: s === status ? m.color : "var(--text-muted)",
                  background: s === status ? m.bg : "transparent",
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: m.color }}
                />
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* TDS editor */}
      {showTds && (
        <div
          className="absolute top-12 left-0 z-50 rounded-xl p-3 shadow-2xl"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            minWidth: "180px",
          }}
        >
          <p className="text-[0.6rem] uppercase tracking-widest mb-2 font-semibold" style={{ color: "var(--text-dim)" }}>
            TDS deducted
          </p>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <div
              className="relative w-8 h-4 rounded-full transition-colors"
              style={{ background: tdsDeducted ? "#6366f1" : "rgba(255,255,255,0.1)" }}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                style={{ transform: tdsDeducted ? "translateX(18px)" : "translateX(2px)" }}
              />
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={tdsDeducted}
              onChange={toggleTds}
            />
            <span className="text-xs" style={{ color: tdsDeducted ? "#a78bfa" : "var(--text-muted)" }}>
              {tdsDeducted ? "Yes" : "No"}
            </span>
          </label>

          {tdsDeducted && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>₹</span>
              <input
                type="number"
                min={0}
                className="input text-xs py-1"
                style={{ width: "100px" }}
                placeholder="Amount"
                value={tdsAmount}
                onChange={(e) => setTdsAmount(e.target.value)}
                onBlur={() => save(status, tdsDeducted, tdsAmount)}
              />
            </div>
          )}

          {saved && (
            <p className="text-[0.65rem] mt-2" style={{ color: "#34d399" }}>✓ Saved</p>
          )}
        </div>
      )}

      {saved && !open && !showTds && (
        <span className="text-[0.6rem]" style={{ color: "#34d399" }}>✓ Saved</span>
      )}
    </div>
  );
}
