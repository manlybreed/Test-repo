import { describe, expect, it } from "vitest";
import { layoutDayEvents, minutesSinceMidnight } from "./event-layout";
import type { CalendarEventSummary } from "@/lib/calendar/google";

function ev(id: string, startHM: string, endHM: string, isAllDay = false): CalendarEventSummary {
  return {
    eventId: id,
    title: id,
    start: `2026-08-03T${startHM}:00.000`,
    end: `2026-08-03T${endHM}:00.000`,
    htmlLink: "",
    meetLink: null,
    attendeeEmails: [],
    isAllDay,
    recurringEventId: null,
  };
}

function laneMap(result: ReturnType<typeof layoutDayEvents>) {
  return Object.fromEntries(result.map((r) => [r.event.eventId, { lane: r.lane, laneCount: r.laneCount }]));
}

describe("minutesSinceMidnight", () => {
  it("converts a Date's local time-of-day to minutes", () => {
    const d = new Date(2026, 7, 3, 9, 30);
    expect(minutesSinceMidnight(d)).toBe(9 * 60 + 30);
  });

  it("handles midnight and end-of-day", () => {
    expect(minutesSinceMidnight(new Date(2026, 7, 3, 0, 0))).toBe(0);
    expect(minutesSinceMidnight(new Date(2026, 7, 3, 23, 59))).toBe(23 * 60 + 59);
  });
});

describe("layoutDayEvents", () => {
  it("gives non-overlapping events each their own full-width lane", () => {
    const result = layoutDayEvents([ev("a", "09:00", "09:30"), ev("b", "10:00", "10:30")]);
    expect(laneMap(result)).toEqual({
      a: { lane: 0, laneCount: 1 },
      b: { lane: 0, laneCount: 1 },
    });
  });

  it("splits two overlapping events into side-by-side lanes", () => {
    const result = layoutDayEvents([ev("a", "09:00", "10:00"), ev("b", "09:30", "10:30")]);
    const map = laneMap(result);
    expect(map.a.laneCount).toBe(2);
    expect(map.b.laneCount).toBe(2);
    expect(map.a.lane).not.toBe(map.b.lane);
  });

  it("splits a three-way overlap into three lanes", () => {
    const result = layoutDayEvents([
      ev("a", "09:00", "10:00"),
      ev("b", "09:30", "10:30"),
      ev("c", "09:45", "10:15"),
    ]);
    const map = laneMap(result);
    expect(map.a.laneCount).toBe(3);
    expect(map.b.laneCount).toBe(3);
    expect(map.c.laneCount).toBe(3);
    const lanes = new Set([map.a.lane, map.b.lane, map.c.lane]);
    expect(lanes.size).toBe(3);
  });

  it("treats back-to-back events (one ends exactly as the other starts) as not overlapping", () => {
    const result = layoutDayEvents([ev("a", "09:00", "10:00"), ev("b", "10:00", "11:00")]);
    const map = laneMap(result);
    expect(map.a.lane).toBe(map.b.lane);
    expect(map.a.laneCount).toBe(1);
    expect(map.b.laneCount).toBe(1);
  });

  it("excludes all-day events from the timed layout entirely", () => {
    const result = layoutDayEvents([
      ev("a", "09:00", "09:30"),
      ev("allday", "00:00", "23:59", true),
    ]);
    expect(result.map((r) => r.event.eventId)).toEqual(["a"]);
  });

  it("returns an empty array for no events", () => {
    expect(layoutDayEvents([])).toEqual([]);
  });
});
