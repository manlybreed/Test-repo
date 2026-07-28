"use client";

export type PendingAction = {
  toolName: string;
  toolInput: Record<string, unknown>;
  summary: string;
  /** Set once the user has acted — the card renders as a static outcome afterward, not buttons again. */
  resolved?: "confirmed" | "cancelled";
};

/**
 * Inline confirmation card for an irreversible AI tool call (schedule a
 * meeting, send/trash mail, ...) — a real Confirm/Cancel click is the only
 * thing that ever executes the action; the model's own tool call only
 * ever produces this card (see CONFIRMATION_REQUIRED_TOOLS in
 * src/lib/ai/tools.ts). Deliberately an inline card in the message flow,
 * not a blocking modal — the CEO can keep reading/scrolling the
 * conversation around it.
 */
export function ConfirmationCard({
  action,
  onConfirm,
  onCancel,
  pending,
}: {
  action: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  if (action.resolved === "confirmed") {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "#4ade80" }}>
        <span>✓</span>
        <span>Confirmed</span>
      </div>
    );
  }
  if (action.resolved === "cancelled") {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
        <span>✕</span>
        <span>Cancelled</span>
      </div>
    );
  }

  return (
    <div
      className="mt-2 rounded-xl p-3.5"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.35)",
      }}
    >
      <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--text)" }}>
        {action.summary}
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="text-xs px-3.5 py-1.5 rounded-md font-semibold disabled:opacity-50"
          style={{ background: "#f59e0b", color: "#1a1206", border: "none", cursor: pending ? "not-allowed" : "pointer" }}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Working…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
