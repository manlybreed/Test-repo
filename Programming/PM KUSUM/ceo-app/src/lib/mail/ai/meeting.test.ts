import { describe, expect, it } from "vitest";
import { buildIcsInvite } from "@/lib/mail/ai/meeting";

describe("AI-17 meeting ICS", () => {
  it("requires confirm and builds valid ICS", () => {
    expect(() =>
      buildIcsInvite({
        title: "Call",
        startIso: "2026-08-01T10:00:00.000Z",
        endIso: "2026-08-01T10:30:00.000Z",
        organizerEmail: "akshay@thebluridge.com",
        attendeeEmails: ["client@example.com"],
        confirmed: false,
      }),
    ).toThrow(/confirmation/);

    const inv = buildIcsInvite({
      title: "Call",
      startIso: "2026-08-01T10:00:00.000Z",
      endIso: "2026-08-01T10:30:00.000Z",
      organizerEmail: "akshay@thebluridge.com",
      attendeeEmails: ["client@example.com"],
      confirmed: true,
    });
    expect(inv.ics).toContain("BEGIN:VEVENT");
    expect(inv.ics).toContain("SUMMARY:Call");
    expect(inv.filename).toBe("invite.ics");
  });
});
