import { describe, expect, it } from "vitest";
import { generateCandidateSlots, formatSlotForDisplay } from "@/lib/calendar/propose-times";

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
