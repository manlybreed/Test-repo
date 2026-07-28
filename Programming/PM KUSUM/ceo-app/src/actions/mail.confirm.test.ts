import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * actions/mail.ts imports @/lib/auth (NextAuth), which needs the Next.js
 * server runtime and breaks under plain vitest — same constraint already
 * documented for tools.ts (see tools.calendar.test.ts / tools.mail.test.ts).
 * These assertions read the source directly instead of importing it, to
 * pin down the fix and guard against the hardcoded-confirmed bug regressing.
 */
describe("Phase 2 — trash actions take a real confirmed param", () => {
  const src = readFileSync(join(process.cwd(), "src/actions/mail.ts"), "utf8");

  it("trashThreadAction accepts a real confirmed argument", () => {
    expect(src).toContain(
      "export async function trashThreadAction(threadId: string, confirmed: boolean)",
    );
  });

  it("trashThreadsAction accepts a real confirmed argument", () => {
    expect(src).toContain(
      "export async function trashThreadsAction(threadIds: string[], confirmed: boolean)",
    );
  });

  it("never hardcodes assertAutonomy(\"delete\", { confirmed: true }) again", () => {
    // The original bug: both functions passed the literal boolean `true`
    // regardless of what the caller actually confirmed, so there was no
    // real server-side gate on trashing mail at all.
    expect(src).not.toContain('assertAutonomy("delete", { confirmed: true })');
  });

  it("both trash actions pass their own confirmed param into assertAutonomy", () => {
    const trashSingleIdx = src.indexOf("export async function trashThreadAction");
    const trashSingleBlock = src.slice(trashSingleIdx, trashSingleIdx + 300);
    expect(trashSingleBlock).toContain('assertAutonomy("delete", { confirmed });');

    const trashBulkIdx = src.indexOf("export async function trashThreadsAction");
    const trashBulkBlock = src.slice(trashBulkIdx, trashBulkIdx + 300);
    expect(trashBulkBlock).toContain('assertAutonomy("delete", { confirmed });');
  });
});
