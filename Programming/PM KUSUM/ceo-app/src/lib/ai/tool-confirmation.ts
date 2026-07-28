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
