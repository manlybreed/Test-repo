import type { CalendarEventSummary } from "@/lib/calendar/google";

/** Plain browser-local time-of-day in minutes — matches this file's
 * neighbors (`eventTimeLabel` etc. in calendar-view.tsx), which already
 * render every time via bare `date-fns` calls with no `timeZone`
 * option. Unlike `propose-times.ts`'s server-side IST-exact math, this
 * is client-side UI positioning in the CEO's own browser, so the
 * browser's local clock is the right source of truth here. */
export function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export type LaidOutEvent = {
  event: CalendarEventSummary;
  lane: number;
  laneCount: number;
};

/**
 * Interval-graph "lane assignment" for a single day's timed events, so
 * TimeGrid can render overlapping events as equal-width side-by-side
 * columns instead of stacking them on top of each other. All-day events
 * are excluded — TimeGrid renders those in a separate fixed row above
 * the scrollable grid, not positioned by time-of-day.
 *
 * Two events that merely touch (one ends exactly when the other starts)
 * are NOT considered overlapping — they share a lane, matching how a
 * real calendar back-to-back schedule reads.
 */
export function layoutDayEvents(events: CalendarEventSummary[]): LaidOutEvent[] {
  const timed = events.filter((e) => !e.isAllDay);
  const sorted = [...timed].sort((a, b) => {
    const byStart = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (byStart !== 0) return byStart;
    return new Date(a.end).getTime() - new Date(b.end).getTime();
  });

  // Greedily assign each event to the first lane whose most recent
  // occupant has already ended by this event's start — the standard
  // "minimum number of meeting rooms" lane-assignment approach.
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const ev of sorted) {
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.end).getTime();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneOf.set(ev.eventId, lane);
  }

  // laneCount for each event is however many distinct lanes are active
  // at any point during its own [start, end) window — so a run of
  // events that all overlap each other render at equal width, while an
  // event with nothing else concurrent gets the full column.
  return sorted.map((ev) => {
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.end).getTime();
    const lane = laneOf.get(ev.eventId) ?? 0;
    const lanesInWindow = new Set<number>();
    for (const other of sorted) {
      const otherStart = new Date(other.start).getTime();
      const otherEnd = new Date(other.end).getTime();
      if (otherStart < end && otherEnd > start) {
        lanesInWindow.add(laneOf.get(other.eventId) ?? 0);
      }
    }
    return { event: ev, lane, laneCount: Math.max(lanesInWindow.size, lane + 1) };
  });
}
