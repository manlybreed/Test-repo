import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * route.ts imports @/lib/auth (NextAuth), which needs the Next.js server
 * runtime and breaks under plain vitest — same constraint documented
 * elsewhere in this codebase (tools.calendar.test.ts, mail.confirm.test.ts).
 * Asserted via source text instead of importing. The actual end-to-end
 * behavior (a client_action tool call resolving to a real client-side
 * command via the ⌘K bar) was verified live.
 */
describe("Phase 3 — /api/command client_action wiring", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/command/route.ts"),
    "utf8",
  );

  it("only builds the client_action tool when the client actually sent commands", () => {
    expect(src).toContain("function buildClientActionTool(available: AvailableCommand[])");
    expect(src).toContain("if (!available.length) return null;");
  });

  it("constrains commandId to a real enum, so the model can't invent one", () => {
    const idx = src.indexOf("function buildClientActionTool");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("enum: available.map((c) => c.id)");
  });

  it("returns a client_action response distinct from navigate/confirm/text/error", () => {
    expect(src).toContain('type: "client_action"');
    expect(src).toContain("result.clientAction.commandId");
  });

  it("checks client_action before falling through to a plain text/confirm reply", () => {
    const clientActionIdx = src.indexOf('if (result.clientAction)');
    const confirmIdx = src.indexOf("if (result.pendingConfirmation)");
    const textIdx = src.indexOf('type: "text"');
    expect(clientActionIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(clientActionIdx);
    expect(textIdx).toBeGreaterThan(clientActionIdx);
  });
});
