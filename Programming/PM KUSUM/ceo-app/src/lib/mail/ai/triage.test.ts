import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseTriageJson } from "@/lib/mail/ai/triage";

describe("AI-01/02 triage schema", () => {
  it("accepts valid priority and labels", () => {
    const t = parseTriageJson({
      priority: "P1",
      labels: ["NEEDS_REPLY"],
      reason: "client",
    });
    expect(t.priority).toBe("P1");
    expect(t.labels).toContain("NEEDS_REPLY");
  });

  it("rejects garbage JSON shape", () => {
    expect(() =>
      parseTriageJson({ priority: "URGENT", labels: "x" }),
    ).toThrow();
  });
});

describe("AI-22 spam/phishing schema fields", () => {
  it("accepts isSpam and spamReason", () => {
    const t = parseTriageJson({
      priority: "P4",
      labels: [],
      isSpam: true,
      spamReason: "Phishing link impersonating a bank login page",
    });
    expect(t.isSpam).toBe(true);
    expect(t.spamReason).toContain("Phishing");
  });

  it("isSpam and spamReason are optional, defaulting to undefined", () => {
    const t = parseTriageJson({ priority: "P3", labels: [] });
    expect(t.isSpam).toBeUndefined();
    expect(t.spamReason).toBeUndefined();
  });

  it("rejects a non-boolean isSpam", () => {
    expect(() =>
      parseTriageJson({ priority: "P4", labels: [], isSpam: "yes" }),
    ).toThrow();
  });
});

/**
 * The guardrail computation and its downstream move call aren't exercised
 * here — that would require mocking the full Claude call + prisma chain,
 * which this codebase doesn't do for triageThread (see the plain
 * priority/label auto-apply path, also untested at this level). Instead
 * this pins the defense-in-depth logic down at the source level, mirroring
 * mail.confirm.test.ts's approach for the same class of untestable
 * server-only code path.
 */
describe("AI-22 spam defense-in-depth guardrail", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/mail/ai/triage.ts"),
    "utf8",
  );

  it("never trusts the model's isSpam call alone — known clients and PM_KUSUM mail always override it back to false", () => {
    expect(src).toContain(
      'const isSpam = Boolean(parsed.data.isSpam) && !clientHit && !refined.includes("PM_KUSUM");',
    );
  });

  it("treats spam-move as reversible (checkAutonomy(\"move\")), not gated behind confirmation", () => {
    expect(src).toContain('if (isSpam && checkAutonomy("move").allowed)');
  });
});
