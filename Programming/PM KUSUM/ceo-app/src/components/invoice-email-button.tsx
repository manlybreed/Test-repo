"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emailInvoice } from "@/actions/invoices";

export function InvoiceEmailButton({
  invoiceId,
  invoiceNumber,
  buyerName,
  defaultTo = "",
  status,
  hasPdf,
}: {
  invoiceId: string;
  invoiceNumber: string;
  buyerName: string;
  defaultTo?: string;
  status?: string | null;
  hasPdf?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, start] = useTransition();

  if (status && status !== "ISSUED") return null;
  if (hasPdf === false) return null;

  function submit() {
    setError("");
    setOk("");
    start(async () => {
      try {
        const res = await emailInvoice({ invoiceId, to });
        setOk(
          `Sent to ${res.to}${res.cc.length ? ` (CC ${res.cc.join(", ")})` : ""}`,
        );
        router.refresh();
        setTimeout(() => setOpen(false), 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
        style={{
          background: "rgba(56,189,248,0.1)",
          border: "1px solid rgba(56,189,248,0.3)",
          color: "#38bdf8",
          cursor: "pointer",
        }}
        title="Email PDF (CC accounts@thebluridge.com)"
        onClick={() => {
          setTo(defaultTo);
          setError("");
          setOk("");
          setOpen(true);
        }}
      >
        Email
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
            <h3 className="text-lg font-semibold">Email document</h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {invoiceNumber} · {buyerName}
              <br />
              Always CC: accounts@thebluridge.com
            </p>
            <label className="label">To</label>
            <input
              className="input"
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="client@company.com"
              autoFocus
            />
            {error && (
              <div className="text-sm space-y-1" style={{ color: "var(--danger)" }}>
                <p>{error}</p>
                {error.toLowerCase().includes("mail not configured") && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                    Add to <code>.env.local</code>: SMTP_HOST, SMTP_USER, SMTP_PASS
                    (mail.thebluridge.com, port 587), then restart <code>npm run dev</code>.
                  </p>
                )}
              </div>
            )}
            {ok && (
              <p className="text-sm" style={{ color: "#34d399" }}>
                {ok}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !to.trim()}
                onClick={submit}
              >
                {pending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
