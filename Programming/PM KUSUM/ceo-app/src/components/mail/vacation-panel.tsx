"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";
import {
  getVacationSettingsAction,
  saveVacationSettingsAction,
} from "@/actions/mail";
import { DEFAULT_EXCLUDED_SENDER_PATTERNS } from "@/lib/mail/vacation";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

function toDateInputValue(d: string | Date | null | undefined) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function VacationPanel({
  open,
  onClose,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  accountId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState("Out of office");
  const [message, setMessage] = useState(
    "I'm currently out of office and will reply when I'm back.",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [excludedSenders, setExcludedSenders] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    void getVacationSettingsAction(accountId).then((row) => {
      if (row) {
        setEnabled(row.enabled);
        setSubject(row.subject);
        setMessage(row.message);
        setStartDate(toDateInputValue(row.startDate));
        setEndDate(toDateInputValue(row.endDate));
        setExcludedSenders(
          row.excludedSenders
            .filter((s) => !DEFAULT_EXCLUDED_SENDER_PATTERNS.includes(s))
            .join(", "),
        );
      } else {
        setEnabled(false);
        setSubject("Out of office");
        setMessage("I'm currently out of office and will reply when I'm back.");
        setStartDate("");
        setEndDate("");
        setExcludedSenders("");
      }
    });
  }, [open, accountId]);

  function save(nextEnabled: boolean) {
    setError("");
    if (nextEnabled && (!startDate || !endDate)) {
      setError("Start and end dates are required");
      haptic("warn");
      return;
    }
    const confirmMsg = nextEnabled
      ? `Turn ON out-of-office auto-replies from ${startDate} through ${endDate}? Everyone who emails you (except excluded senders) will get an automatic reply during that window.`
      : "Turn OFF the out-of-office auto-responder now?";
    if (!window.confirm(confirmMsg)) {
      haptic("warn");
      return;
    }
    const excluded = excludedSenders
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      try {
        await saveVacationSettingsAction({
          enabled: nextEnabled,
          subject: subject.trim() || "Out of office",
          message: message.trim(),
          startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
          endDate: endDate ? new Date(endDate).toISOString() : new Date().toISOString(),
          excludedSenders: excluded,
          confirmed: true,
          accountId,
        });
        setEnabled(nextEnabled);
        setStatus(nextEnabled ? "Out-of-office is now on" : "Out-of-office is now off");
        haptic("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        haptic("warn");
      }
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close out-of-office settings"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div>
                <p
                  className="text-[0.65rem] uppercase tracking-[0.18em]"
                  style={{ color: "var(--accent-bright)" }}
                >
                  Mail settings
                </p>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Out of office
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide"
                  style={{
                    background: enabled ? "rgba(52,211,153,0.15)" : "var(--bg-hover)",
                    color: enabled ? "#34d399" : "var(--text-dim)",
                  }}
                >
                  {enabled ? "On" : "Off"}
                </span>
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
              <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                Subject
                <input
                  className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                  }}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={pending}
                />
              </label>

              <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                Message
                <textarea
                  className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                    minHeight: 100,
                  }}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={pending}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  Start date
                  <input
                    type="date"
                    className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text)",
                    }}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={pending}
                  />
                </label>
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  End date (required)
                  <input
                    type="date"
                    className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text)",
                    }}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={pending}
                  />
                </label>
              </div>
              <p className="text-[0.7rem]" style={{ color: "var(--text-dim)" }}>
                Auto-replies stop on their own after the end date — there&rsquo;s
                no &ldquo;on indefinitely&rdquo; option, and the window is
                capped at 90 days.
              </p>

              <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                Never auto-reply to (comma-separated, in addition to the
                defaults below)
                <input
                  className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                  }}
                  placeholder="e.g. billing@partner.com, @some-list.com"
                  value={excludedSenders}
                  onChange={(e) => setExcludedSenders(e.target.value)}
                  disabled={pending}
                />
              </label>
              <p className="text-[0.7rem]" style={{ color: "var(--text-dim)" }}>
                Always excluded: {DEFAULT_EXCLUDED_SENDER_PATTERNS.join(", ")} —
                plus the mail server&rsquo;s own bulk/mailing-list/auto-submitted
                detection.
              </p>

              {error && (
                <p className="text-xs" style={{ color: "#f87171" }}>
                  {error}
                </p>
              )}
              {status && !error && (
                <p className="text-xs" style={{ color: "#34d399" }}>
                  {status}
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={pending}
                  className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                    color: "#fff",
                    border: "1px solid rgba(129,140,248,0.45)",
                  }}
                  onClick={() => save(true)}
                >
                  {pending ? "Saving…" : enabled ? "Save changes" : "Turn on"}
                </button>
                {enabled && (
                  <button
                    type="button"
                    disabled={pending}
                    className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      color: "#f87171",
                      border: "1px solid rgba(239,68,68,0.3)",
                    }}
                    onClick={() => save(false)}
                  >
                    Turn off
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
