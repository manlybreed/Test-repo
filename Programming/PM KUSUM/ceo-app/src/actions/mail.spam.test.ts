import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * actions/mail.ts imports @/lib/auth (NextAuth), which breaks under plain
 * vitest — same constraint as mail.confirm.test.ts, same fix: assert on
 * the source directly rather than importing/executing it.
 */
describe("AI-22 spam server actions are reversible (checkAutonomy(\"move\"), no confirm gate)", () => {
  const src = readFileSync(join(process.cwd(), "src/actions/mail.ts"), "utf8");

  it("exports the four spam actions", () => {
    for (const name of [
      "markThreadSpamAction",
      "markThreadNotSpamAction",
      "markThreadsSpamAction",
      "markThreadsNotSpamAction",
    ]) {
      expect(src).toContain(`export async function ${name}(`);
    }
  });

  it("gates all four behind assertAutonomy(\"move\") — not \"delete\" or a confirmed flag", () => {
    for (const name of [
      "markThreadSpamAction",
      "markThreadNotSpamAction",
      "markThreadsSpamAction",
      "markThreadsNotSpamAction",
    ]) {
      const idx = src.indexOf(`export async function ${name}(`);
      const block = src.slice(idx, idx + 400);
      expect(block).toContain('assertAutonomy("move")');
    }
  });

  it("wires the singular actions to the imap-mailbox spam movers", () => {
    const spamIdx = src.indexOf("export async function markThreadSpamAction");
    expect(src.slice(spamIdx, spamIdx + 400)).toContain("markMailThreadAsSpam(");

    const notSpamIdx = src.indexOf("export async function markThreadNotSpamAction");
    expect(src.slice(notSpamIdx, notSpamIdx + 400)).toContain("markMailThreadNotSpam(");
  });
});
