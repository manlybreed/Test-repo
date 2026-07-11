"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { updateInvoicePayment } from "@/actions/invoices";

type Status = "PAID" | "UNPAID" | "PARTIAL" | "OVERDUE";

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  PAID:    { label: "PAID",    color: "#34d399", bg: "rgba(16,185,129,0.15)",  border: "rgba(52,211,153,0.35)"  },
  UNPAID:  { label: "UNPAID",  color: "#f87171", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.35)" },
  PARTIAL: { label: "PARTIAL", color: "#fb923c", bg: "rgba(251,146,60,0.15)",  border: "rgba(251,146,60,0.35)"  },
  OVERDUE: { label: "OVERDUE", color: "#fbbf24", bg: "rgba(251,191,36,0.15)",  border: "rgba(251,191,36,0.35)"  },
};

const STATUSES: Status[] = ["UNPAID", "PAID", "PARTIAL", "OVERDUE"];
const TDS_PRESETS = [5, 10, 20] as const;

export function InvoiceStatusCell({
  invoiceId,
  initialStatus,
  initialTdsDeducted,
  initialTdsPercent,
}: {
  invoiceId: string;
  initialStatus: string | null;
  initialTdsDeducted: boolean;
  initialTdsPercent: number | null;
}) {
  const [status, setStatus] = useState<Status>((initialStatus as Status) || "UNPAID");
  const [tdsDeducted, setTdsDeducted] = useState(initialTdsDeducted);
  const [tdsPercent, setTdsPercent] = useState<number>(
    initialTdsPercent != null ? initialTdsPercent : 10,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [tdsOpen, setTdsOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setStatusOpen(false);
        setTdsOpen(false);
      }
    }
    if (statusOpen || tdsOpen) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [statusOpen, tdsOpen]);

  function save(st: Status, tds: boolean, pct: number) {
    setSaveError("");
    start(async () => {
      try {
        await updateInvoicePayment({
          id: invoiceId,
          paymentStatus: st,
          tdsDeducted: tds,
          tdsPercent: tds ? pct : null,
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
    save(s, tdsDeducted, tdsPercent);
  }

  function toggleTds() {
    const next = !tdsDeducted;
    const pct = next ? (tdsPercent || 10) : tdsPercent;
    setTdsDeducted(next);
    if (next && !tdsPercent) setTdsPercent(10);
    save(status, next, pct);
  }

  function selectTdsPercent(pct: number) {
    setTdsPercent(pct);
    setTdsDeducted(true);
    save(status, true, pct);
  }

  const meta = STATUS_META[status] ?? STATUS_META.UNPAID;

  return (
    <div ref={ref} className="flex flex-col gap-1.5 py-0.5" style={{ minWidth: 100 }}>
      {/* Status badge */}
      <button
        type="button"
        onClick={() => { setStatusOpen((v) => !v); setTdsOpen(false); }}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold transition-all cursor-pointer self-start"
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

      {/* Inline status list — expands row height */}
      {statusOpen && (
        <div
          className="flex flex-col rounded-lg overflow-hidden self-start"
          style={{
            border: "1px solid var(--border, rgba(255,255,255,0.1))",
            background: "var(--bg-elevated, rgba(255,255,255,0.03))",
            minWidth: 120,
          }}
        >
          {STATUSES.map((s) => {
            const m = STATUS_META[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => selectStatus(s)}
                className="text-left px-3 py-1.5 text-xs font-semibold flex items-center gap-2 transition-colors"
                style={{
                  color: s === status ? m.color : "var(--text-muted, #aaa)",
                  background: s === status ? m.bg : "transparent",
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* TDS badge */}
      <button
        type="button"
        onClick={() => { setTdsOpen((v) => !v); setStatusOpen(false); }}
        className="inline-flex items-center gap-1 text-[0.6rem] px-1.5 py-0.5 rounded font-semibold transition-all cursor-pointer self-start"
        style={{
          background: tdsDeducted ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.03)",
          color: tdsDeducted ? "#a78bfa" : "var(--text-dim)",
          border: tdsDeducted ? "1px solid rgba(139,92,246,0.3)" : "1px dashed rgba(255,255,255,0.1)",
        }}
        title="TDS deduction rate"
      >
        {tdsDeducted ? `TDS ${tdsPercent}%` : "+ TDS"}
      </button>

      {/* Inline TDS editor — expands row height */}
      {tdsOpen && (
        <div
          className="rounded-lg p-2.5 self-start"
          style={{
            border: "1px solid rgba(139,92,246,0.25)",
            background: "rgba(139,92,246,0.06)",
            minWidth: 140,
          }}
        >
          <p className="text-[0.55rem] uppercase tracking-widest mb-2 font-semibold" style={{ color: "var(--text-dim)" }}>
            TDS deducted
          </p>
          <button
            type="button"
            onClick={toggleTds}
            className="flex items-center gap-2 mb-2 w-full text-left"
          >
            <div
              className="relative shrink-0 rounded-full"
              style={{
                width: 32, height: 18,
                background: tdsDeducted ? "#6366f1" : "rgba(255,255,255,0.1)",
              }}
            >
              <div
                className="absolute top-0.5 rounded-full bg-white transition-transform"
                style={{
                  width: 14, height: 14,
                  transform: tdsDeducted ? "translateX(15px)" : "translateX(2px)",
                }}
              />
            </div>
            <span className="text-[0.65rem] font-medium" style={{ color: tdsDeducted ? "#a78bfa" : "var(--text-dim)" }}>
              {tdsDeducted ? "Yes" : "No"}
            </span>
          </button>
          {tdsDeducted && (
            <div className="flex gap-1">
              {TDS_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => selectTdsPercent(pct)}
                  className="flex-1 text-[0.65rem] py-1 rounded font-bold transition-all"
                  style={{
                    background: tdsPercent === pct ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                    color: tdsPercent === pct ? "#a78bfa" : "var(--text-dim)",
                    border: `1px solid ${tdsPercent === pct ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`,
                    cursor: "pointer",
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {saved && (
        <span className="text-[0.6rem]" style={{ color: "#34d399" }}>✓ Saved</span>
      )}
      {saveError && (
        <span className="text-[0.6rem] max-w-[140px] leading-snug" style={{ color: "#f87171" }} title={saveError}>
          ⚠ {saveError.length > 40 ? "Save failed" : saveError}
        </span>
      )}
    </div>
  );
}
