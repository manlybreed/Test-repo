import { describe, expect, it } from "vitest";
import { lexicalSearchPlan } from "@/lib/mail/ai/search-expand";
import { buildThreadSearchAnd, scoreSearchHit } from "@/lib/mail/mail-search";

describe("AI-assisted search plan", () => {
  it("builds SBI POS concept groups lexically", () => {
    const plan = lexicalSearchPlan("SBI POS machine");
    expect(plan.mustGroups.length).toBeGreaterThanOrEqual(2);
    const flat = plan.mustGroups.flat().join(" ");
    expect(flat).toMatch(/sbi|state bank/);
    expect(flat).toMatch(/pos|e-statement/);
  });

  it("scores sender domain hits for bank mail", () => {
    const plan = lexicalSearchPlan("SBI POS");
    const score = scoreSearchHit({
      query: "SBI POS",
      subject: "DAILY POS E-Statement",
      fromAddress: "alerts@sbi.co.in",
      fromName: "SBI Alerts",
      plan,
    });
    expect(score).toBeGreaterThan(40);
  });

  it("creates SQL clauses from a plan", () => {
    const plan = lexicalSearchPlan("SBI POS machine");
    const and = buildThreadSearchAnd("SBI POS machine", plan);
    expect(and.length).toBe(plan.mustGroups.length);
  });

  it("never requires a generic/meta word describing the query itself, only the real concepts", () => {
    // "message" names the query's own phrasing ("the MESSAGE about..."), not
    // anything the target email's body actually contains — a required group
    // built from it can never match a real email, causing a genuine recall
    // miss even though the real concepts (anthropic, paying) are present.
    const plan = lexicalSearchPlan("the message about paying anthropic");
    const required = plan.mustGroups.flat().map((s) => s.toLowerCase());
    expect(required).not.toContain("message");
    expect(plan.should.map((s) => s.toLowerCase())).toContain("message");
    // The real concepts still end up required.
    expect(plan.mustGroups.some((g) => g.includes("anthropic"))).toBe(true);
    expect(plan.mustGroups.some((g) => g.includes("paying"))).toBe(true);
  });
});
