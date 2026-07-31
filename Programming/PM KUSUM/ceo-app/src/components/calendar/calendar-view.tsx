"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { haptic } from "@/components/mail/haptics";
import {
  cancelMeetingAction,
  listCalendarEventsAction,
  updateMeetingAction,
  type CalendarEventListResult,
} from "@/actions/calendar";
import type { CalendarEventSummary } from "@/lib/calendar/google";
import { BookingPolicyPanel } from "@/components/calendar/booking-policy-panel";
import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { TimeGrid } from "@/components/calendar/time-grid";
import { ScheduleMeetingPanel } from "@/components/mail/schedule-meeting-panel";

const DURATIONS = [15, 30, 45, 60, 90];

/** Stable reference — ScheduleMeetingPanel's reset effect keys off
 * defaultAttendees, so a fresh `[]` literal each render would retrigger it. */
const EMPTY_ATTENDEES: string[] = [];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toTimeInputValue(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

type ViewMode = "month" | "week" | "day";

function rangeFor(viewMode: ViewMode, anchor: Date): { start: Date; end: Date } {
  if (viewMode === "day") {
    return { start: startOfDay(anchor), end: endOfDay(anchor) };
  }
  if (viewMode === "week") {
    return {
      start: startOfWeek(anchor, { weekStartsOn: 0 }),
      end: endOfWeek(anchor, { weekStartsOn: 0 }),
    };
  }
  // Month view fetches the full 7-col grid, including leading/trailing
  // days from adjacent months that fill out the first/last week.
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  return {
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  };
}

function shiftAnchor(viewMode: ViewMode, anchor: Date, dir: -1 | 1): Date {
  if (viewMode === "day") return dir === 1 ? addDays(anchor, 1) : subDays(anchor, 1);
  if (viewMode === "week") return dir === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
  return dir === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
}

function headerLabel(viewMode: ViewMode, anchor: Date): string {
  if (viewMode === "day") return format(anchor, "EEEE, MMMM d, yyyy");
  if (viewMode === "week") {
    const { start, end } = rangeFor("week", anchor);
    const sameMonth = isSameMonth(start, end);
    return sameMonth
      ? `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
      : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(anchor, "MMMM yyyy");
}

export function CalendarView({ accountId }: { accountId?: string }) {
  const [pending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<CalendarEventListResult | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarEventSummary | null>(null);
  const [showBookingPolicy, setShowBookingPolicy] = useState(false);
  // Set by clicking an empty grid slot, a Month-cell "+", or the header's
  // "New event" — pre-fills ScheduleMeetingPanel's date/time fields.
  const [creatingAt, setCreatingAt] = useState<{ date: string; time: string } | null>(null);
  // Bumped after a successful edit/cancel so the fetch effect below
  // re-runs for the *same* visible range (startIso/endIso alone
  // wouldn't change) and the grid reflects the mutation immediately.
  const [refreshTick, setRefreshTick] = useState(0);

  const { start, end } = useMemo(() => rangeFor(viewMode, anchor), [viewMode, anchor]);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  useEffect(() => {
    setError("");
    startTransition(async () => {
      try {
        const res = await listCalendarEventsAction(startIso, endIso, accountId);
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load calendar");
      }
    });
  }, [startIso, endIso, accountId, refreshTick]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventSummary[]>();
    for (const ev of data?.events ?? []) {
      const key = format(new Date(ev.start), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [data]);

  // The concrete day columns TimeGrid renders: 7 for week, 1 for day.
  const visibleDays = useMemo(
    () =>
      viewMode === "day"
        ? [anchor]
        : Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    [viewMode, anchor, start],
  );

  function go(dir: -1 | 1) {
    haptic("tap");
    setAnchor((a) => shiftAnchor(viewMode, a, dir));
  }

  function goToday() {
    haptic("tap");
    setAnchor(new Date());
  }

  function openCreateAt(day: Date, time = "10:00") {
    haptic("tap");
    setCreatingAt({ date: toDateInputValue(day), time });
  }

  if (data && !data.connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Google Calendar isn&apos;t connected for this mailbox yet.
        </p>
        <p className="max-w-sm text-xs" style={{ color: "var(--text-muted)" }}>
          Connect it from Mail → settings → Calendar to see real events here
          and schedule meetings with a Meet link automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside
        className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto p-4 md:flex"
        style={{ borderRight: "1px solid var(--border)" }}
      >
        <button
          type="button"
          className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium"
          style={{
            background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
            color: "#fff",
            border: "1px solid rgba(129,140,248,0.45)",
          }}
          onClick={() => openCreateAt(anchor)}
        >
          + New event
        </button>
        <MiniCalendar anchor={anchor} onSelect={(d) => setAnchor(d)} />
      </aside>

      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
            style={{
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            onClick={() => go(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
            onClick={goToday}
          >
            Today
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm"
            style={{
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            onClick={() => go(1)}
          >
            ›
          </button>
          <h2 className="ml-2 text-base font-semibold" style={{ color: "var(--text)" }}>
            {headerLabel(viewMode, anchor)}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            {(["month", "week", "day"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium capitalize"
                style={{
                  background: viewMode === m ? "var(--accent-dim)" : "transparent",
                  color: viewMode === m ? "var(--accent-bright)" : "var(--text-muted)",
                }}
                onClick={() => {
                  haptic("tap");
                  setViewMode(m);
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
            onClick={() => {
              haptic("tap");
              setShowBookingPolicy(true);
            }}
          >
            Booking link
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      <div
        className={`min-h-0 flex-1 rounded-2xl ${viewMode === "month" ? "overflow-auto" : "overflow-hidden"}`}
        style={{ border: "1px solid var(--border)", background: "var(--bg-panel)" }}
      >
        {pending && !data && (
          <p className="p-4 text-sm" style={{ color: "var(--text-dim)" }}>
            Loading…
          </p>
        )}

        {viewMode === "month" && (
          <MonthGrid
            anchor={anchor}
            start={start}
            end={end}
            eventsByDay={eventsByDay}
            onDayClick={(d) => {
              setAnchor(d);
              setViewMode("day");
            }}
            onEventClick={setSelected}
            onCreateAt={openCreateAt}
          />
        )}

        {(viewMode === "week" || viewMode === "day") && (
          <TimeGrid
            days={visibleDays}
            eventsByDay={eventsByDay}
            onEventClick={setSelected}
            onCreateAt={(day, time) => openCreateAt(day, time)}
          />
        )}
      </div>

      <EventDetailCard
        event={selected}
        accountId={accountId}
        onClose={() => setSelected(null)}
        onMutated={() => setRefreshTick((t) => t + 1)}
      />

      <BookingPolicyPanel
        open={showBookingPolicy}
        onClose={() => setShowBookingPolicy(false)}
        accountId={accountId}
      />

      <ScheduleMeetingPanel
        open={Boolean(creatingAt)}
        onClose={() => setCreatingAt(null)}
        accountId={accountId}
        defaultTitle=""
        defaultAttendees={EMPTY_ATTENDEES}
        initialDate={creatingAt?.date}
        initialTime={creatingAt?.time}
        description="Scheduled from BluRidge Calendar"
        onScheduled={() => setRefreshTick((t) => t + 1)}
      />
      </div>
    </div>
  );
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function MonthGrid({
  anchor,
  start,
  end,
  eventsByDay,
  onDayClick,
  onEventClick,
  onCreateAt,
}: {
  anchor: Date;
  start: Date;
  end: Date;
  eventsByDay: Map<string, CalendarEventSummary[]>;
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalendarEventSummary) => void;
  onCreateAt: (d: Date) => void;
}) {
  const days = useMemo(() => eachDayOfInterval({ start, end }), [start, end]);
  return (
    <div className="grid grid-cols-7">
      {WEEKDAY_HEADERS.map((d) => (
        <div
          key={d}
          className="px-2 py-1.5 text-center text-[0.65rem] font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}
        >
          {d}
        </div>
      ))}
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDay.get(key) ?? [];
        const inMonth = isSameMonth(day, anchor);
        const visible = dayEvents.slice(0, 3);
        const overflow = dayEvents.length - visible.length;
        return (
          <button
            key={key}
            type="button"
            className="group relative flex min-h-[92px] cursor-pointer flex-col items-stretch gap-1 p-1.5 text-left"
            style={{
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              background: isToday(day) ? "var(--bg-hover)" : "transparent",
              opacity: inMonth ? 1 : 0.4,
            }}
            onClick={() => onDayClick(day)}
          >
            <span
              className="text-xs font-medium"
              style={{ color: isToday(day) ? "var(--accent-bright)" : "var(--text-muted)" }}
            >
              {format(day, "d")}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`New event on ${format(day, "MMMM d")}`}
              className="absolute right-1 top-1 hidden cursor-pointer rounded px-1.5 text-xs leading-5 group-hover:block"
              style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
              onClick={(e) => {
                e.stopPropagation();
                onCreateAt(day);
              }}
            >
              +
            </span>
            <div className="flex flex-col gap-0.5">
              {visible.map((ev) => (
                <span
                  key={ev.eventId}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer truncate rounded px-1 py-0.5 text-[0.65rem]"
                  style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(ev);
                  }}
                >
                  {ev.title}
                </span>
              ))}
              {overflow > 0 && (
                <span className="px-1 text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                  +{overflow} more
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EventDetailCard({
  event,
  accountId,
  onClose,
  onMutated,
}: {
  event: CalendarEventSummary | null;
  accountId?: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState("");

  // Reset local edit state whenever a genuinely different event opens
  // (or the card closes) — never carry stale field values across events.
  useEffect(() => {
    setEditing(false);
    setError("");
    if (event) {
      const start = new Date(event.start);
      const end = new Date(event.end);
      setTitle(event.title);
      setDate(toDateInputValue(start));
      setTime(toTimeInputValue(start));
      setDuration(Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000)));
    }
  }, [event]);

  function startEdit() {
    haptic("tap");
    setEditing(true);
  }

  function saveEdit() {
    if (!event) return;
    setError("");
    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) {
      setError("Pick a valid date and time");
      return;
    }
    const end = new Date(start.getTime() + duration * 60 * 1000);

    startTransition(async () => {
      try {
        await updateMeetingAction({
          eventId: event.eventId,
          patch: {
            title: title.trim() || event.title,
            startIso: start.toISOString(),
            endIso: end.toISOString(),
          },
          confirmed: true,
          accountId,
        });
        haptic("success");
        onMutated();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update meeting");
        haptic("warn");
      }
    });
  }

  function cancelMeeting() {
    if (!event) return;
    const n = event.attendeeEmails.length;
    if (
      !window.confirm(
        `Cancel "${event.title}"? ${n > 0 ? `This sends a cancellation email to ${n} attendee${n === 1 ? "" : "s"}.` : "This cannot be undone."}`,
      )
    ) {
      haptic("warn");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await cancelMeetingAction({ eventId: event.eventId, confirmed: true, accountId });
        haptic("success");
        onMutated();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not cancel meeting");
        haptic("warn");
      }
    });
  }

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close event details"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 w-full max-w-md rounded-2xl p-5"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
          >
            {!editing ? (
              <>
                <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  {event.title}
                </h3>
                <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
                  {format(new Date(event.start), "EEEE, MMMM d · h:mm a")} –{" "}
                  {format(new Date(event.end), "h:mm a")}
                </p>
                {event.attendeeEmails.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {event.attendeeEmails.map((a) => (
                      <span
                        key={a}
                        className="rounded-md px-2 py-0.5 text-xs"
                        style={{ background: "var(--bg-hover)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                {error && (
                  <p className="mt-3 text-xs" style={{ color: "#f87171" }}>
                    {error}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {event.meetLink && (
                    <a
                      href={event.meetLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg px-3 py-1.5 text-xs font-medium"
                      style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                    >
                      Join Meet
                    </a>
                  )}
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  >
                    Open in Google Calendar
                  </a>
                  <button
                    type="button"
                    disabled={pending}
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                    onClick={startEdit}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
                    onClick={cancelMeeting}
                  >
                    {pending ? "Cancelling…" : "Cancel meeting"}
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" }}
                    onClick={onClose}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Edit meeting
                </h3>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Title
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
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
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Time
                      <input
                        type="time"
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Duration
                    <select
                      className="mt-1 w-full cursor-pointer rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
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
                </div>

                {error && (
                  <p className="mt-3 text-xs" style={{ color: "#f87171" }}>
                    {error}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || !title.trim()}
                    className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                      color: "#fff",
                      border: "1px solid rgba(129,140,248,0.45)",
                    }}
                    onClick={saveEdit}
                  >
                    {pending ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="cursor-pointer rounded-lg px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" }}
                    onClick={() => setEditing(false)}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
