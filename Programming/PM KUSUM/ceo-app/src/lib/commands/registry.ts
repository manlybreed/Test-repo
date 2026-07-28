import commandScore from "command-score";

/**
 * Shared app-wide command registry — the single source of truth for "what
 * can this app do right now" for both the fast client-side fuzzy matcher
 * (this module) and the LLM fallback tool (`client_action` in
 * src/lib/ai/tools.ts, added in a later phase), so the two never drift into
 * separate hand-maintained command lists the way the old per-page regex
 * parsers (mail's bespoke voice-command parser, command-bar.tsx's
 * detectNavIntent) used to.
 *
 * Pure data + matching logic only. The actual handler for a command
 * (`() => archiveSelected()`) closes over a page's React state and can't
 * live here — pages register handlers at runtime via useRegisterCommands
 * (see register-commands.tsx), keyed by the same `id` used below.
 */

export type CommandContext = {
  /** Current pathname, e.g. "/ceo/mail" or "/ceo/invoices". */
  route: string;
  /** Whether a mail thread is currently open/selected — gates thread-scoped commands (archive/trash/reply/...). */
  hasSelectedThread?: boolean;
  /** Whether a compose window is open — gates compose-scoped commands. */
  isComposing?: boolean;
};

export type CommandEntry = {
  /** Stable id, namespaced by area — "mail.archive", "nav.invoices". */
  id: string;
  /** Human-readable label, shown in the shortcut-help modal / ⌘K list. */
  label: string;
  /** Realistic phrasings a user might say or type — the more variety, the better the fuzzy match. Include short trigger words, not just the longest formal phrase (see registry.test.ts for why). */
  phrases: string[];
  /** Shown to the LLM fallback tier as this command's description. */
  description: string;
  /** Only match/offer this command when true (or omitted). Mirrors Superhuman's context-aware palette visibility — e.g. "archive" only makes sense with a thread open. */
  isVisible?: (ctx: CommandContext) => boolean;
  /** Pull structured args out of the raw utterance (e.g. a search query). Only needed for parametrized commands. */
  extractArgs?: (raw: string) => Record<string, unknown> | null;
};

const registry = new Map<string, CommandEntry>();

export function registerCommand(entry: CommandEntry): void {
  registry.set(entry.id, entry);
}

export function registerCommands(entries: CommandEntry[]): void {
  for (const entry of entries) registerCommand(entry);
}

export function unregisterCommand(id: string): void {
  registry.delete(id);
}

export function unregisterCommands(ids: string[]): void {
  for (const id of ids) unregisterCommand(id);
}

/** All commands currently visible for this context — for the shortcut-help modal / ⌘K listing / the LLM fallback's tool description. */
export function listCommands(ctx: CommandContext): CommandEntry[] {
  return Array.from(registry.values()).filter((e) => !e.isVisible || e.isVisible(ctx));
}

export type CommandMatch = {
  entry: CommandEntry;
  score: number;
  args: Record<string, unknown> | null;
};

/**
 * Best fuzzy match for a full utterance (voice transcript or typed
 * sentence) among currently-visible commands, or null if nothing scores
 * above the threshold. Deliberately NOT using command-score in its classic
 * "user is typing a prefix of a command name" order (phrase, userText) —
 * empirically verified (see registry.test.ts) that scoring
 * commandScore(utterance, phrase) instead correctly finds a short trigger
 * phrase embedded anywhere in a longer utterance ("archive this email
 * please" still scores ~0.9 against "archive this"), which is the shape
 * real speech transcripts and typed commands actually take here.
 */
export function matchCommand(
  raw: string,
  ctx: CommandContext,
  threshold = 0.5,
): CommandMatch | null {
  const text = raw.trim();
  if (!text) return null;

  let best: CommandMatch | null = null;
  for (const entry of listCommands(ctx)) {
    let bestPhraseScore = 0;
    for (const phrase of entry.phrases) {
      const score = commandScore(text, phrase);
      if (score > bestPhraseScore) bestPhraseScore = score;
    }
    if (bestPhraseScore > 0 && (!best || bestPhraseScore > best.score)) {
      best = {
        entry,
        score: bestPhraseScore,
        args: entry.extractArgs ? entry.extractArgs(text) : null,
      };
    }
  }

  return best && best.score >= threshold ? best : null;
}
