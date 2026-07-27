import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { suggestLabelMatchCriteria } from "@/lib/mail/ai/label-correction";

/**
 * suggestLabelMatchCriteria calls Claude (via claudeJson), so — consistent
 * with this codebase's existing convention of only unit-testing the
 * deterministic parts of AI-calling functions (see claude.test.ts, which
 * tests parseJsonFromModelText but not claudeJson itself; resolveDraftRecipients
 * and draftNewMail in draft.ts have no dedicated test file at all for the
 * same reason) — these tests cover only the guard clauses that short-circuit
 * before any network call. The actual classification quality (does it
 * correctly generalize "yogesh ji" style free text, does it correctly
 * decline a one-off email) is exercised against the real API via the live
 * browser walkthrough, the same way triageThread's real classification
 * quality is verified live rather than unit-tested.
 */
describe("suggestLabelMatchCriteria — deterministic guard clauses", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns null without attempting a call when no Anthropic key is configured", async () => {
    const result = await suggestLabelMatchCriteria({
      fromAddress: "alerts@axisbank.com",
      subject: "Your monthly statement",
      targetLabel: "BANKING",
    });
    expect(result).toBeNull();
  });

  it("returns null for an empty fromAddress even with a key configured", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-secret";
    const result = await suggestLabelMatchCriteria({
      fromAddress: "   ",
      subject: "Anything",
      targetLabel: "BANKING",
    });
    expect(result).toBeNull();
  });

  it("returns null for an empty targetLabel even with a key configured", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-secret";
    const result = await suggestLabelMatchCriteria({
      fromAddress: "alerts@axisbank.com",
      subject: "Anything",
      targetLabel: "  ",
    });
    expect(result).toBeNull();
  });
});
