import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBookingPolicyFindUnique = vi.fn();
const mockAttemptUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookingPolicy: {
      findUnique: (...args: unknown[]) => mockBookingPolicyFindUnique(...args),
    },
    publicBookingAttempt: {
      upsert: (...args: unknown[]) => mockAttemptUpsert(...args),
    },
  },
}));

const mockCreateMeetingEvent = vi.fn();
vi.mock("@/lib/calendar/google", () => ({
  createMeetingEvent: (...args: unknown[]) => mockCreateMeetingEvent(...args),
}));

const mockGetPublicBookingSlots = vi.fn();
vi.mock("@/lib/calendar/propose-times", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/propose-times")>();
  return {
    ...actual,
    getPublicBookingSlots: (...args: unknown[]) => mockGetPublicBookingSlots(...args),
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7"]]),
}));

const { createPublicBookingAction, getPublicBookingSlotsAction } = await import("./public-booking");
const { parseDurationOptions } = await import("@/lib/calendar/propose-times");

const BASE_POLICY = {
  accountId: "acct_1",
  enabled: true,
  slug: "akshay-consult",
  title: "30-Min Chat with Akshay",
  description: "Quick intro call.",
  weeklyWindowsJson: '{"mon":[{"startMin":600,"endMin":960}]}',
  durationOptionsJson: "[30,60]",
  bufferBeforeMins: 0,
  bufferAfterMins: 0,
  minNoticeHours: 24,
  maxAdvanceDays: 30,
};

const SLOT = {
  startIso: "2026-08-03T10:00:00.000Z",
  endIso: "2026-08-03T10:30:00.000Z",
  label: "Mon, Aug 3 · 3:30 PM IST",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAttemptUpsert.mockResolvedValue({ count: 1 });
});

describe("parseDurationOptions (pure)", () => {
  it("parses a valid JSON array", () => {
    expect(parseDurationOptions("[15,30,60]")).toEqual([15, 30, 60]);
  });

  it("falls back to [30] on malformed JSON", () => {
    expect(parseDurationOptions("not json")).toEqual([30]);
  });

  it("falls back to [30] on an empty array", () => {
    expect(parseDurationOptions("[]")).toEqual([30]);
  });
});

describe("getPublicBookingSlotsAction", () => {
  it("returns {found:false} for a slug that doesn't exist", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(null);
    const result = await getPublicBookingSlotsAction("no-such-slug");
    expect(result).toEqual({ found: false });
  });

  it("returns the identical {found:false} for a real but disabled policy", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue({ ...BASE_POLICY, enabled: false });
    const result = await getPublicBookingSlotsAction("akshay-consult");
    expect(result).toEqual({ found: false });
  });

  it("returns policy details + slots for an enabled policy", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    mockGetPublicBookingSlots.mockResolvedValue([SLOT]);
    const result = await getPublicBookingSlotsAction("akshay-consult");
    expect(result).toEqual({
      found: true,
      title: BASE_POLICY.title,
      description: BASE_POLICY.description,
      durationOptions: [30, 60],
      slots: [SLOT],
    });
    expect(mockGetPublicBookingSlots).toHaveBeenCalledWith(
      "acct_1",
      BASE_POLICY,
      expect.objectContaining({ durationMins: 30 }),
    );
  });
});

describe("createPublicBookingAction", () => {
  const validInput = {
    slug: "akshay-consult",
    startIso: SLOT.startIso,
    endIso: SLOT.endIso,
    visitorName: "Priya Shah",
    visitorEmail: "priya@example.com",
  };

  it("rejects a nonexistent slug with the same message as a disabled one", async () => {
    mockBookingPolicyFindUnique.mockResolvedValueOnce(null);
    const notFound = await createPublicBookingAction(validInput);
    mockBookingPolicyFindUnique.mockResolvedValueOnce({ ...BASE_POLICY, enabled: false });
    const disabled = await createPublicBookingAction(validInput);
    expect(notFound).toEqual({ ok: false, reason: "This booking link isn't available." });
    expect(disabled).toEqual(notFound);
  });

  it("rejects an invalid email before touching the database further", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    const result = await createPublicBookingAction({ ...validInput, visitorEmail: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(mockAttemptUpsert).not.toHaveBeenCalled();
  });

  it("rejects a duration that isn't offered by this policy, without checking rate limits or slots", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    const result = await createPublicBookingAction({
      ...validInput,
      endIso: "2026-08-03T10:45:00.000Z", // 45 min — policy only offers 30/60
    });
    expect(result).toEqual({ ok: false, reason: "That meeting length isn't offered on this link." });
    expect(mockAttemptUpsert).not.toHaveBeenCalled();
    expect(mockGetPublicBookingSlots).not.toHaveBeenCalled();
  });

  it("rejects once this IP exceeds the daily attempt cap", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    mockAttemptUpsert.mockResolvedValue({ count: 21 });
    const result = await createPublicBookingAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many/i);
    expect(mockGetPublicBookingSlots).not.toHaveBeenCalled();
  });

  it("rejects a slot that no longer appears in a fresh re-derivation (race condition / already booked)", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    mockGetPublicBookingSlots.mockResolvedValue([]); // someone else just took it
    const result = await createPublicBookingAction(validInput);
    expect(result).toEqual({ ok: false, reason: "That slot was just taken — please pick another time." });
    expect(mockCreateMeetingEvent).not.toHaveBeenCalled();
  });

  it("rejects a slot that is no longer open because it's in the past (same re-derivation path)", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    // A slot the visitor "chose" from a stale page load that has since
    // fallen outside minNoticeHours won't be present in a fresh call.
    mockGetPublicBookingSlots.mockResolvedValue([
      { startIso: "2099-01-01T10:00:00.000Z", endIso: "2099-01-01T10:30:00.000Z", label: "future" },
    ]);
    const result = await createPublicBookingAction(validInput);
    expect(result).toEqual({ ok: false, reason: "That slot was just taken — please pick another time." });
  });

  it("books the meeting when the slot is genuinely still open", async () => {
    mockBookingPolicyFindUnique.mockResolvedValue(BASE_POLICY);
    mockGetPublicBookingSlots.mockResolvedValue([SLOT]);
    mockCreateMeetingEvent.mockResolvedValue({
      eventId: "evt_1",
      htmlLink: "https://calendar.google.com/event?eid=evt_1",
      meetLink: "https://meet.google.com/abc-defg-hij",
      start: SLOT.startIso,
      end: SLOT.endIso,
    });

    const result = await createPublicBookingAction(validInput);

    expect(result).toEqual({
      ok: true,
      htmlLink: "https://calendar.google.com/event?eid=evt_1",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(mockCreateMeetingEvent).toHaveBeenCalledWith(
      "acct_1",
      expect.objectContaining({
        title: BASE_POLICY.title,
        startIso: SLOT.startIso,
        endIso: SLOT.endIso,
        attendeeEmails: ["priya@example.com"],
      }),
    );
  });
});
