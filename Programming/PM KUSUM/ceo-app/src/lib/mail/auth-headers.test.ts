import { describe, expect, it } from "vitest";
import { normalizeHeaderValue, summarizeAuthResults } from "@/lib/mail/auth-headers";

describe("AI-22 normalizeHeaderValue", () => {
  it("passes a plain string through unchanged", () => {
    expect(normalizeHeaderValue("spf=pass")).toBe("spf=pass");
  });

  it("returns null for null/undefined", () => {
    expect(normalizeHeaderValue(null)).toBeNull();
    expect(normalizeHeaderValue(undefined)).toBeNull();
  });

  it("takes the first string entry from an array — mailparser keeps a header repeated across relay hops as string[], topmost = most recent hop", () => {
    expect(normalizeHeaderValue(["spf=pass (hop1)", "spf=fail (hop2)"])).toBe(
      "spf=pass (hop1)",
    );
  });

  it("returns null for an array with no string entries", () => {
    expect(normalizeHeaderValue([42, {}] as unknown[])).toBeNull();
  });

  it("returns null for an unexpected type (never throws)", () => {
    expect(normalizeHeaderValue(42)).toBeNull();
    expect(normalizeHeaderValue({})).toBeNull();
  });
});

describe("AI-22 summarizeAuthResults", () => {
  it("extracts spf/dkim/dmarc from a real-shaped Authentication-Results header", () => {
    const header =
      "mx.google.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com";
    expect(summarizeAuthResults(header, null)).toBe(
      "spf=pass dkim=pass dmarc=pass",
    );
  });

  it("surfaces a failing result the same way — this is the phishing-supportive case", () => {
    const header = "mx.thebluridge.com; spf=fail smtp.mailfrom=laurelsgroup.biz; dkim=none; dmarc=fail";
    expect(summarizeAuthResults(header, null)).toBe(
      "spf=fail dkim=none dmarc=fail",
    );
  });

  it("omits a mechanism that isn't present rather than guessing", () => {
    expect(summarizeAuthResults("mx.example.com; dkim=pass", null)).toBe(
      "dkim=pass",
    );
  });

  it("returns null when there's no signal at all", () => {
    expect(summarizeAuthResults(null, null)).toBeNull();
  });

  it("returns null for an Authentication-Results header with no recognizable mechanism", () => {
    expect(summarizeAuthResults("mx.example.com; something=unrelated", null)).toBeNull();
  });

  it("falls back to Received-SPF only when Authentication-Results didn't already supply spf", () => {
    expect(summarizeAuthResults(null, "pass (google.com: domain of x@y.com designates 1.2.3.4)")).toBe(
      "spf=pass",
    );
  });

  it("prefers Authentication-Results' spf over Received-SPF when both are present", () => {
    expect(summarizeAuthResults("mx.example.com; spf=fail", "pass (irrelevant)")).toBe(
      "spf=fail",
    );
  });

  it("ignores an unparseable Received-SPF fallback rather than guessing", () => {
    expect(summarizeAuthResults(null, "some free-text nobody agreed on a format for")).toBeNull();
  });

  it("is case-insensitive on mechanism values", () => {
    expect(summarizeAuthResults("mx.example.com; spf=PASS; dkim=Fail", null)).toBe(
      "spf=pass dkim=fail",
    );
  });
});
