import { format } from "date-fns";
import type { CalendarEventSummary } from "@/lib/calendar/google";

/**
 * Human-readable timezone name for the viewer's own browser locale —
 * e.g. "India Standard Time". An invite is copied to send to someone
 * else, so an unqualified "10:00 AM" is genuinely ambiguous; every
 * mainstream calendar app names the zone for exactly this reason.
 * Falls back to the short form ("GMT+5:30"), then to nothing, rather
 * than throwing on an engine with a thin Intl build.
 */
function timeZoneLabel(d: Date, style: "long" | "short" = "long"): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: style,
    }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return style === "long" ? timeZoneLabel(d, "short") : "";
  }
}

/**
 * Pastable plain-text invite for an existing calendar event, in the
 * shape people already recognise from Google Calendar / Zoom invites:
 * title, a fully-qualified When line, guests, and the join link.
 * Lines with nothing to say (no guests, no Meet link) are omitted
 * rather than printed empty.
 */
export function formatInviteText(event: CalendarEventSummary): string {
  const start = new Date(event.start);
  const end = new Date(event.end);

  const when = event.isAllDay
    ? `${format(start, "EEEE, MMMM d, yyyy")} (all day)`
    : (() => {
        const zone = timeZoneLabel(start);
        const range = `${format(start, "EEEE, MMMM d, yyyy")} · ${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
        return zone ? `${range} (${zone})` : range;
      })();

  const lines = [
    event.title,
    "",
    `When: ${when}`,
    event.attendeeEmails.length ? `Guests: ${event.attendeeEmails.join(", ")}` : null,
    event.meetLink ? `Google Meet: ${event.meetLink}` : null,
  ].filter((l): l is string => l !== null);

  if (event.htmlLink) {
    lines.push("", `Add to your calendar: ${event.htmlLink}`);
  }

  return lines.join("\n");
}
