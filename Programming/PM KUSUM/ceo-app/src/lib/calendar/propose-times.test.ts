import { describe, expect, it } from "vitest";
import {
  generateCandidateSlots,
  formatSlotForDisplay,
  parseWeeklyWindowsJson,
} from "@/lib/calendar/propose-times";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
function istDayOf(iso: string): number {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).getUTCDay();
}
function istHourOf(iso: string): number {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).getUTCHours();
}

describe("generateCandidateSlots (pure)", () => {
  it("only returns weekday slots inside 9am-6pm IST work hours", () => {
    const slots = generateCandidateSlots([], {
      timeMinIso: "2026-08-01T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const day = istDayOf(s.startIso);
      const hour = istHourOf(s.startIso);
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(18);
    }
  });

  it("excludes a slot that overlaps a busy block, but keeps others", () => {
    const [first] = generateCandidateSlots([], {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 1,
    });
    expect(first).toBeTruthy();

    const busy = [{ start: first!.startIso, end: first!.endIso }];
    const after = generateCandidateSlots(busy, {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
    });
    expect(after.some((s) => s.startIso === first!.startIso)).toBe(false);
    expect(after.length).toBeGreaterThan(0);
  });

  it("returns nothing when the whole range is one continuous busy block", () => {
    const slots = generateCandidateSlots(
      [{ start: "2026-08-03T00:00:00.000Z", end: "2026-08-10T00:00:00.000Z" }],
      {
        timeMinIso: "2026-08-03T00:00:00.000Z",
        timeMaxIso: "2026-08-10T00:00:00.000Z",
        durationMins: 30,
        maxCandidates: 10,
      },
    );
    expect(slots).toHaveLength(0);
  });

  it("respects maxCandidates as a hard cap", () => {
    const slots = generateCandidateSlots([], {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 3,
    });
    expect(slots.length).toBeLessThanOrEqual(3);
  });

  it("only offers slots with enough free room for the requested duration", () => {
    // A 90-minute busy block starting exactly at 9:00 IST should push the
    // first available 60-minute slot to 10:30 IST, not 9:30 (which would
    // still overlap the last 30 minutes of the busy block otherwise).
    const nineAmIst = "2026-08-03T03:30:00.000Z"; // 9:00 IST
    const busyEnd = new Date(new Date(nineAmIst).getTime() + 90 * 60 * 1000).toISOString();
    const slots = generateCandidateSlots([{ start: nineAmIst, end: busyEnd }], {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-03T23:59:59.000Z",
      durationMins: 60,
      maxCandidates: 5,
    });
    expect(slots[0]!.startIso >= busyEnd).toBe(true);
  });
});

describe("formatSlotForDisplay (pure)", () => {
  it("formats a morning slot", () => {
    // 2026-08-03T04:30:00.000Z + 5:30 = 10:00 IST
    const label = formatSlotForDisplay({
      startIso: "2026-08-03T04:30:00.000Z",
      endIso: "2026-08-03T05:00:00.000Z",
    });
    expect(label).toContain("10:00 AM IST");
  });

  it("formats an afternoon slot with correct 12-hour conversion", () => {
    // 2026-08-03T09:30:00.000Z + 5:30 = 15:00 IST = 3:00 PM
    const label = formatSlotForDisplay({
      startIso: "2026-08-03T09:30:00.000Z",
      endIso: "2026-08-03T10:00:00.000Z",
    });
    expect(label).toContain("3:00 PM IST");
  });
});

describe("generateCandidateSlots — weeklyWindows / buffers (pure)", () => {
  it("is byte-identical to today when the new params are explicitly absent (backward-compat guard)", () => {
    const withDefaults = generateCandidateSlots([], {
      timeMinIso: "2026-08-01T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
    });
    const withExplicitAbsence = generateCandidateSlots([], {
      timeMinIso: "2026-08-01T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
      weeklyWindows: undefined,
      bufferBeforeMins: 0,
      bufferAfterMins: 0,
    });
    expect(withExplicitAbsence).toEqual(withDefaults);
  });

  it("allows a weekend window when weeklyWindows explicitly opens one (2026-08-02 is a Sunday)", () => {
    const slots = generateCandidateSlots([], {
      timeMinIso: "2026-08-01T00:00:00.000Z",
      timeMaxIso: "2026-08-10T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
      weeklyWindows: { 0: [{ startMin: 600, endMin: 720 }] }, // Sun 10:00-12:00 IST
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(istDayOf(s.startIso)).toBe(0);
      const hour = istHourOf(s.startIso);
      expect(hour).toBeGreaterThanOrEqual(10);
      expect(hour).toBeLessThan(12);
    }
  });

  it("supports different open hours on different weekdays (2026-08-03 Mon, -04 Tue)", () => {
    const slots = generateCandidateSlots([], {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-06T00:00:00.000Z",
      durationMins: 30,
      maxCandidates: 50,
      weeklyWindows: {
        1: [{ startMin: 540, endMin: 600 }], // Mon 9:00-10:00 IST
        2: [{ startMin: 840, endMin: 900 }], // Tue 14:00-15:00 IST
        // Wednesday deliberately has no window at all
      },
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const day = istDayOf(s.startIso);
      const hour = istHourOf(s.startIso);
      if (day === 1) {
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(10);
      } else if (day === 2) {
        expect(hour).toBeGreaterThanOrEqual(14);
        expect(hour).toBeLessThan(15);
      } else {
        throw new Error(`unexpected day ${day} — only Mon/Tue have a configured window`);
      }
    }
  });

  it("bufferBeforeMins excludes a slot that would start right as a PRECEDING busy block ends (gap needed before the new meeting)", () => {
    const busyStartIst = "2026-08-03T04:30:00.000Z"; // 10:00 IST
    const busyEndIst = "2026-08-03T05:00:00.000Z"; // 10:30 IST
    const busy = [{ start: busyStartIst, end: busyEndIst }];

    const withoutBuffer = generateCandidateSlots(busy, {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-03T23:59:59.000Z",
      durationMins: 30,
      maxCandidates: 50,
    });
    expect(withoutBuffer.some((s) => s.startIso === busyEndIst)).toBe(true);

    const withBuffer = generateCandidateSlots(busy, {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-03T23:59:59.000Z",
      durationMins: 30,
      maxCandidates: 50,
      bufferBeforeMins: 15,
    });
    expect(withBuffer.some((s) => s.startIso === busyEndIst)).toBe(false);
  });

  it("bufferAfterMins excludes a slot that would end right as a FOLLOWING busy block starts (gap needed after the new meeting)", () => {
    const busyStartIst = "2026-08-03T04:30:00.000Z"; // 10:00 IST
    const busyEndIst = "2026-08-03T05:00:00.000Z"; // 10:30 IST
    const busy = [{ start: busyStartIst, end: busyEndIst }];
    const slotStart = "2026-08-03T04:00:00.000Z"; // 9:30 IST, ends exactly at busy start

    const withoutBuffer = generateCandidateSlots(busy, {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-03T23:59:59.000Z",
      durationMins: 30,
      maxCandidates: 50,
    });
    expect(withoutBuffer.some((s) => s.startIso === slotStart)).toBe(true);

    const withBuffer = generateCandidateSlots(busy, {
      timeMinIso: "2026-08-03T00:00:00.000Z",
      timeMaxIso: "2026-08-03T23:59:59.000Z",
      durationMins: 30,
      maxCandidates: 50,
      bufferAfterMins: 15,
    });
    expect(withBuffer.some((s) => s.startIso === slotStart)).toBe(false);
  });
});

describe("parseWeeklyWindowsJson (pure)", () => {
  it("converts day-name keys to numeric-day keys matching Date#getDay()", () => {
    const parsed = parseWeeklyWindowsJson(
      JSON.stringify({
        mon: [{ startMin: 540, endMin: 1020 }],
        sun: [{ startMin: 600, endMin: 720 }],
      }),
    );
    expect(parsed[1]).toEqual([{ startMin: 540, endMin: 1020 }]);
    expect(parsed[0]).toEqual([{ startMin: 600, endMin: 720 }]);
    expect(parsed[2]).toBeUndefined();
  });

  it("returns {} for malformed or empty JSON rather than throwing", () => {
    expect(parseWeeklyWindowsJson("not json")).toEqual({});
    expect(parseWeeklyWindowsJson("")).toEqual({});
  });

  it("drops an unrecognized day name instead of guessing what it means", () => {
    const parsed = parseWeeklyWindowsJson(
      JSON.stringify({
        funday: [{ startMin: 0, endMin: 60 }],
        tue: [{ startMin: 60, endMin: 120 }],
      }),
    );
    expect(parsed[2]).toEqual([{ startMin: 60, endMin: 120 }]);
    expect(Object.keys(parsed)).toHaveLength(1);
  });
});
