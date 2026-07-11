"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import { updateInvoicePayment } from "@/actions/invoices";

type Status = "PAID" | "UNPAID" | "PARTIAL" | "OVERDUE";

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  PAID:    { label: "PAID",    color: "#34d399", bg: "rgba(16,185,129,0.15)",  border: "rgba(52,211,153,0.35)"  },
  UNPAID:  { label: "UNPAID",  color: "#f87171", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.35)" },
  PARTIAL: { label: "PARTIAL", color: "#fb923c", bg: "rgba(251,146,60,0.15)",  border: "rgba(251,146,60,0.35)"  },
  OVERDUE: { label: "OVERDUE", color: "#fbbf24", bg: "rgba(251,191,36,0.15)",  border: "rgba(251,191,36,0.35)"  },
};

const STATUSES: Status[] = ["UNPAID", "PAID", "PARTIAL", "OVERDUE"];

/** Floating popup rendered into <body> via portal so table overflow:hidden never clips it */
function FloatingPopup({
  anchor,
  children,
  onClose,
}: {
  anchor: { top: number; left: number; width: number };
  children: React.ReactNode;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on scroll so popup doesn't float away from its anchor
  useEffect(() => {
    function onScroll() { onClose(); }
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        zIndex: 9999,
        minWidth: Math.max(anchor.width, 130),
        background: "var(--bg-card, #1a1f2e)",
        border: "1px solid var(--border, rgba(255,255,255,0.1))",
        borderRadius: "12px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

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
  const [status, setStatus] = useState<Status>((initialStatus as Status) || "UNPAID");
  const [tdsDeducted, setTdsDeducted] = useState(initialTdsDeducted);
  const [tdsAmount, setTdsAmount] = useState<string>(
    initialTdsAmount != null ? String(initialTdsAmount) : "",
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [tdsOpen, setTdsOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const statusBtnRef = useRef<HTMLButtonElement>(null);
  const tdsBtnRef = useRef<HTMLButtonElement>(null);
  const [statusAnchor, setStatusAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [tdsAnchor, setTdsAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  function openStatus() {
    const r = statusBtnRef.current?.getBoundingClientRect();
    if (r) setStatusAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
    setStatusOpen(true);
    setTdsOpen(false);
  }

  function openTds() {
    const r = tdsBtnRef.current?.getBoundingClientRect();
    if (r) setTdsAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
    setTdsOpen(true);
    setStatusOpen(false);
  }

  function save(st: Status, tds: boolean, amt: string) {
    setSaveError("");
    start(async () => {
      try {
        await updateInvoicePayment({
          id: invoiceId,
          paymentStatus: st,
          tdsDeducted: tds,
          tdsAmount: amt ? parseFloat(amt) : null,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function selectStatus(s: Status) {
    setStatus(s);
    setStatusOpen(false);
    save(s, tdsDeducted, tdsAmount);
  }

  function toggleTds() {
    const next = !tdsDeducted;
    const nextAmt = next ? tdsAmount : "";
    setTdsDeducted(next);
    if (!next) setTdsAmount("");
    save(status, next, nextAmt);
  }

  const meta = STATUS_META[status] ?? STATUS_META.UNPAID;

  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 90 }}>
      {/* Status badge */}
      <button
        ref={statusBtnRef}
        type="button"
        onClick={openStatus}
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
        <svg width="8" height="8" viewBox="0 0 10 10">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {/* TDS badge */}
      <button
        ref={tdsBtnRef}
        type="button"
        onClick={openTds}
        className="inline-flex items-center gap-1 text-[0.6rem] px-1.5 py-0.5 rounded font-semibold transition-all cursor-pointer"
        style={{
          background: tdsDeducted ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.03)",
          color: tdsDeducted ? "#a78bfa" : "var(--text-dim)",
          border: tdsDeducted ? "1px solid rgba(139,92,246,0.3)" : "1px dashed rgba(255,255,255,0.1)",
        }}
        title="TDS deduction"
      >
        {tdsDeducted ? `TDS ₹${tdsAmount || "?"}` : "+ TDS"}
      </button>

      {saved && (
        <span className="text-[0.6rem]" style={{ color: "#34d399" }}>✓ Saved</span>
      )}
      {saveError && (
        <span className="text-[0.6rem]" style={{ color: "#f87171" }} title={saveError}>⚠ Failed</span>
      )}

      {/* Status dropdown — rendered in portal at body level */}
      {statusOpen && statusAnchor && (
        <FloatingPopup anchor={statusAnchor} onClose={() => setStatusOpen(false)}>
          {STATUSES.map((s) => {
            const m = STATUS_META[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => selectStatus(s)}
                className="w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-2 transition-colors"
                style={{
                  color: s === status ? m.color : "var(--text-muted, #aaa)",
                  background: s === status ? m.bg : "transparent",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = m.bg; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = s === status ? m.bg : "transparent"; }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                {m.label}
              </button>
            );
          })}
        </FloatingPopup>
      )}

      {/* TDS editor popup — rendered in portal */}
      {tdsOpen && tdsAnchor && (
        <FloatingPopup anchor={tdsAnchor} onClose={() => setTdsOpen(false)}>
          <div className="p-3">
            <p className="text-[0.6rem] uppercase tracking-widest mb-3 font-semibold" style={{ color: "var(--text-dim, #888)" }}>
              TDS deducted by client
            </p>

            {/* Toggle switch — plain button, no hidden inputs */}
            <button
              type="button"
              onClick={toggleTds}
              className="flex items-center gap-2 cursor-pointer mb-3 w-full text-left"
            >
              <div
                className="relative shrink-0 rounded-full transition-colors"
                style={{
                  width: 36, height: 20,
                  background: tdsDeducted ? "#6366f1" : "rgba(255,255,255,0.1)",
                }}
              >
                <div
                  className="absolute top-1 rounded-full bg-white transition-transform"
                  style={{
                    width: 14, height: 14,
                    transform: tdsDeducted ? "translateX(18px)" : "translateX(3px)",
                  }}
                />
              </div>
              <span className="text-xs font-medium" style={{ color: tdsDeducted ? "#a78bfa" : "var(--text-muted, #aaa)" }}>
                {tdsDeducted ? "Yes — TDS deducted" : "No — not deducted"}
              </span>
            </button>

            {tdsDeducted && (
              <div className="space-y-1">
                <label className="text-[0.6rem] uppercase tracking-widest" style={{ color: "var(--text-dim, #888)" }}>
                  TDS Amount (₹)
                </label>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xs" style={{ color: "var(--text-dim, #888)" }}>₹</span>
                  <input
                    type="number"
                    min={0}
                    className="input text-xs py-1"
                    style={{ width: 110 }}
                    placeholder="e.g. 10000"
                    value={tdsAmount}
                    onChange={(e) => setTdsAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => { save(status, tdsDeducted, tdsAmount); setTdsOpen(false); }}
                    className="text-xs px-2 py-1 rounded-lg font-semibold"
                    style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {saved && (
              <p className="text-[0.65rem] mt-2" style={{ color: "#34d399" }}>✓ Saved</p>
            )}
            {saveError && (
              <p className="text-[0.65rem] mt-2" style={{ color: "#f87171" }}>⚠ {saveError}</p>
            )}
          </div>
        </FloatingPopup>
      )}
    </div>
  );
}
