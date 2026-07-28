import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMeetingEventPayload,
  getAuthUrl,
  googleCalendarConfigured,
} from "@/lib/calendar/google";

const ORIGINAL_ENV = {
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  authUrl: process.env.AUTH_URL,
};

function restoreEnv() {
  for (const [key, envVar] of [
    ["clientId", "GOOGLE_CALENDAR_CLIENT_ID"],
    ["clientSecret", "GOOGLE_CALENDAR_CLIENT_SECRET"],
    ["redirectUri", "GOOGLE_CALENDAR_REDIRECT_URI"],
    ["authUrl", "AUTH_URL"],
  ] as const) {
    const val = ORIGINAL_ENV[key];
    if (val === undefined) delete process.env[envVar];
    else process.env[envVar] = val;
  }
}

describe("google calendar — buildMeetingEventPayload (pure)", () => {
  it("builds the exact conferenceData/attendees shape Calendar API expects", () => {
    const payload = buildMeetingEventPayload({
      title: "Loan review call",
      description: "Discuss PM KUSUM financing",
      startIso: "2026-08-01T10:00:00.000Z",
      endIso: "2026-08-01T10:30:00.000Z",
      attendeeEmails: ["yogesh@sbi.co.in", "akshayroyal678@gmail.com"],
    });

    expect(payload.summary).toBe("Loan review call");
    expect(payload.description).toBe("Discuss PM KUSUM financing");
    expect(payload.start).toEqual({ dateTime: "2026-08-01T10:00:00.000Z" });
    expect(payload.end).toEqual({ dateTime: "2026-08-01T10:30:00.000Z" });
    expect(payload.attendees).toEqual([
      { email: "yogesh@sbi.co.in" },
      { email: "akshayroyal678@gmail.com" },
    ]);
    expect(payload.conferenceData.createRequest.conferenceSolutionKey).toEqual({
      type: "hangoutsMeet",
    });
    expect(payload.conferenceData.createRequest.requestId).toEqual(expect.any(String));
  });

  it("gives every meeting a unique conference requestId (never reuses one)", () => {
    const req = {
      title: "Standup",
      startIso: "2026-08-01T10:00:00.000Z",
      endIso: "2026-08-01T10:15:00.000Z",
      attendeeEmails: [],
    };
    const a = buildMeetingEventPayload(req);
    const b = buildMeetingEventPayload(req);
    expect(a.conferenceData.createRequest.requestId).not.toBe(
      b.conferenceData.createRequest.requestId,
    );
  });

  it("handles zero attendees (internal-only event)", () => {
    const payload = buildMeetingEventPayload({
      title: "Focus block",
      startIso: "2026-08-01T09:00:00.000Z",
      endIso: "2026-08-01T09:30:00.000Z",
      attendeeEmails: [],
    });
    expect(payload.attendees).toEqual([]);
  });
});

describe("google calendar — env/config", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  });

  afterEach(restoreEnv);

  it("googleCalendarConfigured is false with no client id/secret", () => {
    expect(googleCalendarConfigured()).toBe(false);
  });

  it("googleCalendarConfigured is true once both client id and secret are set", () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-secret";
    expect(googleCalendarConfigured()).toBe(true);
  });

  it("getAuthUrl throws a clear error when not configured", () => {
    expect(() => getAuthUrl("acct_123")).toThrow(
      /GOOGLE_CALENDAR_CLIENT_ID.*GOOGLE_CALENDAR_CLIENT_SECRET/,
    );
  });

  it("getAuthUrl carries the accountId as state and requests offline+consent", () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/calendar/google/callback";

    const url = new URL(getAuthUrl("acct_123"));
    expect(url.searchParams.get("state")).toBe("acct_123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar.events",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/calendar/google/callback",
    );
  });
});
