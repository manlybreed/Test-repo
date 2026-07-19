import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("AI-12 assistant mail tools", () => {
  it("registers mail tools in tools.ts and no send_mail tool", () => {
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
    expect(src).not.toContain('name: "send_mail"');
  });
});
