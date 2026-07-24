/**
 * AI-21 Autonomy policy — reversible vs irreversible actions.
 * Irreversible always require explicit confirm.
 */

export type MailAction =
  | "label"
  | "priority"
  | "important"
  | "snooze"
  | "mark_read"
  | "draft"
  | "send"
  | "delete"
  | "archive"
  | "move"
  | "schedule_send"
  | "calendar_invite"
  | "unsubscribe"
  | "block_sender"
  | "create_task";

const IRREVERSIBLE: ReadonlySet<MailAction> = new Set([
  "send",
  "delete",
  "schedule_send",
  "calendar_invite",
  "unsubscribe",
  "block_sender",
  "create_task",
]);

export function isIrreversible(action: MailAction): boolean {
  return IRREVERSIBLE.has(action);
}

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function checkAutonomy(
  action: MailAction,
  opts?: {
    confirmed?: boolean;
    autoLabel?: boolean;
    autoPriority?: boolean;
    requireConfirmSend?: boolean;
  },
): PolicyResult {
  if (isIrreversible(action)) {
    if (opts?.confirmed) return { allowed: true };
    return {
      allowed: false,
      reason: `Action "${action}" requires explicit confirmation`,
    };
  }

  if (action === "label" && opts?.autoLabel === false) {
    return { allowed: false, reason: "Auto-label disabled in settings" };
  }
  if (action === "priority" && opts?.autoPriority === false) {
    return { allowed: false, reason: "Auto-priority disabled in settings" };
  }

  return { allowed: true };
}

export function assertAutonomy(
  action: MailAction,
  opts?: Parameters<typeof checkAutonomy>[1],
): void {
  const r = checkAutonomy(action, opts);
  if (!r.allowed) throw new Error(r.reason);
}
