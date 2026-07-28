import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("AI-12 assistant mail tools", () => {
  it("registers read/draft mail tools in tools.ts", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/ai/tools.ts"),
      "utf8",
    );
    for (const name of [
      "search_mail",
      "ask_mail",
      "digest_inbox",
      "summarize_thread",
      "draft_reply",
      "propose_tasks_from_mail",
      "recall_person",
    ]) {
      expect(src).toContain(`name: "${name}"`);
    }
  });

  it("registers reversible mail-mutation tools in tools.ts", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/ai/tools.ts"),
      "utf8",
    );
    for (const name of [
      "archive_mail_thread",
      "move_mail_thread_to_folder",
      "set_mail_priority",
      "mark_mail_important",
      "mark_mail_read",
      "snooze_mail_thread",
    ]) {
      expect(src).toContain(`name: "${name}"`);
    }
  });

  it("registers send_mail and trash tools, gated behind CONFIRMATION_REQUIRED_TOOLS not model self-report", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/ai/tools.ts"),
      "utf8",
    );
    for (const name of ["send_mail", "trash_mail_thread", "bulk_trash_mail_threads"]) {
      expect(src).toContain(`name: "${name}"`);
    }
    const { CONFIRMATION_REQUIRED_TOOLS } = await import("../../ai/tool-confirmation");
    expect(CONFIRMATION_REQUIRED_TOOLS.has("send_mail")).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS.has("trash_mail_thread")).toBe(true);
    expect(CONFIRMATION_REQUIRED_TOOLS.has("bulk_trash_mail_threads")).toBe(true);
  });
});
