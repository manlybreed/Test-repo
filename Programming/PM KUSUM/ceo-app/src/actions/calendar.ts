"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { ensureCeoMailAccount, requireOwnedAccount } from "@/lib/mail/account";
import { buildIcsInvite } from "@/lib/mail/ai/meeting";
import {
  createMeetingEvent,
  disconnectGoogleCalendar,
  googleCalendarConfigured,
} from "@/lib/calendar/google";
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
