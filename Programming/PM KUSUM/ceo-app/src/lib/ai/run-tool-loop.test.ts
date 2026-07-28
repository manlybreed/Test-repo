import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * run-tool-loop.ts imports tools.ts, which imports action files that need
 * the Next.js server runtime (same constraint as tools.calendar.test.ts /
 * tools.mail.test.ts) — asserted via source text instead of importing.
 * The loop's actual runtime behavior (pausing on an irreversible tool,
 * never persisting that turn, resuming cleanly after confirm/cancel) was
 * verified live: a real schedule_meeting proposal was Cancelled with zero
 * Calendar event created (confirmed via the Google Calendar API directly),
 * then a second proposal was Confirmed and did create a real event; a
 * real send_mail proposal was Confirmed and produced a real SENT row with
 * an SMTP message id; a real trash_mail_thread proposal via the ⌘K bar was
 * Confirmed and set the thread's trashedAt server-side.
 */
describe("run-tool-loop pauses on confirmation-required tools", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/ai/run-tool-loop.ts"), "utf8");

  it("checks every tool_use against CONFIRMATION_REQUIRED_TOOLS before executing any of them", () => {
    const idx = src.indexOf("const confirmTool = toolUses.find");
    expect(idx).toBeGreaterThan(-1);
    // The check must come before the tool-execution loop, and before
    // `messages.push` — a confirmation-required call must never be
    // executed or appended to the conversation on the model's say-so alone.
    const pushIdx = src.indexOf("messages.push({ role: \"assistant\"");
    expect(pushIdx).toBeGreaterThan(idx);
  });

  it("builds pendingConfirmation from the shared describePendingAction, not ad-hoc text", () => {
    expect(src).toContain("describePendingAction(confirmTool.name, confirmTool.input)");
  });

  it("supports a caller-supplied system prompt preamble (used by /api/command for nav-intent)", () => {
    expect(src).toContain("systemPromptPreamble");
  });
});
