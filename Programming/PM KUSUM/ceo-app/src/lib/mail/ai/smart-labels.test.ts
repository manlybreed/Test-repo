import { describe, expect, it } from "vitest";
import {
  isSmartInboxThread,
  mergeSmartLabels,
  refineSmartLabels,
} from "@/lib/mail/ai/smart-labels";

describe("smart label guardrails", () => {
  it("strips RECEIPT from a short test acknowledgement", () => {
    const out = refineSmartLabels(["RECEIPT", "FYI"], {
      subject: "Re: Test Email – BluRidge Consulting",
      text: "It worked. On Mon, 20 Jul 2026 at 02:20, Akshay...",
    });
    expect(out).toEqual(["FYI"]);
    expect(out).not.toContain("RECEIPT");
  });

  it("keeps RECEIPT when transactional signals exist", () => {
    const out = refineSmartLabels(["RECEIPT"], {
      subject: "Payment receipt — Invoice INV-1042",
      text: "Payment received ₹12,500 via UPI. Transaction ID 12345. Tax invoice attached.",
    });
    expect(out).toContain("RECEIPT");
  });

  it("does not treat money-less 'confirmation' as RECEIPT", () => {
    const out = refineSmartLabels(["RECEIPT"], {
      subject: "Confirmed",
      text: "Thanks, confirmed for Thursday.",
    });
    expect(out).not.toContain("RECEIPT");
    expect(out).toContain("FYI");
  });

  it("forces FYI for explicit test email subjects", () => {
    const out = refineSmartLabels(["NEEDS_REPLY", "RECEIPT"], {
      subject: "Test Email",
      text: "Just checking SMTP.",
    });
    expect(out).toEqual(["FYI"]);
  });

  it("keeps NEWSLETTER when unsubscribe is present", () => {
    const out = refineSmartLabels(["NEWSLETTER"], {
      subject: "Weekly product digest",
      text: "Top stories this week…",
      hasListUnsubscribe: true,
    });
    expect(out).toEqual(["NEWSLETTER"]);
  });

  it("never applies NEEDS_REPLY to promotional mail with a question", () => {
    const out = refineSmartLabels(["NEEDS_REPLY"], {
      subject: "Ready for summer? 40% off ends tonight",
      text: "Shop now — limited time offer. Unsubscribe anytime.",
      hasListUnsubscribe: true,
      fromAddresses: ["noreply@brand.com"],
    });
    expect(out).toEqual(["NEWSLETTER"]);
    expect(out).not.toContain("NEEDS_REPLY");
  });

  it("never applies NEEDS_REPLY to noreply marketing", () => {
    const out = refineSmartLabels(["NEEDS_REPLY", "FYI"], {
      subject: "Your weekly product roundup",
      text: "Here is what is new. Manage preferences below.",
      fromAddresses: ["newsletter@saas.io"],
    });
    expect(out).toEqual(["NEWSLETTER"]);
  });

  it("keeps NEEDS_REPLY for a real human ask", () => {
    const out = refineSmartLabels(["NEEDS_REPLY"], {
      subject: "Proposal review",
      text: "Hi Akshay, can you please review the attached proposal and let me know?",
      fromAddresses: ["client@acme.com"],
    });
    expect(out).toContain("NEEDS_REPLY");
  });

  it("replaces prior smart labels instead of stacking mistakes", () => {
    const merged = mergeSmartLabels(
      ["RECEIPT", "ClientX", "NEEDS_REPLY"],
      ["FYI"],
    );
    expect(merged).toEqual(["ClientX", "FYI"]);
  });

  it("excludes newsletters/receipts/P4 noise from Smart Inbox", () => {
    expect(isSmartInboxThread({ labelsJson: '["FYI"]', priority: "P3" })).toBe(
      true,
    );
    expect(
      isSmartInboxThread({ labelsJson: '["NEEDS_REPLY"]', priority: "P2" }),
    ).toBe(true);
    expect(
      isSmartInboxThread({ labelsJson: '["NEWSLETTER"]', priority: "P4" }),
    ).toBe(false);
    expect(
      isSmartInboxThread({ labelsJson: '["FYI"]', priority: "P4" }),
    ).toBe(false);
    expect(
      isSmartInboxThread({ labelsJson: '["RECEIPT"]', priority: "P3" }),
    ).toBe(false);
  });

  it("labels HackerNoon / Reddit-style digests as NEWSLETTER", () => {
    expect(
      refineSmartLabels(["FYI"], {
        subject: "AI Coding Tip 027 - Force Code Standards",
        text: "Top Tech Content sent at Noon!",
        fromAddresses: ["news@hackernoon.com"],
      }),
    ).toEqual(["NEWSLETTER"]);

    expect(
      refineSmartLabels(["FYI"], {
        subject: "NOIDA SECTOR 104: BEWARE",
        text: "http://click.redditmail.com/...",
        fromAddresses: ["noreply@redditmail.com"],
      }),
    ).toEqual(["NEWSLETTER"]);
  });

  it("labels bank POS / e-statements as BANKING", () => {
    expect(
      refineSmartLabels(["FYI", "RECEIPT"], {
        subject: "DAILY POS E-Statement : BLURIDGE CONSULTING",
        text: "Please find your POS e-statement. Available balance details inside.",
        fromAddresses: ["reportsmailer@hdfcbank.net"],
      }),
    ).toEqual(["BANKING"]);
  });

  it("labels PM KUSUM project mail and can pair with NEEDS_REPLY", () => {
    expect(
      refineSmartLabels(["FYI"], {
        subject: "PM KUSUM Component A — plant file update",
        text: "Sharing the DPR and PPA tariff for the feeder-level solar plant.",
        fromAddresses: ["client@discom.example"],
      }),
    ).toEqual(["PM_KUSUM"]);

    expect(
      refineSmartLabels(["NEEDS_REPLY"], {
        subject: "KUSUM mandate — please review",
        text: "Can you please review the PM KUSUM finance mandate and let me know?",
        fromAddresses: ["partner@bluridge.example"],
      }),
    ).toEqual(["NEEDS_REPLY", "PM_KUSUM"]);
  });
});
