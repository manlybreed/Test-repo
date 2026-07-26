import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_SENDER_PATTERNS,
  buildVacationSieveScript,
  normalizeExcludedSenders,
  validateVacationWindow,
} from "@/lib/mail/vacation";

describe("validateVacationWindow", () => {
  it("rejects an end date before or equal to the start date", () => {
    const start = new Date("2026-08-01");
    expect(() => validateVacationWindow(start, new Date("2026-07-31"))).toThrow();
    expect(() => validateVacationWindow(start, start)).toThrow();
  });

  it("rejects a window longer than MAX_VACATION_DAYS (never indefinite)", () => {
    const start = new Date("2026-01-01");
    const tooLong = new Date("2027-01-01"); // 365 days
    expect(() => validateVacationWindow(start, tooLong)).toThrow(/90 days/);
  });

  it("accepts a normal short window", () => {
    expect(() =>
      validateVacationWindow(new Date("2026-08-01"), new Date("2026-08-15")),
    ).not.toThrow();
  });

  it("rejects invalid dates", () => {
    expect(() =>
      validateVacationWindow(new Date("not a date"), new Date("2026-08-15")),
    ).toThrow();
  });
});

describe("normalizeExcludedSenders", () => {
  it("always includes the default no-reply/mailing-list patterns", () => {
    const result = normalizeExcludedSenders([]);
    for (const p of DEFAULT_EXCLUDED_SENDER_PATTERNS) {
      expect(result).toContain(p);
    }
  });

  it("merges user-supplied patterns with defaults, deduped and lowercased", () => {
    const result = normalizeExcludedSenders(["Newsletter@X.com", "noreply"]);
    expect(result).toContain("newsletter@x.com");
    expect(result.filter((p) => p === "noreply")).toHaveLength(1);
  });
});

describe("buildVacationSieveScript", () => {
  const base = {
    subject: "Out of office",
    message: "I'm away and will reply when I'm back.",
    startDate: new Date("2026-08-01"),
    endDate: new Date("2026-08-15"),
    excludedSenders: ["billing@partner.com"],
    fromAddress: "akshay@thebluridge.com",
  };

  it("includes the require line and date-gated block", () => {
    const script = buildVacationSieveScript(base);
    expect(script).toContain('require ["vacation", "date", "relational"];');
    expect(script).toContain('"date" "2026-08-01"');
    expect(script).toContain('"date" "2026-08-15"');
    expect(script).toContain(":days 1");
  });

  it("includes both default and custom excluded senders as header tests", () => {
    const script = buildVacationSieveScript(base);
    expect(script).toContain('header :contains "from" "noreply"');
    expect(script).toContain('header :contains "from" "billing@partner.com"');
  });

  it("escapes quotes and backslashes in subject/message so the script stays valid", () => {
    const script = buildVacationSieveScript({
      ...base,
      subject: 'Away "on leave"',
      message: 'Back soon \\ thanks',
    });
    expect(script).toContain('Away \\"on leave\\"');
    expect(script).toContain("Back soon \\\\ thanks");
  });

  it("throws (and generates nothing) for an invalid window", () => {
    expect(() =>
      buildVacationSieveScript({ ...base, endDate: new Date("2026-07-01") }),
    ).toThrow();
  });
});
