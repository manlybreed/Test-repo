"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { haptic } from "@/components/mail/haptics";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Compact month grid for the calendar sidebar — day numbers only, no
 * events. Selecting a date moves the main view's anchor without
 * changing Month/Week/Day mode (clicking a date in Week view just
 * shows that date's week), matching Google Calendar's own
 * mini-calendar behavior.
 */
export function MiniCalendar({
  anchor,
  onSelect,
}: {
  anchor: Date;
  onSelect: (d: Date) => void;
}) {
  // Browsing the mini-calendar's months is local to this component —
  // paging to December to peek doesn't move the main grid until a date
  // is actually clicked.
  const [month, setMonth] = useState(() => startOfMonth(anchor));

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="cursor-pointer rounded px-1.5 py-0.5 text-xs"
          style={{ color: "var(--text-muted)" }}
          onClick={() => {
            haptic("tap");
            setMonth((m) => subMonths(m, 1));
          }}
        >
          ‹
        </button>
        <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
          {format(month, "MMMM yyyy")}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className="cursor-pointer rounded px-1.5 py-0.5 text-xs"
          style={{ color: "var(--text-muted)" }}
          onClick={() => {
            haptic("tap");
            setMonth((m) => addMonths(m, 1));
          }}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAY_INITIALS.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="text-center text-[0.6rem]"
            style={{ color: "var(--text-dim)" }}
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const selected = isSameDay(day, anchor);
          const today = isToday(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              className="cursor-pointer rounded-md py-1 text-center text-[0.7rem]"
              style={{
                background: selected ? "var(--accent-dim)" : "transparent",
                color: selected
                  ? "var(--accent-bright)"
                  : today
                    ? "var(--accent-bright)"
                    : "var(--text-muted)",
                fontWeight: selected || today ? 600 : 400,
                opacity: isSameMonth(day, month) ? 1 : 0.35,
              }}
              onClick={() => {
                haptic("tap");
                onSelect(day);
              }}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
