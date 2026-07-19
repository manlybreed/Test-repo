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
