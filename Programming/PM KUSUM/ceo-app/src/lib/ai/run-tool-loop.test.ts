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

  it("grounds the model with a real current-date/time context computed fresh per call, not baked into the static SYSTEM_PROMPT", () => {
    // Regression guard for the exact hallucination class this codebase has
    // hit before (a meeting scheduled a year in the wrong direction) —
    // list_calendar_events/update_calendar_event ask the model to supply
    // its own ISO date range, so without an explicit "now" anchor here it
    // has nothing but its own training-time sense of the date to go on.
    expect(src).toContain("new Date()");
    expect(src).toContain('Treat this as "today"/"now"');
  });

  it("hands the model a ready-made IST wall-clock date label, not a raw UTC timestamp to convert itself", () => {
    // A first version passed now.toISOString() (UTC) with a "+5:30" note
    // and trusted the model to do the arithmetic — live testing caught it
    // reading the UTC instant's own calendar date as "today" instead
    // (calling 2026-08-01T00:03 IST "July 31"). Fixed by computing the
    // IST-local date/time strings directly via toLocaleDateString/
    // toLocaleTimeString with timeZone: "Asia/Kolkata", so the model is
    // handed the answer, not raw material to compute it from.
    expect(src).toContain('timeZone: "Asia/Kolkata"');
    expect(src).toContain("toLocaleDateString");
    expect(src).not.toContain("now.toISOString()");
  });
});

describe("run-tool-loop client_action (Phase 3)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/ai/run-tool-loop.ts"), "utf8");

  it("checks for the client_action tool before the confirmation gate and before executing anything", () => {
    const clientActionIdx = src.indexOf("t.name === CLIENT_ACTION_TOOL_NAME");
    const confirmIdx = src.indexOf("const confirmTool = toolUses.find");
    const pushIdx = src.indexOf("messages.push({ role: \"assistant\"");
    expect(clientActionIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(clientActionIdx);
    expect(pushIdx).toBeGreaterThan(clientActionIdx);
  });

  it("supports caller-supplied extraTools merged into the fixed ceoTools array", () => {
    expect(src).toContain("opts?.extraTools?.length");
    expect(src).toContain("[...ceoTools, ...opts.extraTools]");
  });

  it("never routes client_action through runCeoTool — it's resolved by the browser, not this server", () => {
    const start = src.indexOf("if (clientActionTool) {");
    const end = src.indexOf("}", src.indexOf("finalText = texts.join", start));
    const block = src.slice(start, end);
    expect(block).not.toContain("runCeoTool");
  });
});

describe("run-tool-loop optionsPrompt (Phase 6)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/ai/run-tool-loop.ts"), "utf8");

  it("imports buildOptionsPrompt from the dedicated pure leaf module, not tools.ts", () => {
    // Mirrors why tool-confirmation.ts is its own leaf module — pure
    // logic needs to stay importable/testable without pulling in
    // tools.ts's action-file (NextAuth/server-runtime) imports.
    expect(src).toContain('from "./options-prompt"');
  });

  it("is not loop-terminal — computed only where the loop already finishes naturally (no tool calls this turn)", () => {
    const naturalFinishIdx = src.indexOf("if (toolUses.length === 0)");
    const optionsCallIdx = src.indexOf("optionsPrompt = buildOptionsPrompt(lastCalendarCall)");
    expect(naturalFinishIdx).toBeGreaterThan(-1);
    expect(optionsCallIdx).toBeGreaterThan(naturalFinishIdx);
    // And it must NOT be set on either loop-terminal path (client_action,
    // confirmation-required) — those discard the turn entirely instead.
    const clientActionIdx = src.indexOf("if (clientActionTool) {");
    const confirmIdx = src.indexOf("if (confirmTool) {");
    const pushIdx = src.indexOf('messages.push({ role: "assistant"');
    expect(clientActionIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(clientActionIdx);
    expect(src.slice(clientActionIdx, confirmIdx)).not.toContain("buildOptionsPrompt");
    expect(src.slice(confirmIdx, pushIdx)).not.toContain("buildOptionsPrompt");
  });

  it("overwrites (not accumulates) the last calendar call every turn, so an earlier lookup can't leak into a later, unrelated turn", () => {
    expect(src).toContain("lastCalendarCall = calendarCallThisTurn;");
    const declIdx = src.indexOf("let calendarCallThisTurn: CalendarToolCall | null = null;");
    const assignIdx = src.indexOf("lastCalendarCall = calendarCallThisTurn;");
    expect(declIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(declIdx);
  });
});
