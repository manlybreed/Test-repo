"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { ensureCeoMailAccount, requireOwnedAccount } from "@/lib/mail/account";
import { buildIcsInvite } from "@/lib/mail/ai/meeting";
import { assertAutonomy } from "@/lib/mail/ai/policy";
import {
  createMeetingEvent,
  disconnectGoogleCalendar,
  googleCalendarConfigured,
  listEvents,
  type CalendarEventSummary,
} from "@/lib/calendar/google";
import { getCandidateMeetingSlots, type MeetingSlotOption } from "@/lib/calendar/propose-times";
import { prisma } from "@/lib/prisma";

async function requireAccount(accountId?: string) {
  await requireCeo();
  const session = await auth();
  const userId = session?.user?.id as string;
  if (accountId) {
    const account = await requireOwnedAccount(accountId, userId);
    return { account, userId };
  }
  const account = await ensureCeoMailAccount(userId);
  if (!account) throw new Error("Configure CEO_MAIL_USER and CEO_MAIL_PASS");
  return { account, userId };
}

function revalidateMail() {
  revalidatePath("/ceo/mail");
}

export async function getCalendarConnectionStatusAction(
  accountId?: string,
): Promise<{ connected: boolean; googleEmail: string | null; configured: boolean }> {
  const { account } = await requireAccount(accountId);
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { accountId: account.id },
    select: { googleEmail: true },
  });
  return {
    connected: Boolean(conn),
    googleEmail: conn?.googleEmail ?? null,
    configured: googleCalendarConfigured(),
  };
}

/**
 * Real, ready-to-use candidate meeting slots for the assistant's
 * check_calendar_availability tool — deliberately returns pre-computed
 * {startIso, endIso, label} options (via getCandidateMeetingSlots), NOT
 * raw busy blocks. A first version returned raw busy/free data and left
 * the model to work out open slots itself; live testing caught it
 * inventing a plausible-looking slot with the wrong year (silently
 * scheduling a real meeting in the past) — exactly the hallucination
 * class this function now closes off by construction: the model has
 * nothing left to compute, only exact ISO strings to reuse verbatim in
 * schedule_meeting.
 */
export async function getCalendarAvailabilityAction(
  withinDays = 7,
  accountId?: string,
): Promise<{ connected: boolean; timeMin: string; timeMax: string; slots: MeetingSlotOption[] }> {
  const { account } = await requireAccount(accountId);
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { accountId: account.id },
    select: { accountId: true },
  });
  const slots = conn
    ? await getCandidateMeetingSlots(account.id, { withinDays, maxCandidates: 5 })
    : [];

  return {
    connected: Boolean(conn),
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    slots,
  };
}

export type CalendarEventListResult = {
  connected: boolean;
  events: CalendarEventSummary[];
};

/**
 * Real events for the Calendar view page (/ceo/calendar) over a visible
 * date range — the actual data source for the month/week/day grid, as
 * opposed to getCalendarAvailabilityAction's free/busy-only candidate
 * slots. Returns connected:false (not an error) when this mailbox has no
 * Google Calendar connection, so the page can render a "Connect" empty
 * state instead of a broken grid.
 */
export async function listCalendarEventsAction(
  timeMinIso: string,
  timeMaxIso: string,
  accountId?: string,
): Promise<CalendarEventListResult> {
  const { account } = await requireAccount(accountId);
  const events = await listEvents(account.id, timeMinIso, timeMaxIso);
  return { connected: events !== null, events: events ?? [] };
}

export async function disconnectGoogleCalendarAction(
  accountId?: string,
): Promise<{ ok: true }> {
  const { account } = await requireAccount(accountId);
  await disconnectGoogleCalendar(account.id);
  revalidateMail();
  return { ok: true };
}

export type MeetingResult =
  | {
      via: "google";
      eventId: string;
      htmlLink: string;
      meetLink: string | null;
      start: string;
      end: string;
    }
  | { via: "ics"; ics: string; filename: string; uid: string };

/**
 * Creates a real Google Calendar event + Meet link when this mailbox has
 * one connected; otherwise falls back to the pre-existing ICS-download
 * path (buildIcsInvite) so an unconnected mailbox loses nothing it had
 * before this feature existed.
 */
export async function createMeetingAction(input: {
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  confirmed: boolean;
  accountId?: string;
}): Promise<MeetingResult> {
  // Creating a real Calendar event with real invites is exactly as
  // irreversible as the ICS path already treats it — this gate used to
  // only run inside buildIcsInvite below, so a connected mailbox's real
  // Google path had no confirmation check at all. Matters now that
  // schedule_meeting is a callable AI tool, not just a UI form submit.
  assertAutonomy("calendar_invite", { confirmed: input.confirmed });

  // Defense in depth against a caller (AI tool call or otherwise)
  // constructing a wrong startIso — caught live: the assistant once
  // computed a real-looking slot a full year in the past. Grounding the
  // slot options themselves in real code (getCandidateMeetingSlots) is
  // the real fix; this is a cheap backstop against any other path
  // producing a bad date, not a substitute for that.
  if (new Date(input.startIso).getTime() < Date.now()) {
    throw new Error(
      `Refusing to schedule a meeting in the past (startIso ${input.startIso}) — check the date.`,
    );
  }

  const { account } = await requireAccount(input.accountId);

  const created = await createMeetingEvent(account.id, {
    title: input.title,
    description: input.description,
    startIso: input.startIso,
    endIso: input.endIso,
    attendeeEmails: input.attendeeEmails,
  });
  if (created) {
    return { via: "google", ...created };
  }

  const ics = buildIcsInvite({
    title: input.title,
    description: input.description,
    startIso: input.startIso,
    endIso: input.endIso,
    organizerEmail: account.address,
    attendeeEmails: input.attendeeEmails,
    confirmed: input.confirmed,
  });
  return { via: "ics", ...ics };
}
