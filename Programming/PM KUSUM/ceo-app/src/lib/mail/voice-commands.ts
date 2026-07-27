/**
 * Mail-wide voice commands — available as soon as the Mail tab is open,
 * not scoped to one AI-assist text field like the per-field mic buttons
 * (AI Draft brief, refine box, Ask mailbox). Pure parsing only: this module
 * turns a spoken utterance into a structured command; the caller in
 * mail-client.tsx is responsible for actually executing it against app
 * state (folders, selection, compose, Ask).
 *
 * Deliberately deterministic keyword/pattern matching rather than another
 * Claude round-trip for classification — it's instant, free, and has no
 * hallucination surface of its own. Anything that doesn't clearly match a
 * concrete app action falls through to `ask`, which routes the whole
 * utterance to the existing grounded Ask-mailbox flow — so no command is
 * ever "lost": worst case, it's answered as a natural-language question.
 */

export type MailFolderTarget =
  | "SMART_INBOX"
  | "INBOX"
  | "SENT"
  | "DRAFTS"
  | "TRASH"
  | "JUNK"
  | "ARCHIVE"
  | "OUTBOX";

export type MailVoiceCommand =
  | { type: "compose" }
  | { type: "openFolder"; folder: MailFolderTarget }
  | { type: "search"; query: string }
  | { type: "archive" }
  | { type: "trash" }
  | { type: "reply" }
  | { type: "replyAll" }
  | { type: "forward" }
  | { type: "ask"; question: string };

const FOLDER_WORDS: Array<[RegExp, MailFolderTarget]> = [
  [/\bsmart inbox\b/, "SMART_INBOX"],
  [/\ball inbox\b/, "INBOX"],
  [/\binbox\b/, "INBOX"],
  [/\bsent\b/, "SENT"],
  [/\bdrafts?\b/, "DRAFTS"],
  [/\b(trash|deleted( items)?)\b/, "TRASH"],
  [/\b(junk|spam)\b/, "JUNK"],
  [/\barchive\b/, "ARCHIVE"],
  [/\boutbox\b/, "OUTBOX"],
];

export function parseMailVoiceCommand(raw: string): MailVoiceCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (
    /\b(compose|write|draft|start)\b[\s\w]*\b(new )?(email|message|mail)\b/.test(
      lower,
    ) ||
    /^new (email|message|mail)\b/.test(lower)
  ) {
    return { type: "compose" };
  }

  const navMatch = lower.match(
    /\b(?:open|go to|show( me)?|switch to|take me to)\b/,
  );
  if (navMatch) {
    for (const [re, folder] of FOLDER_WORDS) {
      if (re.test(lower)) return { type: "openFolder", folder };
    }
  }
  // Bare folder name with no nav verb ("trash", "sent") is common enough
  // in short voice commands to support directly too.
  if (/^(smart inbox|all inbox|inbox|sent|drafts?|trash|deleted items|junk|spam|archive|outbox)$/.test(
    lower,
  )) {
    for (const [re, folder] of FOLDER_WORDS) {
      if (re.test(lower)) return { type: "openFolder", folder };
    }
  }

  const searchMatch = lower.match(
    /^(?:search(?: mail| for)?|find|look for)\s+(.+)/,
  );
  if (searchMatch?.[1]?.trim()) {
    const idx = lower.indexOf(searchMatch[1]);
    return { type: "search", query: text.slice(idx).trim() };
  }

  if (/\breply\s*all\b/.test(lower)) return { type: "replyAll" };
  if (/\bforward\b/.test(lower)) return { type: "forward" };
  if (/\breply\b/.test(lower)) return { type: "reply" };
  if (/\barchive\b/.test(lower)) return { type: "archive" };
  if (/\b(delete|trash)\b/.test(lower)) return { type: "trash" };

  return { type: "ask", question: text };
}
