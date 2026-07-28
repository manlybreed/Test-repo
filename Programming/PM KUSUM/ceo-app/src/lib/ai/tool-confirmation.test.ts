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
});
