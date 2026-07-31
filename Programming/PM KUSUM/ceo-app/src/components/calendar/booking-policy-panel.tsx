"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";
import {
  checkSlugAvailableAction,
  getBookingPolicyAction,
  saveBookingPolicyAction,
  type BookingPolicySettings,
  type WeeklyWindowsInput,
} from "@/actions/booking-policy";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

const DAYS: { key: keyof WeeklyWindowsInput; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DURATION_CHOICES = [15, 30, 45, 60, 90];

type DayRow = { enabled: boolean; start: string; end: string };

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function rowsFromWeeklyWindows(weeklyWindows: WeeklyWindowsInput): Record<string, DayRow> {
  const out: Record<string, DayRow> = {};
  for (const { key } of DAYS) {
    const windows = weeklyWindows[key];
    const first = windows?.[0];
    out[key] = first
      ? { enabled: true, start: minutesToTime(first.startMin), end: minutesToTime(first.endMin) }
      : { enabled: false, start: "09:00", end: "18:00" };
  }
  return out;
}

function weeklyWindowsFromRows(rows: Record<string, DayRow>): WeeklyWindowsInput {
  const out: WeeklyWindowsInput = {};
  for (const { key } of DAYS) {
    const row = rows[key];
    if (row?.enabled) {
      out[key] = [{ startMin: timeToMinutes(row.start), endMin: timeToMinutes(row.end) }];
    }
  }
  return out;
}

export function BookingPolicyPanel({
  open,
  onClose,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  accountId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState<BookingPolicySettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dayRows, setDayRows] = useState<Record<string, DayRow>>({});
  const [durationOptions, setDurationOptions] = useState<number[]>([30]);
  const [bufferBeforeMins, setBufferBeforeMins] = useState(0);
  const [bufferAfterMins, setBufferAfterMins] = useState(0);
  const [minNoticeHours, setMinNoticeHours] = useState(24);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(30);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaved(false);
    setLoaded(null);
    startTransition(async () => {
      try {
        const res = await getBookingPolicyAction(accountId);
        setLoaded(res);
        setEnabled(res.enabled);
        setSlug(res.slug);
        setSlugStatus("idle");
        setTitle(res.title);
        setDescription(res.description);
        setDayRows(rowsFromWeeklyWindows(res.weeklyWindows));
        setDurationOptions(res.durationOptions);
        setBufferBeforeMins(res.bufferBeforeMins);
        setBufferAfterMins(res.bufferAfterMins);
        setMinNoticeHours(res.minNoticeHours);
        setMaxAdvanceDays(res.maxAdvanceDays);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load booking settings");
      }
    });
  }, [open, accountId]);

  // Debounced live slug-availability check — skips the call entirely when
  // the slug hasn't actually changed from what was loaded (the common
  // case of opening, leaving the slug alone, and just flipping other
  // fields shouldn't spam an availability check on the CEO's own slug).
  useEffect(() => {
    if (!open || !loaded) return;
    const clean = slug.trim().toLowerCase();
    if (clean === loaded.slug) {
      setSlugStatus("idle");
      return;
    }
    if (!clean || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(clean)) {
      setSlugStatus(clean ? "invalid" : "idle");
      return;
    }
    setSlugStatus("checking");
    const t = setTimeout(() => {
      checkSlugAvailableAction(clean, accountId)
        .then((r) => setSlugStatus(r.available ? "available" : "taken"))
        .catch(() => setSlugStatus("idle"));
    }, 400);
    return () => clearTimeout(t);
  }, [slug, open, loaded, accountId]);

  const publicUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/book/${slug.trim().toLowerCase() || "…"}`;
  }, [slug]);

  function toggleDuration(d: number) {
    haptic("tap");
    setDurationOptions((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  function updateDayRow(key: string, patch: Partial<DayRow>) {
    setDayRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function copyLink() {
    haptic("tap");
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function save() {
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        const res = await saveBookingPolicyAction(
          {
            enabled,
            slug,
            title,
            description,
            weeklyWindows: weeklyWindowsFromRows(dayRows),
            durationOptions,
            bufferBeforeMins,
            bufferAfterMins,
            minNoticeHours,
            maxAdvanceDays,
          },
          accountId,
        );
        if (!res.ok) {
          setError(res.error);
          haptic("warn");
          return;
        }
        setSaved(true);
        haptic("success");
        setTimeout(() => setSaved(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save booking settings");
        haptic("warn");
      }
    });
  }

  const slugHint =
    slugStatus === "checking"
      ? "Checking…"
      : slugStatus === "available"
        ? "Available"
        : slugStatus === "taken"
          ? "Already taken"
          : slugStatus === "invalid"
            ? "Lowercase letters, numbers, hyphens only"
            : "";
  const slugHintColor =
    slugStatus === "available" ? "#4ade80" : slugStatus === "taken" || slugStatus === "invalid" ? "#f87171" : "var(--text-dim)";

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
            aria-label="Close booking link settings"
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
                <p className="text-[0.65rem] uppercase tracking-[0.18em]" style={{ color: "var(--accent-bright)" }}>
                  Calendar settings
                </p>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Public booking link
                </h2>
              </div>
              <button
                type="button"
                className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                onClick={onClose}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
              {!loaded && !error && (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Loading…
                </p>
              )}

              {loaded && (
                <>
                  <label className="flex items-center justify-between gap-3 rounded-lg px-3 py-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                      Allow public booking
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-[var(--accent-bright)]"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                  </label>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                        Link
                      </span>
                      {slugHint && (
                        <span className="text-xs" style={{ color: slugHintColor }}>
                          {slugHint}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)" }}>
                      <span className="shrink-0 text-sm" style={{ color: "var(--text-muted)" }}>
                        /book/
                      </span>
                      <input
                        className="w-full cursor-text bg-transparent text-sm outline-none"
                        style={{ color: "var(--text)" }}
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="akshay-30min"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                      <span className="truncate">{publicUrl}</span>
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded-md px-2 py-1 font-medium"
                        style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                        onClick={copyLink}
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Meeting title
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>

                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Description (shown to visitors)
                    <textarea
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)", resize: "vertical", minHeight: "60px" }}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>

                  <div>
                    <p className="mb-1.5 text-xs" style={{ color: "var(--text-dim)" }}>
                      Available hours (IST)
                    </p>
                    <div className="space-y-1.5">
                      {DAYS.map(({ key, label }) => {
                        const row = dayRows[key] ?? { enabled: false, start: "09:00", end: "18:00" };
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                          >
                            <label className="flex w-24 shrink-0 cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text)" }}>
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-bright)]"
                                checked={row.enabled}
                                onChange={(e) => updateDayRow(key, { enabled: e.target.checked })}
                              />
                              {label.slice(0, 3)}
                            </label>
                            <input
                              type="time"
                              disabled={!row.enabled}
                              className="w-full cursor-pointer rounded-md px-2 py-1 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-40"
                              style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
                              value={row.start}
                              onChange={(e) => updateDayRow(key, { start: e.target.value })}
                            />
                            <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                              –
                            </span>
                            <input
                              type="time"
                              disabled={!row.enabled}
                              className="w-full cursor-pointer rounded-md px-2 py-1 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-40"
                              style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
                              value={row.end}
                              onChange={(e) => updateDayRow(key, { end: e.target.value })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs" style={{ color: "var(--text-dim)" }}>
                      Meeting lengths visitors can pick
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {DURATION_CHOICES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
                          style={{
                            background: durationOptions.includes(d) ? "var(--accent-dim)" : "var(--bg-hover)",
                            color: durationOptions.includes(d) ? "var(--accent-bright)" : "var(--text-muted)",
                            border: `1px solid ${durationOptions.includes(d) ? "var(--accent-bright)" : "var(--border)"}`,
                          }}
                          onClick={() => toggleDuration(d)}
                        >
                          {d} min
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Buffer before (min)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={bufferBeforeMins}
                        onChange={(e) => setBufferBeforeMins(Number(e.target.value))}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Buffer after (min)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={bufferAfterMins}
                        onChange={(e) => setBufferAfterMins(Number(e.target.value))}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Minimum notice (hours)
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={minNoticeHours}
                        onChange={(e) => setMinNoticeHours(Number(e.target.value))}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Bookable days ahead
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={maxAdvanceDays}
                        onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              )}

              {error && (
                <p className="text-xs" style={{ color: "#f87171" }}>
                  {error}
                </p>
              )}
              {saved && (
                <p className="text-xs" style={{ color: "#4ade80" }}>
                  Saved.
                </p>
              )}
            </div>

            {loaded && (
              <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
                <button
                  type="button"
                  disabled={pending || slugStatus === "taken" || slugStatus === "invalid"}
                  className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                    color: "#fff",
                    border: "1px solid rgba(129,140,248,0.45)",
                  }}
                  onClick={save}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
