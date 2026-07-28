"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";
import {
  getCalendarConnectionStatusAction,
  disconnectGoogleCalendarAction,
} from "@/actions/calendar";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

type Status = { connected: boolean; googleEmail: string | null; configured: boolean };

export function CalendarPanel({
  open,
  onClose,
  accountId,
  accountAddress,
}: {
  open: boolean;
  onClose: () => void;
  accountId?: string;
  accountAddress?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setStatus(null);
    startTransition(async () => {
      try {
        const res = await getCalendarConnectionStatusAction(accountId);
        setStatus(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load calendar status");
      }
    });
  }, [open, accountId]);

  function connect() {
    haptic("tap");
    const q = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    window.location.href = `/api/calendar/google/authorize${q}`;
  }

  function disconnect() {
    if (
      !window.confirm(
        `Disconnect Google Calendar from ${accountAddress || "this mailbox"}? "Schedule meeting" will go back to downloading an .ics file instead of creating a real event.`,
      )
    ) {
      haptic("warn");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await disconnectGoogleCalendarAction(accountId);
        setStatus((s) => (s ? { ...s, connected: false, googleEmail: null } : s));
        haptic("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not disconnect");
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
            aria-label="Close calendar settings"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl"
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
                  Calendar
                </h2>
              </div>
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

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {!status && !error && (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Loading…
                </p>
              )}

              {status && (
                <div
                  className="space-y-2 rounded-lg px-3 py-3 text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="truncate font-medium" style={{ color: "var(--text)" }}>
                    {accountAddress || "This mailbox"}
                  </div>

                  {status.connected ? (
                    <>
                      <p className="text-xs" style={{ color: "#4ade80" }}>
                        Connected as {status.googleEmail} — &ldquo;Schedule
                        meeting&rdquo; creates a real Calendar event with a Meet
                        link and sends invites.
                      </p>
                      <button
                        type="button"
                        disabled={pending}
                        className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          background: "rgba(239,68,68,0.12)",
                          color: "#f87171",
                          border: "1px solid rgba(239,68,68,0.3)",
                        }}
                        onClick={disconnect}
                      >
                        {pending ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                        Not connected — &ldquo;Schedule meeting&rdquo; downloads
                        an .ics file to attach/forward manually until this is
                        connected.
                      </p>
                      {!status.configured && (
                        <p className="text-xs" style={{ color: "#f87171" }}>
                          Google Calendar isn&apos;t configured on this server
                          yet (GOOGLE_CALENDAR_CLIENT_ID/SECRET missing).
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={!status.configured}
                        className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                          color: "#fff",
                          border: "1px solid rgba(129,140,248,0.45)",
                        }}
                        onClick={connect}
                      >
                        Connect Google Calendar
                      </button>
                    </>
                  )}
                </div>
              )}

              {error && (
                <p className="text-xs" style={{ color: "#f87171" }}>
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
