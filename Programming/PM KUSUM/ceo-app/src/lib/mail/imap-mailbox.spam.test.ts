import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * imap-mailbox.ts's move functions do real IMAP network calls via a
 * private connectImap() helper — none of the existing archive/trash move
 * functions are execution-tested either (would mean mocking imapflow's
 * ImapFlow client end to end). These assertions pin the source down
 * instead, the same convention this file's sibling functions rely on;
 * real behavior is verified live against a real IMAP account.
 */
describe("AI-22 markMailThreadsAsSpam/NotSpam mirror archive/trash exactly", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/mail/imap-mailbox.ts"),
    "utf8",
  );

  it("markMailThreadsAsSpam resolves/creates a JUNK-role mailbox and moves messages there", () => {
    const idx = src.indexOf("export async function markMailThreadsAsSpam");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain('resolveMailboxPath(client, input.accountId, "JUNK")');
    expect(block).toContain('targetRole: "JUNK"');
  });

  it("markMailThreadsNotSpam resolves the INBOX and moves messages back", () => {
    const idx = src.indexOf("export async function markMailThreadsNotSpam");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain('resolveMailboxPath(client, input.accountId, "INBOX")');
    expect(block).toContain('targetRole: "INBOX"');
  });

  it("exposes singular wrappers for both directions", () => {
    expect(src).toContain("export async function markMailThreadAsSpam");
    expect(src).toContain("export async function markMailThreadNotSpam");
  });
});
