import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("Phase 2 — assistant calendar tools", () => {
  it("registers check_calendar_availability and schedule_meeting in tools.ts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    for (const name of ["check_calendar_availability", "schedule_meeting"]) {
      expect(src).toContain(`name: "${name}"`);
    }
  });

  it("schedule_meeting's schema no longer asks the model to self-report confirmed", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    const start = src.indexOf('name: "schedule_meeting"');
    const block = src.slice(start, start + 1200);
    expect(block).toContain('required: ["title", "startIso", "endIso", "attendeeEmails"]');
  });

  it("gates schedule_meeting behind CONFIRMATION_REQUIRED_TOOLS, not model self-report", async () => {
    const { CONFIRMATION_REQUIRED_TOOLS, describePendingAction } = await import(
      "./tool-confirmation"
    );
    expect(CONFIRMATION_REQUIRED_TOOLS.has("schedule_meeting")).toBe(true);
    const summary = describePendingAction("schedule_meeting", {
      title: "Kickoff call",
      startIso: "2026-08-01T10:00:00.000Z",
      endIso: "2026-08-01T10:30:00.000Z",
      attendeeEmails: ["akshayroyal678@gmail.com"],
    });
    expect(summary).toContain("Kickoff call");
    expect(summary).toContain("akshayroyal678@gmail.com");
  });
});

describe("Phase 5 — full AI control of Calendar", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/ai/tools.ts"), "utf8");

  it("registers every Phase 5 calendar/booking-policy tool", () => {
    for (const name of [
      "list_calendar_events",
      "update_calendar_event",
      "cancel_calendar_event",
      "get_booking_policy",
      "update_booking_policy",
      "get_booking_link",
    ]) {
      expect(src).toContain(`name: "${name}"`);
    }
  });

  it("update_calendar_event and cancel_calendar_event both require eventId + title", () => {
    for (const name of ["update_calendar_event", "cancel_calendar_event"]) {
      const start = src.indexOf(`name: "${name}"`);
      const block = src.slice(start, start + 1200);
      expect(block).toContain('required: ["eventId", "title"]');
    }
  });

  it("gates the three irreversible Phase 5 tools, not the three read-only ones", async () => {
    const { CONFIRMATION_REQUIRED_TOOLS } = await import("./tool-confirmation");
    for (const name of ["update_calendar_event", "cancel_calendar_event", "update_booking_policy"]) {
      expect(CONFIRMATION_REQUIRED_TOOLS.has(name)).toBe(true);
    }
    for (const name of ["list_calendar_events", "get_booking_policy", "get_booking_link"]) {
      expect(CONFIRMATION_REQUIRED_TOOLS.has(name)).toBe(false);
    }
  });
});
