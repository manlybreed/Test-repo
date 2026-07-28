import { randomUUID } from "crypto";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/mail/credential-crypto";

/**
 * A mailbox's connection to a real Google account for Calendar/Meet — a
 * separate integration from that mailbox's own IMAP/SMTP mail credentials
 * (see GoogleCalendarConnection in schema.prisma for why). One shared
 * OAuth client id/secret for the whole app; per-mailbox state lives in
 * GoogleCalendarConnection, keyed by accountId.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export function googleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
  );
}

function getRedirectUri(): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/calendar/google/callback`;
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET not set — Google Calendar isn't configured.",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

/** Consent-screen URL. `state` carries the accountId — the callback route
 * re-verifies it belongs to the session's user before trusting it. */
export function getAuthUrl(accountId: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    // Forces a refresh token even on a re-auth of an already-connected
    // account — without this, Google only returns one on first consent.
    prompt: "consent",
    scope: SCOPES,
    state: accountId,
  });
}

export type ExchangedTokens = {
  refreshToken: string;
  accessToken: string | null;
  expiryDate: number | null;
  scope: string;
  googleEmail: string;
};

/** Exchanges an OAuth `code` for tokens and the connected account's email. */
export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token — this can happen on a repeat consent without prompt=consent, or if the account already granted access previously without offline access. Try disconnecting on Google's account permissions page and reconnecting.",
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token || null,
    expiryDate: tokens.expiry_date || null,
    scope: tokens.scope || SCOPES.join(" "),
    googleEmail: data.email || "",
  };
}

/** Encrypts + upserts a mailbox's Google connection. */
export async function saveConnection(
  accountId: string,
  tokens: ExchangedTokens,
): Promise<void> {
  const data = {
    googleEmail: tokens.googleEmail,
    refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : null,
    scope: tokens.scope,
  };
  await prisma.googleCalendarConnection.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
}

/** Authenticated calendar client for a mailbox, or null if not connected.
 * Refreshed access tokens are persisted back opportunistically so future
 * calls can skip a refresh round-trip when the cached token is still
 * valid. */
async function getCalendarClientForAccount(accountId: string) {
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { accountId },
  });
  if (!conn) return null;

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: decryptSecret(conn.refreshTokenEncrypted) });
  client.on("tokens", (fresh) => {
    if (!fresh.access_token) return;
    void prisma.googleCalendarConnection
      .update({
        where: { accountId },
        data: {
          accessToken: fresh.access_token,
          accessTokenExpiresAt: fresh.expiry_date ? new Date(fresh.expiry_date) : null,
        },
      })
      .catch(() => undefined);
  });

  return google.calendar({ version: "v3", auth: client });
}

export type MeetingRequest = {
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
};

/**
 * Pure — the exact request body sent to calendar.events.insert. Extracted
 * from createMeetingEvent so the Meet-link/attendee/conferenceData shape
 * is unit-testable without a network call.
 */
export function buildMeetingEventPayload(req: MeetingRequest) {
  return {
    summary: req.title,
    description: req.description,
    start: { dateTime: req.startIso },
    end: { dateTime: req.endIso },
    attendees: req.attendeeEmails.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
}

export type CreatedMeeting = {
  eventId: string;
  htmlLink: string;
  meetLink: string | null;
  start: string;
  end: string;
};

/** Creates a real Calendar event with a Meet link; Google emails the
 * invites to attendees itself. Returns null if this account has no
 * Google Calendar connection (caller falls back to the ICS path). */
export async function createMeetingEvent(
  accountId: string,
  req: MeetingRequest,
): Promise<CreatedMeeting | null> {
  const calendar = await getCalendarClientForAccount(accountId);
  if (!calendar) return null;

  const { data } = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: buildMeetingEventPayload(req),
  });

  return {
    eventId: data.id || "",
    htmlLink: data.htmlLink || "",
    meetLink: data.hangoutLink || null,
    start: data.start?.dateTime || req.startIso,
    end: data.end?.dateTime || req.endIso,
  };
}

export type BusyBlock = { start: string; end: string };

/** Real busy blocks for a connected mailbox's calendar over a time range —
 * grounding for Phase 2's AI-proposed meeting times. Returns null if this
 * account has no Google Calendar connection. */
export async function getFreeBusy(
  accountId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ busy: BusyBlock[] } | null> {
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { accountId },
  });
  if (!conn) return null;
  const calendar = await getCalendarClientForAccount(accountId);
  if (!calendar) return null;

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: [{ id: conn.googleEmail }],
    },
  });
  const cal = data.calendars?.[conn.googleEmail];
  return {
    busy: (cal?.busy || []).map((b) => ({ start: b.start || "", end: b.end || "" })),
  };
}

/** Best-effort revoke on Google's side, then always drops the local row —
 * a failed remote revoke shouldn't leave a "connected" mailbox the user
 * can no longer see or manage from settings. */
export async function disconnectGoogleCalendar(accountId: string): Promise<void> {
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { accountId },
  });
  if (!conn) return;
  try {
    const client = getOAuthClient();
    await client.revokeToken(decryptSecret(conn.refreshTokenEncrypted));
  } catch {
    // Best-effort — proceed to delete the local row regardless.
  }
  await prisma.googleCalendarConnection.delete({ where: { accountId } });
}
