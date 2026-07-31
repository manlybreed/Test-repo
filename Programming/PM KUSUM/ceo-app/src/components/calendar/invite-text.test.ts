import { describe, expect, it } from "vitest";
import { formatInviteText } from "./invite-text";
import type { CalendarEventSummary } from "@/lib/calendar/google";

function ev(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    eventId: "evt_1",
    title: "Loan review call",
    // Local-time strings (no Z) so the formatted output is stable
    // regardless of the machine's timezone.
    start: "2026-08-05T14:00:00.000",
    end: "2026-08-05T15:00:00.000",
    htmlLink: "https://www.google.com/calendar/event?eid=abc",
    meetLink: "https://meet.google.com/abc-defg-hij",
    attendeeEmails: ["yogesh@sbi.co.in", "priya@example.com"],
    isAllDay: false,
    recurringEventId: null,
    ...overrides,
  };
}

describe("formatInviteText", () => {
  it("leads with the title, then a blank line, then the When block", () => {
    const lines = formatInviteText(ev()).split("\n");
    expect(lines[0]).toBe("Loan review call");
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^When: Wednesday, August 5, 2026 · 2:00 PM – 3:00 PM/);
  });

  it("names the timezone so a pasted time is never ambiguous to the recipient", () => {
    const when = formatInviteText(ev()).split("\n")[2];
    // The exact zone name depends on the machine running the test; what
    // matters is that a parenthesised zone is present at all.
    expect(when).toMatch(/\(.+\)$/);
  });

  it("includes guests and the Meet link", () => {
    const text = formatInviteText(ev());
    expect(text).toContain("Guests: yogesh@sbi.co.in, priya@example.com");
    expect(text).toContain("Google Meet: https://meet.google.com/abc-defg-hij");
  });

  it("omits the Guests line entirely when there are no attendees", () => {
    const text = formatInviteText(ev({ attendeeEmails: [] }));
    expect(text).not.toContain("Guests:");
  });

  it("omits the Meet line entirely when the event has no conferencing", () => {
    const text = formatInviteText(ev({ meetLink: null }));
    expect(text).not.toContain("Google Meet:");
  });

  it("appends the calendar link last, after a blank separator line", () => {
    const lines = formatInviteText(ev()).split("\n");
    expect(lines[lines.length - 2]).toBe("");
    expect(lines[lines.length - 1]).toBe(
      "Add to your calendar: https://www.google.com/calendar/event?eid=abc",
    );
  });

  it("omits the calendar link when the event has none", () => {
    const text = formatInviteText(ev({ htmlLink: "" }));
    expect(text).not.toContain("Add to your calendar:");
    expect(text.endsWith("\n")).toBe(false);
  });

  it("renders an all-day event as a date with no time range or timezone", () => {
    const when = formatInviteText(ev({ isAllDay: true })).split("\n")[2];
    expect(when).toBe("When: Wednesday, August 5, 2026 (all day)");
  });
});
