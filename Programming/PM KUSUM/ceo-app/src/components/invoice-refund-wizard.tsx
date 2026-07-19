"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getRefundAdvice,
  issueRefundViaCreditNote,
} from "@/actions/invoices";

export function InvoiceRefundWizard({
  invoiceId,
  invoiceNumber,
  grandTotal,
}: {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [partial, setPartial] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [reference, setReference] = useState("");
  const [advice, setAdvice] = useState<string>("");
  const [error, setError] = useState("");

  function loadAdvice() {
    start(async () => {
      try {
        const a = await getRefundAdvice(invoiceId, reason);
        setAdvice(`${a.path} (${a.fullOrPartial}): ${a.notes}`);
        if (a.reasonText) setReason(a.reasonText);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Advice failed");
      }
    });
  }

  function submit() {
    setError("");
    start(async () => {
      try {
        const res = await issueRefundViaCreditNote({
          invoiceId,
          reason,
          partialAmount: partial ? Number(partial) : undefined,
          refundMode: mode,
          refundReference: reference || undefined,
        });
        setOpen(false);
        alert(`Credit note ${res.number} issued for refund.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Refund failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
        style={{
          background: "rgba(251,191,36,0.1)",
          border: "1px solid rgba(251,191,36,0.3)",
          color: "#fbbf24",
          cursor: "pointer",
        }}
        onClick={() => {
          setOpen(true);
          loadAdvice();
        }}
        title="GST refund via Credit Note"
      >
        Refund
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 space-y-3"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="text-lg font-semibold">Issue refund (GST)</h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {invoiceNumber} · max {grandTotal.toLocaleString("en-IN")} — creates
              a Credit Note; does not delete the tax invoice.
            </p>
            {advice && (
              <p className="text-xs" style={{ color: "#34d399" }}>
                AI: {advice}
              </p>
            )}
            <label className="label">Reason</label>
            <textarea
              className="input min-h-[72px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <label className="label">Partial amount (optional)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={grandTotal}
              value={partial}
              onChange={(e) => setPartial(e.target.value)}
              placeholder="Leave blank for full"
            />
            <label className="label">Refund mode</label>
            <input
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            />
            <label className="label">Bank / UPI reference</label>
            <input
              className="input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            {error && (
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submit}
                disabled={pending}
              >
                {pending ? "Issuing…" : "Issue Credit Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
