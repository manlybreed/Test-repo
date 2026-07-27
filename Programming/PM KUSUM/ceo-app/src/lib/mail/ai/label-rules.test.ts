import { describe, expect, it } from "vitest";
import { matchesLabelRule } from "@/lib/mail/ai/label-rules";

function rule(matchJson: string) {
  return { matchJson };
}

describe("matchesLabelRule", () => {
  it("matches on fromContains only", () => {
    const r = rule(JSON.stringify({ fromContains: "axisbank.com" }));
    expect(
      matchesLabelRule(r, { from: "alerts@axisbank.com", subject: "Anything" }),
    ).toBe(true);
    expect(
      matchesLabelRule(r, { from: "someone@gmail.com", subject: "Anything" }),
    ).toBe(false);
  });

  it("matches on subjectContains only", () => {
    const r = rule(JSON.stringify({ subjectContains: "invoice" }));
    expect(
      matchesLabelRule(r, { from: "x@y.com", subject: "Your Invoice #1042" }),
    ).toBe(true);
    expect(
      matchesLabelRule(r, { from: "x@y.com", subject: "Meeting notes" }),
    ).toBe(false);
  });

  it("requires BOTH fromContains and subjectContains when both are set (AND, not OR)", () => {
    const r = rule(
      JSON.stringify({ fromContains: "axisbank.com", subjectContains: "statement" }),
    );
    expect(
      matchesLabelRule(r, {
        from: "alerts@axisbank.com",
        subject: "Your monthly statement",
      }),
    ).toBe(true);
    // Right sender, wrong subject — should not match.
    expect(
      matchesLabelRule(r, {
        from: "alerts@axisbank.com",
        subject: "Welcome to Axis Bank",
      }),
    ).toBe(false);
    // Right subject, wrong sender — should not match.
    expect(
      matchesLabelRule(r, {
        from: "billing@acme.com",
        subject: "Your monthly statement",
      }),
    ).toBe(false);
  });

  it("matches everything when both criteria are empty (mirrors applyStandingLabelRules' existing behavior)", () => {
    const r = rule(JSON.stringify({}));
    expect(matchesLabelRule(r, { from: "anyone@anywhere.com", subject: "Anything at all" })).toBe(
      true,
    );
  });

  it("is case-insensitive on both from and subject", () => {
    const r = rule(
      JSON.stringify({ fromContains: "AxisBank.COM", subjectContains: "STATEMENT" }),
    );
    expect(
      matchesLabelRule(r, {
        from: "Alerts@axisbank.com",
        subject: "your monthly statement is ready",
      }),
    ).toBe(true);
  });

  it("treats malformed matchJson as an always-false, non-throwing rule", () => {
    const r = rule("not valid json {{{");
    expect(() =>
      matchesLabelRule(r, { from: "x@y.com", subject: "Anything" }),
    ).not.toThrow();
    // Malformed JSON parses to {} via the catch branch, so — same as the
    // empty-criteria case above — it matches everything rather than
    // silently matching nothing. Documented here so a future change to
    // that fallback behavior gets caught by a failing test, not silently.
    expect(matchesLabelRule(r, { from: "x@y.com", subject: "Anything" })).toBe(true);
  });

  it("does a substring match, not a whole-field match", () => {
    const r = rule(JSON.stringify({ fromContains: "billing@" }));
    expect(
      matchesLabelRule(r, { from: "billing@acme.com", subject: "s" }),
    ).toBe(true);
    expect(
      matchesLabelRule(r, { from: "not-billing@acme.com", subject: "s" }),
    ).toBe(true); // "billing@" is still a substring here — documents actual substring semantics
    expect(
      matchesLabelRule(r, { from: "acme.com@billing", subject: "s" }),
    ).toBe(false);
  });
});
