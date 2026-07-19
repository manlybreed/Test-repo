"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Destructive delete: user must type DELETE to confirm. */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  itemLabel,
  onConfirm,
  onCancel,
  pending,
}: {
  open: boolean;
  title: string;
  description?: string;
  itemLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const canDelete = typed === "DELETE";

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: "var(--bg-card, #1a1f2e)", border: "1px solid rgba(239,68,68,0.35)" }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4h8v2"/>
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: "#f87171" }}>{title}</h3>
            {itemLabel && (
              <p className="text-sm mt-1 font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{itemLabel}</p>
            )}
          </div>
        </div>

        <div
          className="rounded-xl px-3 py-2.5 mb-4 text-xs leading-relaxed"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}
        >
          <strong>Warning:</strong> This cannot be undone. The record will be permanently removed from the database.
          {description ? ` ${description}` : ""}
        </div>

        <label className="block text-[0.65rem] tracking-[0.12em] uppercase mb-1.5 font-semibold" style={{ color: "var(--text-dim)" }}>
          Type <span style={{ color: "#f87171" }}>DELETE</span> to confirm
        </label>
        <input
          className="input w-full mb-5"
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canDelete && !pending) onConfirm();
            if (e.key === "Escape" && !pending) onCancel();
          }}
        />

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="text-sm px-4 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
            style={{
              background: canDelete ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${canDelete ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.08)"}`,
              color: canDelete ? "#f87171" : "var(--text-dim)",
              cursor: canDelete && !pending ? "pointer" : "not-allowed",
            }}
            disabled={!canDelete || pending}
            onClick={onConfirm}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Soft confirmation before saving modifications. */
export function ConfirmModifyDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  pending,
  confirmLabel = "Confirm & save",
  pendingLabel = "Saving…",
}: {
  open: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: "var(--bg-card, #1a1f2e)", border: "1px solid rgba(99,102,241,0.35)" }}
      >
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <p className="text-sm mb-5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {description || "Please confirm you want to save these changes."}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost text-sm" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary text-sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
