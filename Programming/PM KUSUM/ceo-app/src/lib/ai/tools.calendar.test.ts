import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("Phase 2 — assistant calendar tools", () => {
  it("registers check_calendar_availability and schedule_meeting in tools.ts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    for (const name of ["check_calendar_availability", "schedule_meeting"]) {
      expect(src).toContain(`name: "${name}"`);
    }
  });

  it("schedule_meeting's schema requires confirmed, so the model can't omit it", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/ai/tools.ts"), "utf8");
    const start = src.indexOf('name: "schedule_meeting"');
    const block = src.slice(start, start + 1200);
    expect(block).toContain("confirmed:");
    expect(block).toContain('required: ["title", "startIso", "endIso", "attendeeEmails", "confirmed"]');
  });
});
