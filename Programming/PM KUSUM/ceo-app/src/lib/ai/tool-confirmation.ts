/**
 * Pure logic for the irreversible-tool confirmation gate — deliberately
 * has zero imports from action files (those pull in NextAuth, which needs
 * the Next.js server runtime and breaks under plain vitest). Kept as its
 * own leaf module so it stays unit-testable in isolation; tools.ts
 * re-exports it so existing imports don't need to change.
 */

/**
 * Tools whose effect is irreversible enough that a model's own tool call
 * must never execute them directly — the tool-loop pauses and returns a
 * `pendingConfirmation` instead, and the action only actually runs via
 * POST /api/ai/confirm-tool, which is only reachable from a real button
 * click (see ConfirmationCard). This is the fix for the gap where a
 * model's self-reported `confirmed:true` was the only gate on anything
 * irreversible — a real human click is the gate now, not the model.
 */
export const CONFIRMATION_REQUIRED_TOOLS = new Set<string>([
  "schedule_meeting",
  "update_calendar_event",
  "cancel_calendar_event",
  "update_booking_policy",
  "trash_mail_thread",
  "bulk_trash_mail_threads",
  "send_mail",
]);

/** Human-readable summary of a pending irreversible tool call, shown on
 * the confirmation card so the CEO can see exactly what they're approving
 * without reading raw JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function describePendingAction(toolName: string, input: any): string {
  switch (toolName) {
    case "schedule_meeting": {
      const attendees = Array.isArray(input?.attendeeEmails)
        ? input.attendeeEmails.join(", ")
        : "";
      const when = formatIsoRangeForDisplay(input?.startIso, input?.endIso);
      return `Schedule "${input?.title || "Untitled meeting"}"${when ? ` — ${when}` : ""}${
        attendees ? ` with ${attendees}` : ""
      }? This creates a real Calendar event and sends real invites.`;
    }
    case "trash_mail_thread":
      return "Move this mail thread to Trash? This cannot be undone from here.";
    case "bulk_trash_mail_threads": {
      const n = Array.isArray(input?.threadIds) ? input.threadIds.length : 0;
      return `Move ${n} mail thread${n === 1 ? "" : "s"} to Trash? This cannot be undone from here.`;
    }
    case "send_mail": {
      const to = Array.isArray(input?.to) ? input.to.join(", ") : "";
      return `Send "${input?.subject || "(no subject)"}" to ${to || "the recipient above"}? This sends a real email immediately.`;
    }
    case "update_calendar_event": {
      const when = formatIsoRangeForDisplay(input?.newStartIso, input?.newEndIso);
      return `Reschedule "${input?.title || "this meeting"}"${when ? ` to ${when}` : ""}? This sends an updated invite to attendees.`;
    }
    case "cancel_calendar_event": {
      const n = typeof input?.attendeeCount === "number" ? input.attendeeCount : 0;
      return `Cancel "${input?.title || "this meeting"}"? ${
        n > 0
          ? `This sends a cancellation email to ${n} attendee${n === 1 ? "" : "s"}.`
          : "This cannot be undone."
      }`;
    }
    case "update_booking_policy": {
      const bits: string[] = [];
      const windowSummary = summarizeWeeklyWindows(input?.weeklyWindows);
      if (windowSummary) bits.push(`available ${windowSummary}`);
      if (Array.isArray(input?.durationOptions) && input.durationOptions.length) {
        bits.push(`${input.durationOptions.join("/")}-min meetings only`);
      }
      if (input?.enabled === false && !bits.length) {
        return "Turn OFF public booking? Your booking link will stop accepting new bookings.";
      }
      if (typeof input?.bufferBeforeMins === "number" || typeof input?.bufferAfterMins === "number") {
        const bufferBits: string[] = [];
        if (typeof input.bufferBeforeMins === "number") {
          bufferBits.push(`${input.bufferBeforeMins}-min buffer before`);
        }
        if (typeof input.bufferAfterMins === "number") {
          bufferBits.push(`${input.bufferAfterMins}-min buffer after`);
        }
        bits.push(bufferBits.join(" and "));
      }
      if (typeof input?.minNoticeHours === "number") {
        bits.push(`${input.minNoticeHours}h minimum notice`);
      }
      if (typeof input?.maxAdvanceDays === "number") {
        bits.push(`bookable up to ${input.maxAdvanceDays} days ahead`);
      }
      const detail = bits.length ? ` — ${bits.join(", ")}` : "";
      const verb = input?.enabled === true ? "Turn on public booking" : "Update your public booking policy";
      return `${verb}${detail}? Anyone with your booking link could then book those hours.`;
    }
    default:
      return `Run ${toolName}? This action cannot be undone.`;
  }
}

function formatIsoRangeForDisplay(
  startIso?: string,
  endIso?: string,
): string | null {
  if (!startIso) return null;
  try {
    const start = new Date(startIso);
    const startLabel = start.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    if (!endIso) return `${startLabel} IST`;
    const end = new Date(endIso);
    const endLabel = end.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${startLabel}–${endLabel} IST`;
  } catch {
    return null;
  }
}

const DAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** Renders an `update_booking_policy` weeklyWindows patch as a short
 * human phrase for the confirmation card — e.g. "Mon, Tue, Wed, Thu,
 * Fri 10:00–16:00 IST" when every listed day shares one window, or a
 * per-day breakdown otherwise. Returns null when no windows were sent
 * (the patch isn't touching the schedule). */
function summarizeWeeklyWindows(
  ww: Record<string, { start: string; end: string }[]> | undefined,
): string | null {
  const entries = Object.entries(ww || {}).filter(([, windows]) => windows?.length);
  if (!entries.length) return null;

  const allSingleWindow = entries.every(([, windows]) => windows.length === 1);
  const windowKey = (w: { start: string; end: string }) => `${w.start}-${w.end}`;
  const uniform =
    allSingleWindow && new Set(entries.map(([, windows]) => windowKey(windows[0]))).size === 1;
  const days = entries.map(([day]) => DAY_LABELS[day] || day).join(", ");

  if (uniform) {
    const [{ start, end }] = entries[0][1];
    return `${days} ${start}–${end} IST`;
  }
  return (
    entries
      .map(([day, windows]) => `${DAY_LABELS[day] || day} ${windows.map(windowKey).join("/")}`)
      .join(", ") + " IST"
  );
}
