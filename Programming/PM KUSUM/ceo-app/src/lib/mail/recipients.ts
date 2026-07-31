/**
 * Pure recipient parsing/formatting — zero imports from action files, so
 * it can be unit-tested directly (the same "leaf module" reasoning as
 * tool-confirmation.ts/options-prompt.ts: a component that needs
 * findContactsAction can't be imported into plain vitest without
 * dragging in NextAuth). people-picker.tsx is the only importer of both
 * this file and the action.
 *
 * The wire format is unchanged from what mail-client.tsx's splitAddrs/
 * acceptSuggestion and calendar-view.tsx's attendee handling already
 * produce and consume: a comma/semicolon-separated string of either
 * bare addresses or `Name <email>` tokens.
 */

export type Recipient = { address: string; displayName: string | null };

const QUOTED_NAME_ADDR_RE = /^"([^"]*)"\s*<([^<>]+)>$/;
const NAME_ADDR_RE = /^([^<>]*)<([^<>]+)>$/;

function parseToken(token: string): Recipient | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const quoted = QUOTED_NAME_ADDR_RE.exec(trimmed);
  if (quoted) {
    const [, name, address] = quoted;
    return { address: address!.trim(), displayName: name!.trim() || null };
  }
  const named = NAME_ADDR_RE.exec(trimmed);
  if (named) {
    const [, name, address] = named;
    return { address: address!.trim(), displayName: name!.trim() || null };
  }
  return { address: trimmed, displayName: null };
}

/** Splits on the same `[,;]` regex splitAddrs already uses, then parses
 * each token as `Name <email>` (quoted or not) or a bare address. */
export function parseRecipients(raw: string): Recipient[] {
  return raw
    .split(/[,;]/)
    .map(parseToken)
    .filter((r): r is Recipient => r !== null);
}

/** Inverse of parseRecipients — matches acceptSuggestion's existing
 * `${displayName} <${address}>` construction exactly. */
export function serializeRecipients(list: Recipient[]): string {
  return list
    .map((r) => (r.displayName ? `${r.displayName} <${r.address}>` : r.address))
    .join(", ");
}

/** Hash a string to a hue — ported from mail-client.tsx's avatarHue. */
export function avatarHue(seed: string): number {
  return [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
}

/** Two-letter initials for a chip avatar — ported from mail-client.tsx's
 * threadInitials, generalized from a subject line to a person. */
export function recipientInitials(r: Recipient): string {
  if (r.displayName) {
    const parts = r.displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return (r.displayName.trim().slice(0, 2) || "??").toUpperCase();
  }
  const local = r.address.split("@")[0] || r.address;
  return (local.slice(0, 2) || "??").toUpperCase();
}
