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
  listCalendarEventsAction,
  type CalendarEventListResult,
} from "@/actions/calendar";
import type { CalendarEventSummary } from "@/lib/calendar/google";

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

function eventTimeLabel(ev: CalendarEventSummary): string {
  if (ev.isAllDay) return "All day";
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  return `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
}

export function CalendarView({ accountId }: { accountId?: string }) {
  const [pending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<CalendarEventListResult | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarEventSummary | null>(null);

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
  }, [startIso, endIso, accountId]);

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

  function go(dir: -1 | 1) {
    haptic("tap");
    setAnchor((a) => shiftAnchor(viewMode, a, dir));
  }

  function goToday() {
    haptic("tap");
    setAnchor(new Date());
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
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
      </div>

      {error && (
        <p className="text-xs" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto rounded-2xl"
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
          />
        )}

        {viewMode === "week" && (
          <WeekColumns
            start={start}
            eventsByDay={eventsByDay}
            onEventClick={setSelected}
          />
        )}

        {viewMode === "day" && (
          <DayList
            anchor={anchor}
            eventsByDay={eventsByDay}
            onEventClick={setSelected}
          />
        )}
      </div>

      <EventDetailCard event={selected} onClose={() => setSelected(null)} />
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
}: {
  anchor: Date;
  start: Date;
  end: Date;
  eventsByDay: Map<string, CalendarEventSummary[]>;
  onDayClick: (d: Date) => void;
  onEventClick: (ev: CalendarEventSummary) => void;
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
            className="flex min-h-[92px] cursor-pointer flex-col items-stretch gap-1 p-1.5 text-left"
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

function WeekColumns({
  start,
  eventsByDay,
  onEventClick,
}: {
  start: Date;
  eventsByDay: Map<string, CalendarEventSummary[]>;
  onEventClick: (ev: CalendarEventSummary) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    [start],
  );
  return (
    <div className="grid grid-cols-7 divide-x" style={{ borderColor: "var(--border)" }}>
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = (eventsByDay.get(key) ?? []).slice().sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
        );
        return (
          <div key={key} className="flex min-h-[240px] flex-col gap-1.5 p-2">
            <div className="mb-1 text-center">
              <div className="text-[0.65rem] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
                {format(day, "EEE")}
              </div>
              <div
                className="text-sm font-semibold"
                style={{ color: isToday(day) ? "var(--accent-bright)" : "var(--text)" }}
              >
                {format(day, "d")}
              </div>
            </div>
            {dayEvents.map((ev) => (
              <button
                key={ev.eventId}
                type="button"
                className="cursor-pointer rounded-lg px-2 py-1.5 text-left text-[0.7rem]"
                style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                onClick={() => onEventClick(ev)}
              >
                <div className="truncate font-medium">{ev.title}</div>
                <div style={{ color: "var(--text-dim)" }}>{eventTimeLabel(ev)}</div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DayList({
  anchor,
  eventsByDay,
  onEventClick,
}: {
  anchor: Date;
  eventsByDay: Map<string, CalendarEventSummary[]>;
  onEventClick: (ev: CalendarEventSummary) => void;
}) {
  const key = format(anchor, "yyyy-MM-dd");
  const dayEvents = (eventsByDay.get(key) ?? []).slice().sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  if (!dayEvents.length) {
    return (
      <p className="p-6 text-sm" style={{ color: "var(--text-dim)" }}>
        Nothing scheduled.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {dayEvents.map((ev) => (
        <button
          key={ev.eventId}
          type="button"
          className="flex cursor-pointer items-start justify-between gap-3 rounded-xl px-3.5 py-3 text-left"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onClick={() => onEventClick(ev)}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
              {ev.title}
            </div>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              {eventTimeLabel(ev)}
            </div>
          </div>
          {ev.meetLink && (
            <span
              className="shrink-0 rounded-md px-2 py-0.5 text-[0.65rem] font-semibold"
              style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
            >
              Meet
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function EventDetailCard({
  event,
  onClose,
}: {
  event: CalendarEventSummary | null;
  onClose: () => void;
}) {
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
                className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" }}
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
