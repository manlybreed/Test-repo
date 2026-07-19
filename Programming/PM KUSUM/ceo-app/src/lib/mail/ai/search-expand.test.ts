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
});
