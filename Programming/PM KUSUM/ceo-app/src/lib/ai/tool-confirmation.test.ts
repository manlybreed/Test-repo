import { describe, expect, it } from "vitest";
import { CONFIRMATION_REQUIRED_TOOLS, describePendingAction } from "./tool-confirmation";

describe("CONFIRMATION_REQUIRED_TOOLS", () => {
  it("gates every irreversible mail/calendar tool", () => {
    expect(CONFIRMATION_REQUIRED_TOOLS.has("schedule_meeting")).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS.has("trash_mail_thread")).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS.has("bulk_trash_mail_threads")).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS.has("send_mail")).toBe(true);
  });

  it("does not gate reversible mail-mutation tools", () => {
    for (const name of [
      "archive_mail_thread",
      "move_mail_thread_to_folder",
      "set_mail_priority",
      "mark_mail_important",
      "mark_mail_read",
      "snooze_mail_thread",
    ]) {
      expect(CONFIRMATION_REQUIRED_TOOLS.has(name)).toBe(false);
    }
  });
});

describe("describePendingAction", () => {
  it("describes schedule_meeting with title, IST time range, and attendees", () => {
    const summary = describePendingAction("schedule_meeting", {
      title: "Kickoff call",
      startIso: "2026-08-01T04:30:00.000Z",
      endIso: "2026-08-01T05:00:00.000Z",
      attendeeEmails: ["a@example.com", "b@example.com"],
    });
    expect(summary).toContain("Kickoff call");
    expect(summary).toContain("IST");
    expect(summary).toContain("a@example.com, b@example.com");
    expect(summary).toContain("real Calendar event");
  });

  it("falls back to just a start label when endIso is missing", () => {
    const summary = describePendingAction("schedule_meeting", {
      title: "Quick sync",
      startIso: "2026-08-01T04:30:00.000Z",
      attendeeEmails: [],
    });
    expect(summary).toContain("Quick sync");
    expect(summary).toContain("IST");
  });

  it("describes trash_mail_thread generically (no subject available at this layer)", () => {
    const summary = describePendingAction("trash_mail_thread", { threadId: "abc123" });
    expect(summary).toContain("Trash");
    expect(summary).toContain("cannot be undone");
  });

  it("describes bulk_trash_mail_threads with the correct count and pluralization", () => {
    expect(describePendingAction("bulk_trash_mail_threads", { threadIds: ["a"] })).toContain(
      "1 mail thread ",
    );
    expect(
      describePendingAction("bulk_trash_mail_threads", { threadIds: ["a", "b", "c"] }),
    ).toContain("3 mail threads");
  });

  it("describes send_mail with subject and recipient", () => {
    const summary = describePendingAction("send_mail", {
      to: ["akshayroyal678@gmail.com"],
      subject: "Phase 2 test send",
      bodyHtml: "<p>hi</p>",
    });
    expect(summary).toContain("Phase 2 test send");
    expect(summary).toContain("akshayroyal678@gmail.com");
    expect(summary).toContain("sends a real email immediately");
  });

  it("falls back to a generic warning for an unrecognized tool name", () => {
    const summary = describePendingAction("some_future_tool", {});
    expect(summary).toContain("some_future_tool");
    expect(summary).toContain("cannot be undone");
  });

  it("describes update_calendar_event with title and the new IST time", () => {
    const summary = describePendingAction("update_calendar_event", {
      eventId: "evt_1",
      title: "Loan review call",
      newStartIso: "2026-08-05T05:30:00.000Z",
      newEndIso: "2026-08-05T06:00:00.000Z",
    });
    expect(summary).toContain("Loan review call");
    expect(summary).toContain("IST");
    expect(summary).toContain("updated invite");
  });

  it("describes update_calendar_event without a time when only renaming", () => {
    const summary = describePendingAction("update_calendar_event", {
      eventId: "evt_1",
      title: "Renamed sync",
    });
    expect(summary).toContain("Renamed sync");
    expect(summary).not.toContain("IST");
  });

  it("describes cancel_calendar_event with the attendee count", () => {
    const summary = describePendingAction("cancel_calendar_event", {
      eventId: "evt_1",
      title: "Loan review call",
      attendeeCount: 2,
    });
    expect(summary).toContain("Loan review call");
    expect(summary).toContain("cancellation email to 2 attendees");
  });

  it("falls back to a plain cannot-be-undone message when cancel_calendar_event has no attendees", () => {
    const summary = describePendingAction("cancel_calendar_event", {
      eventId: "evt_1",
      title: "Focus block",
      attendeeCount: 0,
    });
    expect(summary).toContain("Focus block");
    expect(summary).toContain("cannot be undone");
  });

  it("describes update_booking_policy with the day/hour/duration summary when turning it on", () => {
    const summary = describePendingAction("update_booking_policy", {
      enabled: true,
      weeklyWindows: {
        mon: [{ start: "10:00", end: "16:00" }],
        tue: [{ start: "10:00", end: "16:00" }],
      },
      durationOptions: [30],
    });
    expect(summary).toContain("Turn on public booking");
    expect(summary).toContain("Mon, Tue 10:00–16:00 IST");
    expect(summary).toContain("30-min meetings only");
    expect(summary).toContain("Anyone with your booking link");
  });

  it("describes update_booking_policy as a plain OFF toggle when disabling with no other changes", () => {
    const summary = describePendingAction("update_booking_policy", { enabled: false });
    expect(summary).toContain("Turn OFF public booking");
    expect(summary).toContain("stop accepting new bookings");
  });

  it("falls back to a generic update message when update_booking_policy changes only buffers/notice", () => {
    const summary = describePendingAction("update_booking_policy", { minNoticeHours: 48 });
    expect(summary).toContain("Update your public booking policy");
    expect(summary).toContain("Anyone with your booking link");
    expect(summary).toContain("48h minimum notice");
  });

  it("describes a buffer-only update_booking_policy change alongside a duration change", () => {
    const summary = describePendingAction("update_booking_policy", {
      durationOptions: [30, 60],
      bufferAfterMins: 10,
    });
    expect(summary).toContain("30/60-min meetings only");
    expect(summary).toContain("10-min buffer after");
  });
});
