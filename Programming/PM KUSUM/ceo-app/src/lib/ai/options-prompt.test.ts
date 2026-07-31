import { describe, expect, it } from "vitest";
import { buildOptionsPrompt } from "./options-prompt";

describe("buildOptionsPrompt", () => {
  it("returns null when there was no calendar tool call", () => {
    expect(buildOptionsPrompt(null)).toBeNull();
  });

  it("builds a 'Pick a time' prompt from check_calendar_availability's slots", () => {
    const result = buildOptionsPrompt({
      name: "check_calendar_availability",
      result: JSON.stringify({
        connected: true,
        slots: [
          { startIso: "2026-08-03T04:30:00.000Z", endIso: "2026-08-03T05:00:00.000Z", label: "Mon, Aug 3 · 10:00 AM IST" },
          { startIso: "2026-08-03T05:00:00.000Z", endIso: "2026-08-03T05:30:00.000Z", label: "Mon, Aug 3 · 10:30 AM IST" },
        ],
      }),
    });
    expect(result).toEqual({
      label: "Pick a time",
      options: [
        { value: "Mon, Aug 3 · 10:00 AM IST", label: "Mon, Aug 3 · 10:00 AM IST" },
        { value: "Mon, Aug 3 · 10:30 AM IST", label: "Mon, Aug 3 · 10:30 AM IST" },
      ],
    });
  });

  it("returns null when check_calendar_availability found no slots", () => {
    const result = buildOptionsPrompt({
      name: "check_calendar_availability",
      result: JSON.stringify({ connected: true, slots: [] }),
    });
    expect(result).toBeNull();
  });

  it("caps check_calendar_availability options at 8", () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({
      startIso: `2026-08-0${(i % 9) + 1}T04:00:00.000Z`,
      endIso: `2026-08-0${(i % 9) + 1}T04:30:00.000Z`,
      label: `Slot ${i}`,
    }));
    const result = buildOptionsPrompt({
      name: "check_calendar_availability",
      result: JSON.stringify({ connected: true, slots }),
    });
    expect(result?.options).toHaveLength(8);
  });

  it("builds a 'Pick an event' prompt from list_calendar_events' events", () => {
    const result = buildOptionsPrompt({
      name: "list_calendar_events",
      result: JSON.stringify({
        connected: true,
        events: [
          { eventId: "evt_1", title: "Loan review call", when: "Tue, Aug 4 · 2:00 PM IST", attendeeEmails: [], attendeeCount: 0, meetLink: null, htmlLink: "" },
        ],
      }),
    });
    expect(result).toEqual({
      label: "Pick an event",
      options: [
        {
          value: "Loan review call (Tue, Aug 4 · 2:00 PM IST)",
          label: "Loan review call — Tue, Aug 4 · 2:00 PM IST",
        },
      ],
    });
  });

  it("returns null when list_calendar_events found no events", () => {
    const result = buildOptionsPrompt({
      name: "list_calendar_events",
      result: JSON.stringify({ connected: true, events: [] }),
    });
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON rather than throwing", () => {
    const result = buildOptionsPrompt({
      name: "check_calendar_availability",
      result: "not json",
    });
    expect(result).toBeNull();
  });
});
