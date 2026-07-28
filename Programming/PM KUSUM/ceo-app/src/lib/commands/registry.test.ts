import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listCommands,
  matchCommand,
  registerCommands,
  unregisterCommands,
  type CommandContext,
  type CommandEntry,
} from "./registry";

// Mirrors the mail command set registered by mail-client.tsx (a subset,
// enough to exercise every matching behavior the real registry relies on)
// so this suite plays the same role voice-commands.test.ts used to before
// that bespoke regex parser was replaced by this shared, fuzzy-matched
// registry.
const MAIL_COMMANDS: CommandEntry[] = [
  {
    id: "mail.compose",
    label: "Compose new email",
    description: "Open a new blank email to compose",
    phrases: ["compose", "compose new email", "write new email", "new email", "new message"],
  },
  {
    id: "mail.open-inbox",
    label: "Open Inbox",
    description: "Navigate to the Inbox folder",
    phrases: ["inbox", "open inbox", "go to inbox", "show inbox"],
  },
  {
    id: "mail.open-archive",
    label: "Open Archive folder",
    description: "Navigate to the Archive folder",
    phrases: ["archive folder", "open archive", "go to archive"],
  },
  {
    id: "mail.search",
    label: "Search mail",
    description: "Search mail for a query",
    phrases: ["search", "search mail", "find", "look for"],
    extractArgs: (raw) => {
      const match = raw
        .trim()
        .match(/^(?:search(?: mail| for)?|find|look for)\s+(.+)/i);
      return match?.[1]?.trim() ? { query: match[1].trim() } : null;
    },
  },
  {
    id: "mail.archive",
    label: "Archive open thread",
    description: "Archive the currently open mail thread",
    phrases: ["archive", "archive this", "archive this email", "archive this thread"],
    isVisible: (ctx) => Boolean(ctx.hasSelectedThread),
  },
  {
    id: "mail.reply-all",
    label: "Reply all",
    description: "Reply to all recipients of the currently open mail thread",
    phrases: ["reply all", "reply to all"],
  },
  {
    id: "mail.reply",
    label: "Reply",
    description: "Reply to the currently open mail thread",
    phrases: ["reply", "reply to this"],
  },
];

const CTX: CommandContext = { route: "/ceo/mail", hasSelectedThread: true, isComposing: false };

describe("command registry", () => {
  beforeEach(() => {
    registerCommands(MAIL_COMMANDS);
  });

  afterEach(() => {
    unregisterCommands(MAIL_COMMANDS.map((c) => c.id));
  });

  it("lists only commands visible for the given context", () => {
    const withThread = listCommands(CTX).map((c) => c.id);
    expect(withThread).toContain("mail.archive");

    const withoutThread = listCommands({ ...CTX, hasSelectedThread: false }).map((c) => c.id);
    expect(withoutThread).not.toContain("mail.archive");
  });

  it("recognizes compose phrasing", () => {
    expect(matchCommand("compose a new email", CTX)?.entry.id).toBe("mail.compose");
    expect(matchCommand("write a new message", CTX)?.entry.id).toBe("mail.compose");
    expect(matchCommand("new email", CTX)?.entry.id).toBe("mail.compose");
  });

  it("recognizes folder navigation with a nav verb", () => {
    expect(matchCommand("open the inbox", CTX)?.entry.id).toBe("mail.open-inbox");
    expect(matchCommand("go to archive", CTX)?.entry.id).toBe("mail.open-archive");
  });

  it("resolves a bare 'archive' to the thread action, not the folder", () => {
    // "archive" is an exact phrase on mail.archive but not a valid
    // continuous-subsequence match against mail.open-archive's longer
    // phrases ("archive folder", "open archive", "go to archive"), so the
    // ambiguity that the old regex parser resolved via exact-string special
    // casing is resolved here by phrase design instead.
    expect(matchCommand("archive", CTX)?.entry.id).toBe("mail.archive");
  });

  it("extracts the search query and preserves its original case", () => {
    const match = matchCommand("search for Invoices", CTX);
    expect(match?.entry.id).toBe("mail.search");
    expect(match?.args).toEqual({ query: "Invoices" });

    const match2 = matchCommand("find the SBI POS machine thread", CTX);
    expect(match2?.entry.id).toBe("mail.search");
    expect(match2?.args).toEqual({ query: "the SBI POS machine thread" });
  });

  it("checks reply-all before bare reply", () => {
    expect(matchCommand("reply all", CTX)?.entry.id).toBe("mail.reply-all");
    expect(matchCommand("reply", CTX)?.entry.id).toBe("mail.reply");
  });

  it("never matches a context-gated command when its condition is false", () => {
    const noThreadCtx: CommandContext = { ...CTX, hasSelectedThread: false };
    expect(matchCommand("archive this email", noThreadCtx)).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(matchCommand("", CTX)).toBeNull();
    expect(matchCommand("   ", CTX)).toBeNull();
  });

  it("falls back to null for anything that isn't a recognized command", () => {
    expect(matchCommand("what did Ranjeet Kumar want", CTX)).toBeNull();
  });
});
