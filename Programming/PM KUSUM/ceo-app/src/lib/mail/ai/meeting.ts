import { assertAutonomy } from "@/lib/mail/ai/policy";

/** AI-17: build ICS draft (never auto-sends). */
export function buildIcsInvite(opts: {
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  organizerEmail: string;
  attendeeEmails: string[];
  confirmed: boolean;
}) {
  assertAutonomy("calendar_invite", { confirmed: opts.confirmed });

  const uid = `${Date.now()}@thebluridge.com`;
  const dt = (iso: string) =>
    iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("Z", "Z");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BluRidge CEO Mail//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(opts.startIso)}`,
    `DTEND:${dt(opts.endIso)}`,
    `SUMMARY:${escapeIcs(opts.title)}`,
    opts.description ? `DESCRIPTION:${escapeIcs(opts.description)}` : "",
    `ORGANIZER:mailto:${opts.organizerEmail}`,
    ...opts.attendeeEmails.map(
      (e) => `ATTENDEE;RSVP=TRUE:mailto:${e}`,
    ),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return {
    ics: lines.join("\r\n"),
    filename: "invite.ics",
    uid,
  };
}

function escapeIcs(s: string) {
  return s.replace(/[\\;,\n]/g, (c) => {
    if (c === "\n") return "\\n";
    return `\\${c}`;
  });
}
