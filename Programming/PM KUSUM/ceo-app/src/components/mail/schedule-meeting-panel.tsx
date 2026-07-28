"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";
import { createMeetingAction, type MeetingResult } from "@/actions/calendar";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

const DURATIONS = [15, 30, 45, 60, 90];

function fieldInputStyle() {
  return {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    color: "var(--text)",
  };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Tomorrow at 10:00 local time, as separate date/time-input default strings. */
function defaultDateTime(): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: "10:00",
  };
}

export function ScheduleMeetingPanel({
  open,
  onClose,
  accountId,
  defaultTitle,
  defaultAttendees,
}: {
  open: boolean;
  onClose: () => void;
  accountId?: string;
  defaultTitle: string;
  defaultAttendees: string[];
}) {
  const [pending, startTransition] = useTransition();
  const initial = defaultDateTime();
  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(30);
  const [attendees, setAttendees] = useState(defaultAttendees.join(", "));
  const [error, setError] = useState("");
  const [result, setResult] = useState<MeetingResult | null>(null);

  function reset() {
    const d = defaultDateTime();
    setTitle(defaultTitle);
    setDate(d.date);
    setTime(d.time);
    setDuration(30);
    setAttendees(defaultAttendees.join(", "));
    setError("");
    setResult(null);
  }

  function close() {
    onClose();
    // Wait for the close animation rather than resetting mid-fade.
    setTimeout(reset, 200);
  }

  function schedule() {
    setError("");
    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) {
      setError("Pick a valid date and time");
      return;
    }
    const end = new Date(start.getTime() + duration * 60 * 1000);
    const attendeeEmails = attendees
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    startTransition(async () => {
      try {
        const res = await createMeetingAction({
          title: title.trim() || "Meeting",
          description: "Scheduled from BluRidge Mail",
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          attendeeEmails,
          confirmed: true,
          accountId,
        });
        if (res.via === "ics") {
          const blob = new Blob([res.ics], { type: "text/calendar;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = res.filename;
          a.click();
          URL.revokeObjectURL(url);
        }
        setResult(res);
        haptic("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not schedule meeting");
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
            aria-label="Close schedule meeting"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={close}
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
              <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                Schedule meeting
              </h2>
              <button
                type="button"
                className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                style={{
                  background: "var(--bg-hover)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
                onClick={close}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {!result && (
                <>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Title
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Date
                      <input
                        type="date"
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Time
                      <input
                        type="time"
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Duration
                    <select
                      className="mt-1 w-full cursor-pointer rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      {DURATIONS.map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Attendees (comma-separated)
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      placeholder="name@company.com, ..."
                      value={attendees}
                      onChange={(e) => setAttendees(e.target.value)}
                    />
                  </label>

                  {error && (
                    <p className="text-xs" style={{ color: "#f87171" }}>
                      {error}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending || !title.trim()}
                      className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                        color: "#fff",
                        border: "1px solid rgba(129,140,248,0.45)",
                      }}
                      onClick={schedule}
                    >
                      {pending ? "Scheduling…" : "Schedule"}
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded-lg px-4 py-2 text-xs"
                      style={{
                        background: "transparent",
                        color: "var(--text-dim)",
                        border: "1px solid var(--border)",
                      }}
                      onClick={close}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {result && result.via === "google" && (
                <div className="space-y-2 text-sm">
                  <p style={{ color: "#4ade80" }}>
                    Meeting scheduled — invites sent to attendees.
                  </p>
                  {result.meetLink && (
                    <a
                      href={result.meetLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate underline"
                      style={{ color: "var(--accent-bright)" }}
                    >
                      {result.meetLink}
                    </a>
                  )}
                  <a
                    href={result.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs underline"
                    style={{ color: "var(--text-dim)" }}
                  >
                    View on Google Calendar
                  </a>
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg px-4 py-2 text-xs"
                    style={{
                      background: "var(--bg-hover)",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                    }}
                    onClick={close}
                  >
                    Done
                  </button>
                </div>
              )}

              {result && result.via === "ics" && (
                <div className="space-y-2 text-sm">
                  <p style={{ color: "var(--text)" }}>
                    ICS downloaded — attach or forward as needed. Connect Google
                    Calendar in Mail settings to send real invites automatically
                    next time.
                  </p>
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg px-4 py-2 text-xs"
                    style={{
                      background: "var(--bg-hover)",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                    }}
                    onClick={close}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
