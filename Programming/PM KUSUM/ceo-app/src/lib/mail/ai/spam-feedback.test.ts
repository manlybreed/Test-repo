import { describe, expect, it } from "vitest";
import {
  domainOf,
  EMPTY_SPAM_FEEDBACK,
  hasSpamFeedbackSignal,
  primaryExternalSender,
  resolveSpamFeedbackTier,
  SHARED_DOMAIN_DENYLIST,
  SPAM_FASTPATH_THRESHOLD,
  type SpamFeedbackCounts,
} from "@/lib/mail/ai/spam-feedback";

function counts(overrides: Partial<SpamFeedbackCounts>): SpamFeedbackCounts {
  return { ...EMPTY_SPAM_FEEDBACK, ...overrides };
}

describe("AI-22 resolveSpamFeedbackTier", () => {
  it("is 'none' with no signal at all", () => {
    expect(resolveSpamFeedbackTier(EMPTY_SPAM_FEEDBACK)).toBe("none");
  });

  it("reaches 'hard_spam' once manual address reports cross the threshold", () => {
    expect(
      resolveSpamFeedbackTier(counts({ addressManualSpamCount: SPAM_FASTPATH_THRESHOLD })),
    ).toBe("hard_spam");
  });

  it("combines manual + auto address counts toward the fast-path threshold", () => {
    expect(
      resolveSpamFeedbackTier(
        counts({ addressManualSpamCount: 1, addressAutoSpamCount: 1 }),
      ),
    ).toBe("hard_spam");
  });

  it("never reaches 'hard_spam' from domain-scope counts alone, however large", () => {
    expect(
      resolveSpamFeedbackTier(counts({ domainManualSpamCount: 50, domainAutoSpamCount: 50 })),
    ).toBe("none");
  });

  it("a single manual not-spam correction always beats any number of auto-spam classifications", () => {
    expect(
      resolveSpamFeedbackTier(
        counts({ addressAutoSpamCount: 100, addressNotSpamCount: 1 }),
      ),
    ).toBe("never_spam");
  });

  it("not-spam only ties (not beats) an equal count of *manual* spam reports", () => {
    expect(
      resolveSpamFeedbackTier(
        counts({ addressManualSpamCount: 2, addressNotSpamCount: 2 }),
      ),
    ).toBe("never_spam");
    expect(
      resolveSpamFeedbackTier(
        counts({ addressManualSpamCount: 3, addressNotSpamCount: 2 }),
      ),
    ).not.toBe("never_spam");
  });

  it("never_spam takes priority over hard_spam when both conditions are met", () => {
    expect(
      resolveSpamFeedbackTier(
        counts({ addressManualSpamCount: 5, addressNotSpamCount: 5 }),
      ),
    ).toBe("never_spam");
  });

  it("a not-spam correction on the sender blocks that sender's own fast-path, per resolveSpamFeedbackTier's address-only fast-path guard", () => {
    expect(
      resolveSpamFeedbackTier(
        counts({ addressManualSpamCount: 5, addressNotSpamCount: 1 }),
      ),
    ).not.toBe("hard_spam");
  });
});

describe("AI-22 domainOf / SHARED_DOMAIN_DENYLIST", () => {
  it("extracts a lowercased domain from an address", () => {
    expect(domainOf("Someone@Example.COM")).toBe("example.com");
  });

  it("returns null for an address with no @", () => {
    expect(domainOf("not-an-address")).toBeNull();
  });

  it("denylists common free-mail providers", () => {
    for (const d of ["gmail.com", "outlook.com", "yahoo.com", "icloud.com"]) {
      expect(SHARED_DOMAIN_DENYLIST.has(d)).toBe(true);
    }
    expect(SHARED_DOMAIN_DENYLIST.has("thebluridge.com")).toBe(false);
  });
});

describe("AI-22 primaryExternalSender", () => {
  it("picks the first address that isn't the account's own", () => {
    expect(
      primaryExternalSender(
        ["akshay@thebluridge.com", "spammer@example.com"],
        "akshay@thebluridge.com",
      ),
    ).toBe("spammer@example.com");
  });

  it("is case-insensitive when comparing to the account's own address", () => {
    expect(
      primaryExternalSender(["Akshay@TheBluRidge.com"], "akshay@thebluridge.com"),
    ).toBeNull();
  });

  it("returns null when every message is from the account itself", () => {
    expect(
      primaryExternalSender(["akshay@thebluridge.com"], "akshay@thebluridge.com"),
    ).toBeNull();
  });
});

describe("AI-22 hasSpamFeedbackSignal", () => {
  it("is false for all-zero counts", () => {
    expect(hasSpamFeedbackSignal(EMPTY_SPAM_FEEDBACK)).toBe(false);
  });

  it("is true when any single counter is non-zero", () => {
    expect(hasSpamFeedbackSignal(counts({ domainNotSpamCount: 1 }))).toBe(true);
  });
});
