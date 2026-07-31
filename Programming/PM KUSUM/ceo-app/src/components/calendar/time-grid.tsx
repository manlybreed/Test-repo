"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isToday } from "date-fns";
import type { CalendarEventSummary } from "@/lib/calendar/google";
import { layoutDayEvents, minutesSinceMidnight } from "./event-layout";

const HOUR_PX = 56;
const GUTTER_PX = 52;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Where the grid auto-scrolls to on mount/date-change — matches
 * Google Calendar's default landing position instead of opening at
 * midnight. */
const DEFAULT_SCROLL_HOUR = 8;

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

function roundToStep(minutes: number, step = 30): number {
  return Math.round(minutes / step) * step;
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 30, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Real hour-by-hour calendar grid shared by Week (days.length === 7) and
 * Day (days.length === 1) view — a single scrollable timeline with hour
 * gridlines, a live current-time line, and events positioned by their
 * actual start/duration (via layoutDayEvents for overlap handling)
 * instead of a flat stacked list. Clicking empty grid space opens the
 * create-meeting panel pre-filled with the exact date/time clicked;
 * clicking an event opens its existing detail card.
 */
export function TimeGrid({
  days,
  eventsByDay,
  onEventClick,
  onCreateAt,
}: {
  days: Date[];
  eventsByDay: Map<string, CalendarEventSummary[]>;
  onEventClick: (ev: CalendarEventSummary) => void;
  onCreateAt: (date: Date, time: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayKey = days.map((d) => format(d, "yyyy-MM-dd")).join(",");
  useEffect(() => {
    // Keyed on dayKey (not `days`) so this re-scrolls only when the
    // actual visible dates change — never on the `now` ticker or an
    // events refetch that produced a new array for the same dates.
    scrollRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HOUR_PX - 24 });
  }, [dayKey]);

  const columns = useMemo(
    () =>
      days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = eventsByDay.get(key) ?? [];
        return {
          day,
          key,
          allDay: dayEvents.filter((e) => e.isAllDay),
          laidOut: layoutDayEvents(dayEvents),
        };
      }),
    [days, eventsByDay],
  );
  const hasAnyAllDay = columns.some((c) => c.allDay.length > 0);

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rounded = roundToStep((offsetY / HOUR_PX) * 60);
    onCreateAt(day, minutesToHHMM(rounded));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {days.length > 1 && (
        <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ width: GUTTER_PX }} className="shrink-0" />
          {columns.map(({ day, key }) => (
            <div key={key} className="flex-1 py-1.5 text-center">
              <div
                className="text-[0.65rem] uppercase tracking-wide"
                style={{ color: "var(--text-dim)" }}
              >
                {format(day, "EEE")}
              </div>
              <div
                className="text-sm font-semibold"
                style={{ color: isToday(day) ? "var(--accent-bright)" : "var(--text)" }}
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasAnyAllDay && (
        <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div
            className="shrink-0 pr-1.5 pt-1.5 text-right text-[0.6rem]"
            style={{ width: GUTTER_PX, color: "var(--text-dim)" }}
          >
            All day
          </div>
          {columns.map(({ key, allDay }) => (
            <div key={key} className="flex flex-1 flex-wrap gap-1 p-1">
              {allDay.map((ev) => (
                <button
                  key={ev.eventId}
                  type="button"
                  className="cursor-pointer truncate rounded px-1.5 py-0.5 text-[0.65rem]"
                  style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                  onClick={() => onEventClick(ev)}
                >
                  {ev.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_PX }}>
          <div style={{ width: GUTTER_PX }} className="relative shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[0.65rem]"
                style={{ top: h * HOUR_PX - 7, color: "var(--text-dim)" }}
              >
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {columns.map(({ day, key, laidOut }) => (
            <div
              key={key}
              className="relative flex-1 cursor-pointer"
              style={{ borderLeft: "1px solid var(--border)" }}
              onClick={(e) => handleColumnClick(day, e)}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0"
                  style={{ top: h * HOUR_PX, borderTop: "1px solid var(--border)" }}
                />
              ))}

              {laidOut.map(({ event, lane, laneCount }) => {
                const top = (minutesSinceMidnight(new Date(event.start)) / 60) * HOUR_PX;
                const durationMins = Math.max(
                  15,
                  (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000,
                );
                const height = Math.max(20, (durationMins / 60) * HOUR_PX);
                return (
                  <button
                    key={event.eventId}
                    type="button"
                    className="absolute cursor-pointer overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[0.65rem]"
                    style={{
                      top,
                      height,
                      left: `${(lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                      background: "var(--accent-dim)",
                      color: "var(--accent-bright)",
                      border: "1px solid transparent",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                  >
                    <div className="truncate font-medium">{event.title}</div>
                    {height > 32 && (
                      <div className="truncate" style={{ color: "var(--text-dim)" }}>
                        {format(new Date(event.start), "h:mm a")}
                      </div>
                    )}
                  </button>
                );
              })}

              {isToday(day) && (
                <div
                  className="pointer-events-none absolute inset-x-0"
                  style={{ top: (minutesSinceMidnight(now) / 60) * HOUR_PX }}
                >
                  <div
                    className="absolute -left-1 -top-1 h-2 w-2 rounded-full"
                    style={{ background: "#f87171" }}
                  />
                  <div className="absolute inset-x-0" style={{ borderTop: "1.5px solid #f87171" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
