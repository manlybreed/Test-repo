"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive as ArchiveIcon,
  Bell,
  BellRing,
  CalendarClock,
  Check,
  ChevronDown,
  Keyboard,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  FileText,
  FolderInput,
  Forward as ForwardIcon,
  Inbox as InboxIcon,
  Layers,
  ListChecks,
  Loader2,
  Mail as MailIcon,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Paperclip,
  PanelLeftOpen,
  PenLine,
  Plane,
  Save,
  SendHorizontal,
  RefreshCw,
  Reply as ReplyIcon,
  ReplyAll as ReplyAllIcon,
  Send,
  Settings,
  ShieldAlert,
  ShieldOff,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { MailComposer } from "@/components/mail/composer";
import {
  MessageReader,
  prepareMailHtml,
  type MailMessageView,
} from "@/components/mail/message-reader";
import {
  SignaturesPanel,
  type SignatureRow,
} from "@/components/mail/signatures-panel";
import { VacationPanel } from "@/components/mail/vacation-panel";
import { MailboxesPanel } from "@/components/mail/mailboxes-panel";
import { CalendarPanel } from "@/components/mail/calendar-panel";
import { ScheduleMeetingPanel } from "@/components/mail/schedule-meeting-panel";
import {
  listMailAccountsAction,
  type MailAccountSummary,
} from "@/actions/mail-accounts";
import { haptic } from "@/components/mail/haptics";
import { playSendSound, playSendFlyAnimation } from "@/components/mail/sound";
import { VoiceButton } from "@/components/voice/voice-button";
import {
  useRegisterCommands,
  type RegisteredCommand,
} from "@/lib/commands/use-register-commands";
import { buildFolderTree, type FolderTreeNode } from "@/lib/mail/folder-tree";
import {
  askMailAction,
  autocompleteAction,
  draftReplyAction,
  draftNewMailAction,
  extractDraftRecipientsAction,
  extractCommitmentsAction,
  acceptCommitmentAction,
  summarizeThreadAction,
  triageThreadAction,
  syncMailAction,
  sendMailAction,
  flushQueuedSendAction,
  cancelScheduledSend,
  uploadComposeAttachmentAction,
  forwardMessageAttachmentsAction,
  type ComposeAttachment,
  getMailThread,
  markThreadRead,
  digestAction,
  rewriteDraftAction,
  createFollowUpRemindersAction,
  setThreadPriority,
  getMailBootstrap,
  listMailThreads,
  listAllInboxesThreadsAction,
  saveDraftAction,
  listDraftsFolderAction,
  getDraftAction,
  deleteDraftAction,
  refineDraftAction,
  createMailLabelAction,
  backfillSmartLabelsAction,
  searchThreadsAction,
  listOutboxAction,
  trashThreadAction,
  multilingualDraftAction,
  recallPersonAction,
  findContactsAction,
  refreshStyleAction,
  summarizeAttachmentAction,
  bulkCleanupSuggestionsAction,
  unsubscribeCandidateAction,
  dismissReminderAction,
  listLabelRulesAction,
  upsertLabelRuleAction,
  deleteLabelRuleAction,
  snoozeThread,
  archiveThreadAction,
  moveThreadToFolderAction,
  archiveThreadsAction,
  trashThreadsAction,
  moveThreadsToFolderAction,
  setThreadImportant,
  listTasksForThreadAction,
  blockSenderAction,
  markThreadSpamAction,
  markThreadNotSpamAction,
  markThreadsSpamAction,
  markThreadsNotSpamAction,
  suggestSpamCorrectionAction,
  correctSmartLabelAction,
  suggestLabelCorrectionAction,
  applyLabelCorrectionAction,
  undoLabelCorrectionAction,
  type LabelCorrectionSnapshot,
} from "@/actions/mail";
import {
  DEFAULT_DRAFT_TONE,
  DRAFT_REFINE_PRESETS,
  type DraftRefinePresetId,
} from "@/lib/mail/ai/draft-presets";
import {
  SMART_LABELS,
  SMART_LABEL_META,
  mergeSmartLabels,
  parseLabelsJson,
  isSmartLabel,
  type SmartLabel,
} from "@/lib/mail/ai/smart-labels";
import type { MatchingThreadPreview } from "@/lib/mail/ai/label-rules";

const SYSTEM_ROLE_ORDER = [
  "INBOX",
  "SENT",
  "DRAFTS",
  "TRASH",
  "JUNK",
  "ARCHIVE",
] as const;

const SYSTEM_FOLDER_ROLES = new Set<string>(SYSTEM_ROLE_ORDER);

/** Hide these label/virtual mailboxes in the UI only (IMAP untouched). */
const HIDDEN_MAILBOX_RE =
  /^(all mail|all|important|starred|starred mail|notes|chats|snoozed|scheduled|outbox|junk e-mail|deleted items|sent messages|sent items|drafts?)$/i;

const MAIL_POLL_MS = 10 * 60 * 1000; // fallback only when live SSE is down
const OUTBOX_ID = "__outbox__";
const SMART_INBOX_ID = "__smart_inbox__";
/** Unified view merging every configured mailbox's Inbox into one list. */
const ALL_INBOXES_ID = "__all_inboxes__";
const THREADS_PAGE_SIZE = 50;

type Thread = {
  id: string;
  /** Which mailbox this thread belongs to — used for the account color
   * badge in the unified "All Inboxes" view. */
  accountId?: string;
  subject: string;
  snippet: string | null;
  lastMessageAt: string | Date;
  trashedAt?: string | Date | null;
  unreadCount: number;
  priority: string;
  important?: boolean;
  labelsJson: string;
  fromName?: string | null;
  fromAddress?: string | null;
  hasAttachments?: boolean;
  answered?: boolean;
  outboxStatus?: string;
  bodyHtml?: string;
  toAddresses?: string[];
};

type Folder = {
  id: string;
  path: string;
  name: string;
  role: string;
  messageCount?: number;
};

function scoreSystemFolder(f: Folder) {
  let s = 200 - f.path.length;
  const base = (f.path.split(/[/.]/).pop() || f.name).toLowerCase();
  if (["inbox", "sent", "drafts", "draft", "trash", "junk", "spam", "archive"].includes(base)) {
    s += 80;
  }
  if (!f.path.includes(".") && !f.path.includes("/")) s += 40;
  return s;
}

/** One folder per system role; prefer canonical short paths. UI-only. */
function pickSystemFolders(folders: Folder[]): Folder[] {
  const best = new Map<string, Folder>();
  for (const f of folders) {
    if (!SYSTEM_FOLDER_ROLES.has(f.role)) continue;
    const prev = best.get(f.role);
    if (!prev || scoreSystemFolder(f) > scoreSystemFolder(prev)) {
      best.set(f.role, f);
    }
  }
  return SYSTEM_ROLE_ORDER.map((r) => best.get(r)).filter(
    (f): f is Folder => Boolean(f),
  );
}

/** Custom labels only — hide redundant virtual/duplicate names. UI-only. */
function pickLabelFolders(folders: Folder[]): Folder[] {
  const systemIds = new Set(pickSystemFolders(folders).map((f) => f.id));
  return folders.filter((f) => {
    if (systemIds.has(f.id)) return false;
    if (SYSTEM_FOLDER_ROLES.has(f.role) && f.role !== "OTHER") return false;
    const label = f.name || f.path;
    const base = label.split(/[/.]/).pop() || label;
    // Duplicate system-style names (Sent Messages, All Mail, …)
    if (HIDDEN_MAILBOX_RE.test(label) || HIDDEN_MAILBOX_RE.test(base)) {
      return false;
    }
    // Keep user labels visible even when empty; hide other empties
    if (f.role === "OTHER") return true;
    return (f.messageCount ?? 0) > 0;
  });
}

/**
 * State for the post-correction suggestion toast — shown after either
 * "Move to…" (custom label) or a smart-label chip correction, offering to
 * (a) retroactively apply to existing similar mail and/or (b) create a
 * standing rule for future mail. Nothing here ever executes automatically;
 * every field beyond the base suggestion is filled in only after an
 * explicit button click.
 */
type LabelSuggestionState = {
  sourceThreadId: string;
  targetLabel: string;
  targetLabelDisplay: string;
  isSmartLabel: boolean;
  fromContains: string | null;
  subjectContains: string | null;
  ruleName: string;
  folderId?: string;
  folderName?: string;
  /** Every existing match — reviewable/deselectable before applying. */
  matches: MatchingThreadPreview[];
  matchesCapped: boolean;
  /** Which matches are currently checked to be included in "Apply to N". */
  selectedIds: Set<string>;
  /** Whether the review checklist panel is expanded. */
  showMatches: boolean;
  applyResult?: { count: number; snapshot: LabelCorrectionSnapshot | null };
  ruleCreated?: boolean;
};

/** Post-"Report spam" "these look like the same campaign too" toast —
 * a leaner sibling of LabelSuggestionState: no standing-rule concept
 * (that's the sender-feedback table, built automatically) and no
 * folder/smart-label branching (always the same Junk move). Undo simply
 * re-runs "Not spam" on the applied ids — real IMAP move back, not a
 * local-only snapshot restore. */
type SpamSuggestionState = {
  sourceThreadId: string;
  matches: MatchingThreadPreview[];
  matchesCapped: boolean;
  selectedIds: Set<string>;
  showMatches: boolean;
  applyResult?: { count: number; appliedIds: string[] };
};

type Signature = { id: string; name: string; htmlBody: string; isDefault: boolean };
type Reminder = {
  id: string;
  note: string | null;
  dueAt: string | Date;
  kind: string;
  threadId?: string | null;
};

type AskCitation = {
  messageId: string;
  threadId: string;
  subject: string;
};
type Msg = MailMessageView & {
  rfcMessageId: string | null;
  inReplyTo?: string | null;
  referencesHdr?: string | null;
};

function parseAddrJson(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

/** Reply headers + recipients that respect Sent/Drafts (don't reply to yourself). */
function replyContext(
  messages: Msg[],
  opts: {
    folderRole?: string | null;
    myAddress?: string | null;
    /** "reply-all" folds every other original To/Cc recipient into Cc. */
    mode?: "reply" | "reply-all";
  },
) {
  const last = messages[messages.length - 1];
  if (!last) {
    return { to: "", cc: "", inReplyTo: undefined as string | undefined, referencesHdr: undefined as string | undefined, subject: "" };
  }
  const me = (opts.myAddress || "").toLowerCase();
  const fromMe =
    opts.folderRole === "SENT" ||
    opts.folderRole === "DRAFTS" ||
    (me && last.fromAddress.toLowerCase() === me);
  const mode = opts.mode ?? "reply";

  const toList = fromMe
    ? parseAddrJson(last.toAddresses)
    : [last.fromAddress].filter(Boolean);

  let ccList: string[];
  if (fromMe) {
    ccList = parseAddrJson(last.ccAddresses);
  } else if (mode === "reply-all") {
    const exclude = new Set(
      [me, last.fromAddress.toLowerCase()].filter(Boolean),
    );
    ccList = Array.from(
      new Set([
        ...parseAddrJson(last.toAddresses),
        ...parseAddrJson(last.ccAddresses),
      ]),
    ).filter((addr) => !exclude.has(addr.toLowerCase()));
  } else {
    ccList = [];
  }

  const subject = last.subject.toLowerCase().startsWith("re:")
    ? last.subject
    : `Re: ${last.subject}`;

  const rfc = last.rfcMessageId || undefined;
  const prior = (last.referencesHdr || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const referencesHdr = rfc
    ? Array.from(new Set([...prior, rfc])).join(" ")
    : undefined;

  return {
    to: toList.join(", "),
    cc: ccList.join(", "),
    inReplyTo: rfc,
    referencesHdr,
    subject,
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatQuoteDate(d: string | Date) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Attribution line + blockquote of the message being replied to, so a manual (non-AI) reply still carries visible context. */
function buildQuoteBlock(m: Msg): string {
  const who = m.fromName ? `${escapeHtml(m.fromName)} <${escapeHtml(m.fromAddress)}>` : escapeHtml(m.fromAddress);
  const body = prepareMailHtml(m.bodyHtml, m.bodyText, "original");
  return `<p>On ${formatQuoteDate(m.date)}, ${who} wrote:</p><blockquote>${body}</blockquote>`;
}

/** Gmail-style "---------- Forwarded message ---------" header + embedded original body. */
function buildForwardBlock(m: Msg): string {
  const from = m.fromName ? `${escapeHtml(m.fromName)} <${escapeHtml(m.fromAddress)}>` : escapeHtml(m.fromAddress);
  const to = parseAddrJson(m.toAddresses).join(", ");
  const body = prepareMailHtml(m.bodyHtml, m.bodyText, "original");
  return (
    `<p>---------- Forwarded message ---------<br>` +
    `From: ${from}<br>` +
    `Date: ${formatQuoteDate(m.date)}<br>` +
    `Subject: ${escapeHtml(m.subject)}<br>` +
    `To: ${escapeHtml(to)}</p><blockquote>${body}</blockquote>`
  );
}

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };
const listStagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.035, delayChildren: 0.05 },
  },
};
const listItem = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: spring },
};

function priorityTone(p: string) {
  if (p === "P1") return { bg: "rgba(249,115,22,0.22)", fg: "#fdba74" };
  if (p === "P2") return { bg: "rgba(200,245,66,0.18)", fg: "#c8f542" };
  if (p === "P3") return { bg: "rgba(139,92,246,0.22)", fg: "#c4b5fd" };
  if (p === "P4") return { bg: "rgba(255,255,255,0.06)", fg: "#a1a1aa" };
  return null;
}

function systemFolderIcon(role: string) {
  const size = 16;
  switch (role) {
    case "INBOX":
      return <InboxIcon size={size} />;
    case "SENT":
      return <Send size={size} />;
    case "DRAFTS":
      return <FileText size={size} />;
    case "TRASH":
      return <Trash2 size={size} />;
    case "JUNK":
      return <ShieldAlert size={size} />;
    default:
      return <FileText size={size} />;
  }
}

function labelTone(label: string) {
  const h = [...label].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;
  const tones = [
    { bg: "rgba(139,92,246,0.22)", fg: "#c4b5fd" },
    { bg: "rgba(200,245,66,0.16)", fg: "#d9f99d" },
    { bg: "rgba(249,115,22,0.2)", fg: "#fdba74" },
    { bg: "rgba(236,72,153,0.2)", fg: "#f9a8d4" },
    { bg: "rgba(56,189,248,0.18)", fg: "#7dd3fc" },
  ];
  return tones[h]!;
}

function threadInitials(subject: string) {
  const clean = subject.replace(/^(re|fwd?):\s*/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (clean.slice(0, 2) || "??").toUpperCase();
}

function avatarHue(seed: string) {
  return [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
}

/** Short human label for an account switcher row / badge. The primary
 * (ceo_env) mailbox's displayName is stored as a full RFC822 "Name
 * <email>" string (it's built for the SMTP From header, not UI display),
 * so a bare `displayName || address` fallback renders that whole string —
 * extract just the name part when it's in that shape. */
function accountShortName(a: { displayName: string | null; address: string }) {
  const m = a.displayName?.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  const name = m?.[1]?.trim() || a.displayName?.trim();
  return name || a.address.split("@")[0] || a.address;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Deterministic local wall-clock formatting (no locale/AM-PM drift).
 * Still TZ-sensitive for "today" — pair with suppressHydrationWarning in SSR.
 */
function formatWhen(d: string | Date) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** Ticking "synced Xs/m/h ago" so the header doesn't look frozen between syncs. */
function formatSyncedAgo(d: string | Date, nowMs: number) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.max(0, Math.round((nowMs - date.getTime()) / 1000));
  if (diffSec < 5) return "synced just now";
  if (diffSec < 60) return `synced ${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `synced ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `synced ${diffHr}h ago`;
  return `synced ${formatWhen(date)}`;
}

/**
 * "Deleted Xh/d ago" for the Trash view — retention context, not a sort key.
 * The thread list itself still sorts/displays by lastMessageAt (original
 * sent/received date), same as Gmail/Outlook/Apple Mail: trashing a message
 * doesn't change when it was sent.
 */
function formatDeletedAgo(d: string | Date) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "Deleted just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Deleted ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Deleted ${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Deleted ${diffDay}d ago`;
}

function FolderSection({
  title,
  open,
  onToggle,
  action,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-left"
          style={{ background: "transparent", border: "none" }}
        >
          <span
            className="text-[0.6rem] transition-transform"
            style={{
              color: "var(--mail-dim)",
              transform: open ? "rotate(0deg)" : "rotate(-90deg)",
              display: "inline-block",
            }}
          >
            ▾
          </span>
          <span
            className="truncate text-[0.65rem] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--mail-dim)" }}
          >
            {title}
          </span>
        </button>
        {action}
      </div>
      {open && <div className="space-y-0.5 px-0.5 pb-1">{children}</div>}
    </div>
  );
}

function FolderRow({
  name,
  badge,
  active,
  onClick,
  compact,
  icon,
}: {
  name: string;
  badge: string;
  active: boolean;
  onClick: () => void;
  /** Icon-rail mode: just an icon, full name as tooltip. */
  compact?: boolean;
  icon?: React.ReactNode;
}) {
  if (compact) {
    return (
      <button
        type="button"
        title={name}
        aria-label={name}
        onClick={onClick}
        className="mx-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors"
        style={{
          background: active ? "var(--mail-purple-dim)" : "transparent",
          color: active ? "#c4b5fd" : "var(--mail-muted)",
        }}
      >
        {icon ?? <span className="text-[0.6rem] font-semibold">{badge.slice(0, 2)}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mail-folder-item flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${active ? "is-active" : ""}`}
      style={{
        background: active ? undefined : "transparent",
        color: active ? undefined : "var(--mail-muted)",
      }}
    >
      <span className="truncate font-medium">{name}</span>
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold"
        style={{
          background: active ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.06)",
          color: active ? "#fff" : "var(--mail-dim)",
        }}
      >
        {badge}
      </span>
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  disabled,
  primary,
  danger,
  bare,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** No pill background/border — for use inside an already-grouped cluster. */
  bare?: boolean;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={bare ? { opacity: 1 } : { y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={() => {
        haptic(danger ? "warn" : "tap");
        onClick();
      }}
      className={`cursor-pointer rounded-full text-xs font-semibold tracking-wide disabled:cursor-not-allowed disabled:opacity-40 ${bare ? "px-2 py-1 opacity-80 hover:opacity-100" : "px-3.5 py-2"} ${primary ? "mail-cta-primary" : ""}`}
      style={
        primary || bare
          ? bare
            ? { color: "var(--text-muted)" }
            : undefined
          : {
              background: danger ? "rgba(239,68,68,0.12)" : "var(--bg-elevated)",
              color: danger ? "#f87171" : "var(--text-muted)",
              border: "1px solid var(--border-strong)",
            }
      }
    >
      {children}
    </motion.button>
  );
}

/** Compact icon-only action, Gmail/Outlook-style toolbar. Title = tooltip. */
function IconBtn({
  icon,
  title,
  onClick,
  disabled,
  danger,
  active,
  primary,
  size = "md",
}: {
  icon: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  /** Gradient CTA styling for a primary action (e.g. Reply). */
  primary?: boolean;
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "h-9 w-9" : "h-8 w-8";
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      whileHover={{ y: -1, scale: 1.06 }}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      onClick={(e) => {
        haptic(danger ? "warn" : "tap");
        onClick(e);
      }}
      className={`flex ${dim} shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "mail-cta-primary" : ""}`}
      style={
        primary
          ? { border: "none", color: "#fff" }
          : {
              background: active
                ? "var(--mail-purple-dim)"
                : danger
                  ? "rgba(239,68,68,0.12)"
                  : "var(--bg-elevated)",
              color: active
                ? "#c4b5fd"
                : danger
                  ? "#f87171"
                  : "var(--text-muted)",
              border: "1px solid var(--border-strong)",
            }
      }
    >
      {icon}
    </motion.button>
  );
}

/**
 * The AI "sparkle" glyph, animated everywhere it appears (top command bar,
 * compose send-bar toggle, AI assist panel header) — a slow twinkle/glow loop
 * so it reads as "alive"/AI, not a static icon. Module-level so it never
 * causes the nested-component remount issue.
 */
function AnimatedSparkle({
  size = 14,
  color = "var(--accent-bright)",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <motion.span
      className={`inline-flex shrink-0 ${className || ""}`}
      style={{ color }}
      animate={{
        rotate: [0, 12, -8, 0],
        scale: [1, 1.16, 1],
        filter: [
          "drop-shadow(0 0 0px currentColor)",
          "drop-shadow(0 0 4px currentColor)",
          "drop-shadow(0 0 0px currentColor)",
        ],
      }}
      transition={{
        duration: 2.4,
        repeat: Infinity,
        ease: "easeInOut",
        repeatDelay: 0.6,
      }}
    >
      <Sparkles size={size} />
    </motion.span>
  );
}

type ContactSuggestion = { address: string; displayName: string | null };

/** The comma/semicolon-separated fragment currently being typed, plus everything before it. */
function lastRecipientFragment(value: string) {
  const idx = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
  const prefix = idx >= 0 ? `${value.slice(0, idx + 1)} ` : "";
  const fragment = (idx >= 0 ? value.slice(idx + 1) : value).trim();
  return { prefix, fragment };
}

/**
 * A To/Cc/Bcc input with a contact-suggestion dropdown. Module-level (not
 * nested inside MailClient) so it never remounts/loses focus on parent
 * re-renders — the same fix that was needed for the AI-assist panel.
 */
function RecipientAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  wrapClassName,
  accountId,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wrapClassName?: string;
  accountId?: string;
}) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function scheduleLookup(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const { fragment } = lastRecipientFragment(v);
    if (fragment.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void findContactsAction(fragment, accountId)
        .then((rows) => {
          setSuggestions(rows);
          setOpen(rows.length > 0);
          setActiveIndex(0);
        })
        .catch(() => {
          setSuggestions([]);
          setOpen(false);
        });
    }, 200);
  }

  function acceptSuggestion(s: ContactSuggestion) {
    const { prefix } = lastRecipientFragment(value);
    const insertion = s.displayName ? `${s.displayName} <${s.address}>` : s.address;
    onChange(`${prefix}${insertion}, `);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={wrapRef} className={`relative ${wrapClassName || ""}`}>
      <input
        id={id}
        placeholder={placeholder}
        value={value}
        autoComplete="email"
        onChange={(e) => {
          onChange(e.target.value);
          scheduleLookup(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || !suggestions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            acceptSuggestion(suggestions[activeIndex]!);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 top-full z-20 mt-1 max-h-48 w-72 overflow-auto rounded-xl p-1 text-xs shadow-lg"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.address}>
              <button
                type="button"
                className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                style={{
                  background:
                    i === activeIndex ? "var(--mail-purple-dim)" : "transparent",
                  color: "var(--text)",
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => acceptSuggestion(s)}
              >
                <div className="truncate font-medium">
                  {s.displayName || s.address}
                </div>
                {s.displayName && (
                  <div
                    className="truncate text-[0.65rem]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {s.address}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type InlineOpts = {
  sources?: Map<string, AskCitation>;
  onOpen?: (threadId: string) => void;
};

/**
 * Inline markdown: **bold**, `code`, and [[messageId]] citation markers →
 * a small clickable mail icon that opens that message's thread. Safe (no HTML).
 */
function renderInlineMarkdown(
  text: string,
  opts?: InlineOpts,
): React.ReactNode[] {
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g)
    .filter(Boolean);
  return parts.map((p, i) => {
    const cite = p.match(/^\[\[([^\]]+)\]\]$/);
    if (cite) {
      const ref = opts?.sources?.get(cite[1]!.trim());
      if (!ref || !opts?.onOpen) return null;
      return (
        <button
          key={i}
          type="button"
          title={`Open: ${ref.subject}`}
          onClick={() => opts.onOpen!(ref.threadId)}
          className="mx-0.5 inline-flex h-4 w-4 -translate-y-px cursor-pointer items-center justify-center rounded align-middle transition-colors hover:brightness-125"
          style={{
            background: "rgba(139,92,246,0.2)",
            border: "1px solid rgba(139,92,246,0.4)",
            color: "var(--accent-bright)",
          }}
        >
          <MailIcon size={10} />
        </button>
      );
    }
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return (
        <strong key={i} style={{ color: "var(--text)", fontWeight: 600 }}>
          {bold[1]}
        </strong>
      );
    }
    const code = p.match(/^`([^`]+)`$/);
    if (code) {
      return (
        <code
          key={i}
          className="rounded px-1 text-[0.95em]"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          {code[1]}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/**
 * Render a model answer with light markdown (numbered/bulleted lists, bold) and
 * inline [[messageId]] citations rendered as clickable mail links.
 */
function FormattedAnswer({
  text,
  sources,
  onOpen,
}: {
  text: string;
  sources?: Map<string, AskCitation>;
  onOpen?: (threadId: string) => void;
}) {
  const opts: InlineOpts = { sources, onOpen };
  const lines = text.split(/\r?\n/);
  return (
    <div
      className="space-y-1 text-xs leading-relaxed"
      style={{ color: "var(--text-muted)" }}
    >
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2">
              <span
                className="shrink-0 font-semibold"
                style={{ color: "var(--accent-bright)" }}
              >
                {numbered[1]}.
              </span>
              <span>{renderInlineMarkdown(numbered[2]!, opts)}</span>
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*•]\s+(.*)/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span
                className="shrink-0"
                style={{ color: "var(--accent-bright)" }}
              >
                •
              </span>
              <span>{renderInlineMarkdown(bullet[1]!, opts)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineMarkdown(line, opts)}</p>;
      })}
    </div>
  );
}

/**
 * Read-only preview of the message being replied to — shown in fullscreen
 * compose (where the reader pane is hidden) so you keep the context in view.
 */
function ReplyContextCard({
  message,
  subject,
}: {
  message: MailMessageView;
  subject?: string;
}) {
  // Collapsed by default — this is quoted context, not the thing being
  // written; expand on demand rather than eating vertical space up front.
  const [open, setOpen] = useState(false);
  // Same rich rendering as the reader pane (sanitized HTML, dark-adapted) —
  // images/links intact instead of a stripped text dump.
  const html = prepareMailHtml(message.bodyHtml, message.bodyText, "dark");
  const who = message.fromName || message.fromAddress;
  return (
    <details
      open={open}
      className="shrink-0 overflow-hidden rounded-xl"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-sm"
        style={{ color: "var(--text-dim)" }}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
          haptic("tap");
        }}
      >
        <ReplyIcon size={14} style={{ color: "var(--accent-bright)" }} />
        <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
          Replying to {who}
        </span>
        {subject ? <span className="truncate">· {subject}</span> : null}
        <span
          title={open ? "Hide trimmed content" : "Show trimmed content"}
          aria-label={open ? "Hide trimmed content" : "Show trimmed content"}
          className="ml-auto flex shrink-0 items-center justify-center rounded-full px-1.5 py-0.5"
          style={{ color: "var(--text-dim)", background: "rgba(255,255,255,0.06)" }}
        >
          <MoreHorizontal size={14} />
        </span>
      </summary>
      {/* Scroll lives on this wrapper — .mail-message-body sets
          overflow-y:hidden (shell containment), which would clip the quote. */}
      <div className="max-h-64 overflow-y-auto px-3.5 pb-3">
        <div
          className="mail-message-body mail-dark-adapt"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </details>
  );
}

export function MailClient({
  configured,
  account,
  folders,
  threads: initialThreads,
  signatures,
  reminders: initialReminders,
}: {
  configured: boolean;
  account?: { id: string; address: string; lastSyncedAt: Date | string | null };
  folders: Folder[];
  threads: Thread[];
  signatures: Signature[];
  reminders: Reminder[];
}) {
  const [folderList, setFolderList] = useState(folders);
  const [activeFolder, setActiveFolder] = useState<string | null>(
    folders.find((f) => f.role === "INBOX")?.id ?? folders[0]?.id ?? null,
  );
  const [threads, setThreads] = useState(initialThreads);
  const [reminders, setReminders] = useState(initialReminders);
  const [accountInfo, setAccountInfo] = useState(account);
  const [sigList, setSigList] = useState<SignatureRow[]>(signatures);
  const [showSignatures, setShowSignatures] = useState(false);
  const [showVacation, setShowVacation] = useState(false);
  const [showMailboxes, setShowMailboxes] = useState(false);
  const [showCalendarPanel, setShowCalendarPanel] = useState(false);
  const [scheduleMeetingDefaults, setScheduleMeetingDefaults] = useState<{
    title: string;
    attendees: string[];
  } | null>(null);
  const [mailAccounts, setMailAccounts] = useState<MailAccountSummary[]>([]);
  // Loaded once at mount (not just when opening the Mailboxes settings
  // panel) so the sidebar switcher has the mailbox list without waiting
  // on the user to open Settings first.
  useEffect(() => {
    listMailAccountsAction().then(setMailAccounts).catch(() => undefined);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The open thread's own mailbox — matters in the unified "All Inboxes"
   * view, where the sidebar's "active" account (accountInfo) may not be
   * the open thread's account at all. Derived (not stored) so it can never
   * go stale relative to `threads`/`selectedId`. Reply/save-draft/send use
   * this, falling back to accountInfo for a brand-new, non-reply compose
   * (selectedId is null then), so a reply always sends from the account
   * the thread actually belongs to rather than whatever's active in the
   * sidebar. */
  const composeAccountId =
    threads.find((t) => t.id === selectedId)?.accountId ?? accountInfo?.id;
  const composeAccountAddress =
    (composeAccountId
      ? mailAccounts.find((a) => a.id === composeAccountId)?.address
      : null) ?? accountInfo?.address;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [composeHtml, setComposeHtml] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [composeFullscreen, setComposeFullscreen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  /** Preserved when opening a local draft (messages[] is empty). */
  const [composeHeaders, setComposeHeaders] = useState<{
    inReplyTo?: string;
    referencesHdr?: string;
  }>({});
  const [refineNote, setRefineNote] = useState("");
  /** Brief for AI Draft on a fresh (non-reply) email */
  const [composeBrief, setComposeBrief] = useState("");
  /** Gmail-style: the AI assist panel opens from a sparkle toggle, not always-on. */
  const [showAiAssist, setShowAiAssist] = useState(false);
  const [composeDragActive, setComposeDragActive] = useState(false);
  /** Schedule-send picker lives behind a clock icon, not inline in the bar. */
  const [showSchedule, setShowSchedule] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<
    ComposeAttachment[]
  >([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  /** Gmail-style: the docked reply is an in-flow card at the end of the thread — scroll it into view when it opens. */
  const composeCardRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  /** Mailbox/thread-list loads — must NOT share `pending` or compose buttons freeze */
  const [, startNavTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingSend, setPendingSend] = useState<{
    outboxId: string;
    to: string;
    /**
     * Full compose state at the moment Send was clicked, held so Undo can
     * restore it exactly — including which view (docked vs fullscreen) it
     * was in. Without this, undo only flipped showCompose back on while
     * composeFullscreen stayed reset to false from the send handler, so a
     * fullscreen compose (which has no docked equivalent outside an open
     * thread) silently reopened as nothing at all.
     */
    snapshot: {
      to: string;
      cc: string;
      bcc: string;
      subject: string;
      composeHtml: string;
      composeHeaders: { inReplyTo?: string; referencesHdr?: string };
      composeBrief: string;
      draftId: string | null;
      composeFullscreen: boolean;
      composeAttachments: ComposeAttachment[];
    };
  } | null>(null);
  const pendingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [undoWindowSec, setUndoWindowSecState] = useState<10 | 20>(10);
  useEffect(() => {
    const saved = Number(localStorage.getItem("mail-undo-window-sec"));
    if (saved === 10 || saved === 20) setUndoWindowSecState(saved);
  }, []);
  function setUndoWindowSec(v: 10 | 20) {
    setUndoWindowSecState(v);
    try {
      localStorage.setItem("mail-undo-window-sec", String(v));
    } catch {
      /* ignore */
    }
    haptic("tap");
  }
  /** Visible Sync / Categorize progress (bar under header). */
  const [jobProgress, setJobProgress] = useState<{
    kind: "sync" | "categorize";
    label: string;
    current?: number;
    total?: number;
  } | null>(null);
  /** Avoid SSR/client locale/TZ mismatches for relative times */
  const [timesReady, setTimesReady] = useState(false);
  useEffect(() => {
    setTimesReady(true);
  }, []);
  /** Ticks so "synced Xs/m ago" advances instead of freezing at the last sync's wall-clock time. */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  /** When false, a background draft save must not reattach draftId (e.g. after opening a thread). */
  const attachDraftIdRef = useRef(true);
  /**
   * Every write to `threads` that comes from an async fetch (folder switch,
   * post-mutation reload, search) claims a ticket here first and only
   * applies its result if it's still the latest one issued. Without this,
   * two overlapping fetches — e.g. trashing a thread (which reloads the
   * folder you were on) racing a folder switch you click a moment later —
   * can resolve out of order and let the slower, stale request's data
   * silently overwrite the newer folder's correct list, leaving the
   * sidebar highlighting one mailbox while the thread list still shows
   * another.
   */
  const threadsFetchSeqRef = useRef(0);
  /** The scrollable Threads <ul> — reset to the top on every mailbox/page switch. */
  const threadsListRef = useRef<HTMLUListElement>(null);
  /** Always the current render's reloadActiveView — see its assignment site. */
  const reloadActiveViewRef = useRef<() => Promise<void>>(async () => {});
  /** The live-update SSE subscription only connects once ([configured]), so
   * it must read these through refs rather than closing over accountInfo/
   * activeFolder directly — otherwise it would always compare against
   * whichever account was active at mount/subscribe time. */
  const accountInfoRef = useRef(accountInfo);
  const activeFolderRef = useRef(activeFolder);
  const threadQueryRef = useRef("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  /**
   * Snapshot of the auto-populated reply-context fields (To/Cc/Bcc/Subject/
   * signature-only body) at the moment a thread/draft/new-compose opens.
   * composeIsDirty() compares against this instead of raw truthy checks — a
   * pre-filled "To: sender@x.com" is NOT dirty on its own; only an actual edit
   * beyond what was auto-populated is. Fixes drafts being silently saved for
   * threads the user only opened Reply on without typing anything.
   */
  const composeBaselineRef = useRef({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    html: "",
  });
  function snapshotComposeBaseline(vals: {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    html: string;
  }) {
    composeBaselineRef.current = vals;
  }
  const [liveConnected, setLiveConnected] = useState(false);
  const [desktopNotifsEnabled, setDesktopNotifsEnabled] = useState(false);
  const desktopNotifsRef = useRef(false);
  const [status, setStatus] = useState("");
  const [askQ, setAskQ] = useState("");
  const [askA, setAskA] = useState("");
  const [askThinking, setAskThinking] = useState(false);
  const [askCitations, setAskCitations] = useState<AskCitation[]>([]);
  const [askSources, setAskSources] = useState<AskCitation[]>([]);
  /** Prior turns in this Ask session — sent back on every follow-up so
   * "and when was that sent?" can resolve against the previous answer
   * instead of being treated as a brand-new, context-free question. */
  const [askHistory, setAskHistory] = useState<
    { question: string; answer: string }[]
  >([]);
  const [sendAtLocal, setSendAtLocal] = useState("");
  const [bulkSuggestions, setBulkSuggestions] = useState<
    { threadId: string; subject: string; priority: string; labels: string[] }[]
  >([]);
  const [showRules, setShowRules] = useState(false);
  const [labelRules, setLabelRules] = useState<
    {
      id: string;
      name: string;
      label: string;
      matchJson: string;
      enabled: boolean;
      origin?: string;
      sourceThreadId?: string | null;
    }[]
  >([]);
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    label: "NEWSLETTER",
    fromContains: "",
    subjectContains: "",
  });
  /** Post-correction "apply to similar / always do this" toast. */
  const [labelSuggestion, setLabelSuggestion] = useState<LabelSuggestionState | null>(
    null,
  );
  const labelSuggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Post-"Report spam" "same campaign?" toast. */
  const [spamSuggestion, setSpamSuggestion] = useState<SpamSuggestionState | null>(
    null,
  );
  const spamSuggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Which smart-label chip's correction popover is open, keyed by its current label value. */
  const [smartLabelMenuFor, setSmartLabelMenuFor] = useState<string | null>(null);
  const [digest, setDigest] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  // Bring the inline reply card into view when it opens (after layout settles).
  useEffect(() => {
    if (showCompose && !composeFullscreen) {
      const t = window.setTimeout(() => {
        composeCardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [showCompose, composeFullscreen]);
  const [threadFilter, setThreadFilter] = useState<"all" | "unread" | "priority">(
    "all",
  );
  const [threadQuery, setThreadQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [threadPage, setThreadPage] = useState(1);
  const [threadTotal, setThreadTotal] = useState(0);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectModeEnabled, setSelectModeEnabled] = useState(false);
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [activeSmartLabel, setActiveSmartLabel] = useState<SmartLabel | null>(
    null,
  );
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  /** Escape hatch for "focus mode" (see composingDocked below) — docking a
   * reply/draft normally hides the thread list entirely to give the reader
   * more room, with no way back short of closing compose. Pinning brings
   * the list back alongside a docked compose without leaving it. */
  const [threadsPinnedWhileComposing, setThreadsPinnedWhileComposing] =
    useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [mailboxesOpen, setMailboxesOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(true);
  const [smartOpen, setSmartOpen] = useState(true);
  const [newLabelName, setNewLabelName] = useState("");
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [commitments, setCommitments] = useState<
    { title: string; dueAt?: string | null; priority?: string }[]
  >([]);
  const [threadTasks, setThreadTasks] = useState<
    { id: string; title: string; status: string; dueAt: string | Date | null }[]
  >([]);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [remindAt, setRemindAt] = useState("");
  // Any open toolbar dropdown (Priority / Move to / Snooze / More / Schedule)
  // closes on a click anywhere except inside a menu (trigger + list carry data-menu).
  useEffect(() => {
    if (
      !showMoveMenu &&
      !showSnoozeMenu &&
      !showMoreMenu &&
      !showPriorityMenu &&
      !showSchedule &&
      !showBulkMoveMenu &&
      !showSettingsMenu &&
      !smartLabelMenuFor
    ) {
      return;
    }
    const onPointerDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-menu]")) return;
      setShowMoveMenu(false);
      setShowSnoozeMenu(false);
      setShowMoreMenu(false);
      setShowPriorityMenu(false);
      setShowSchedule(false);
      setShowBulkMoveMenu(false);
      setShowSettingsMenu(false);
      setSmartLabelMenuFor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [
    showMoveMenu,
    showSnoozeMenu,
    showMoreMenu,
    showPriorityMenu,
    showSchedule,
    showBulkMoveMenu,
    showSettingsMenu,
    smartLabelMenuFor,
  ]);

  const systemFolders = useMemo(
    () => pickSystemFolders(folderList),
    [folderList],
  );
  const labelFolders = useMemo(
    () => pickLabelFolders(folderList),
    [folderList],
  );
  const labelFolderTree = useMemo(
    () => buildFolderTree(labelFolders),
    [labelFolders],
  );

  const defaultSig = useMemo(
    () => sigList.find((s) => s.isDefault)?.htmlBody || "",
    [sigList],
  );

  // Threads opened from an Ask citation may not be in the current folder list;
  // hold a synthesized row so the reader still renders.
  const [selectedThreadFallback, setSelectedThreadFallback] =
    useState<Thread | null>(null);
  const selectedThread =
    threads.find((t) => t.id === selectedId) ||
    (selectedThreadFallback?.id === selectedId ? selectedThreadFallback : null);
  const viewingJunk =
    folderList.find((f) => f.id === activeFolder)?.role === "JUNK";

  // Ask: map for resolving inline [[messageId]] citations, and whether the
  // answer actually carries any (so the fallback source list can be hidden).
  const askSourcesMap = useMemo(
    () => new Map(askSources.map((s) => [s.messageId, s])),
    [askSources],
  );
  const askHasInlineCitations = useMemo(() => {
    if (!askSourcesMap.size || !askA) return false;
    return [...askA.matchAll(/\[\[([^\]]+)\]\]/g)].some((m) =>
      askSourcesMap.has(m[1]!.trim()),
    );
  }, [askA, askSourcesMap]);

  // Focus mode: when a reply/compose is docked open, collapse the thread list
  // and give the reader the freed columns (restores when the reply closes) —
  // unless the user has pinned the list back via threadsPinnedWhileComposing,
  // the only way to see other threads while a reply/draft stays open
  // otherwise (previously there was none at all: docking any reply, or a
  // draft opened from the Drafts folder, hid the thread list until compose
  // fully closed, with no escape hatch).
  const composingDocked = showCompose && !composeFullscreen;
  const hideThreadsForFocus = composingDocked && !threadsPinnedWhileComposing;
  const readerSpanClass = hideThreadsForFocus
    ? foldersCollapsed
      ? "lg:col-span-[23]"
      : "lg:col-span-[20]"
    : "lg:col-span-[14]";

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (threadFilter === "unread" && t.unreadCount <= 0) return false;
      if (threadFilter === "priority" && !["P1", "P2"].includes(t.priority)) {
        return false;
      }
      return true;
    });
  }, [threads, threadFilter]);

  function navigateThread(dir: 1 | -1) {
    if (!filteredThreads.length) return;
    const idx = filteredThreads.findIndex((t) => t.id === selectedId);
    let next = idx === -1 ? (dir === 1 ? 0 : filteredThreads.length - 1) : idx + dir;
    next = Math.max(0, Math.min(filteredThreads.length - 1, next));
    const t = filteredThreads[next];
    if (t) openThread(t.id);
  }

  // Keyboard shortcuts (Superhuman/Gmail-style). Fresh-closure ref so we
  // subscribe once but always read current state.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing =
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          "input, textarea, select, [contenteditable='true'], .ProseMirror",
        ),
      );
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key === "Enter") {
      if ((showCompose || composeFullscreen) && to.trim() && !sending) {
        e.preventDefault();
        sendCurrentDraft();
      }
      return;
    }
    if (e.key === "Escape") {
      if (showShortcutHelp) {
        setShowShortcutHelp(false);
      } else if (selectedThreadIds.size > 0) {
        setSelectedThreadIds(new Set());
      } else if (showMoveMenu || showSnoozeMenu || showMoreMenu || showPriorityMenu) {
        setShowMoveMenu(false);
        setShowSnoozeMenu(false);
        setShowMoreMenu(false);
        setShowPriorityMenu(false);
      } else if (composeFullscreen) {
        closeCompose("exit-fullscreen");
      } else if (showCompose) {
        closeCompose("hide");
      } else if (target instanceof HTMLElement) {
        target.blur();
      }
      return;
    }
    // Single-key shortcuts only fire outside text fields / modifiers.
    if (typing || meta || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case "r":
        if (
          selectedThread &&
          !showCompose &&
          !selectedId?.startsWith("outbox")
        ) {
          e.preventDefault();
          setShowCompose(true);
          haptic("tap");
        }
        break;
      case "c":
        e.preventDefault();
        composeNew();
        break;
      case "j":
        e.preventDefault();
        navigateThread(1);
        break;
      case "k":
        e.preventDefault();
        navigateThread(-1);
        break;
      case "e":
        if (selectedId && !selectedId.startsWith("outbox")) {
          e.preventDefault();
          archiveSelected();
        }
        break;
      case "a":
        if (
          selectedThread &&
          !showCompose &&
          !selectedId?.startsWith("outbox")
        ) {
          e.preventDefault();
          replyAll();
        }
        break;
      case "f":
        if (
          selectedThread &&
          !showCompose &&
          !selectedId?.startsWith("outbox")
        ) {
          e.preventDefault();
          composeForward();
        }
        break;
      case "x":
        if (selectedId && !selectedId.startsWith("outbox")) {
          e.preventDefault();
          toggleThreadSelected(selectedId);
          haptic("tap");
        }
        break;
      case "#":
        if (selectedId && !selectedId.startsWith("outbox")) {
          e.preventDefault();
          trashSelected();
        }
        break;
      case "/":
        e.preventDefault();
        searchInputRef.current?.focus();
        break;
      case "?":
        e.preventDefault();
        setShowShortcutHelp(true);
        break;
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Tiered search: contacts / FTS / AI-NL (see rag-search-plan §3.2)
  useEffect(() => {
    const q = threadQuery.trim();
    if (q.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    setStatus("Searching…");
    const handle = window.setTimeout(() => {
      const seq = ++threadsFetchSeqRef.current;
      startNavTransition(async () => {
        const startedAt = performance.now();
        try {
          // Browsing a real folder (Drafts/Sent/Trash/a custom folder — not
          // Smart Inbox/All Inboxes/Outbox, which are cross-folder views)
          // implicitly scopes search to it, same as browsing already does;
          // an explicit in:/folder: operator in the query overrides this
          // server-side regardless of what's passed here.
          const isRealFolder =
            activeFolder &&
            activeFolder !== SMART_INBOX_ID &&
            activeFolder !== ALL_INBOXES_ID &&
            activeFolder !== OUTBOX_ID &&
            !activeSmartLabel;
          const { rows, mode } = await searchThreadsAction(
            q,
            accountInfo?.id,
            isRealFolder ? { folderId: activeFolder } : undefined,
          );
          const elapsedMs = Math.round(performance.now() - startedAt);
          if (threadsFetchSeqRef.current !== seq) return;
          setThreads(rows as Thread[]);
          setActiveSmartLabel(null);
          setStatus(
            rows.length
              ? `Search · ${rows.length} result${rows.length === 1 ? "" : "s"} · ${elapsedMs}ms (${mode})`
              : `Search · no matches · ${elapsedMs}ms (${mode})`,
          );
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "Search failed");
        } finally {
          setSearching(false);
        }
      });
    }, 320);
    return () => window.clearTimeout(handle);
  }, [threadQuery, accountInfo?.id, activeFolder, activeSmartLabel]);

  // Restore folder / smart-label view when search is cleared
  useEffect(() => {
    if (threadQuery.trim().length >= 2) return;
    setStatus((prev) => (prev.startsWith("Search") ? "" : prev));
    startNavTransition(async () => {
      await reloadActiveView();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadQuery]);

  useEffect(() => {
    // These props always describe the *primary* mailbox — page.tsx's server
    // component calls getMailBootstrap() with no accountId, and Next.js
    // re-runs it on every revalidatePath() a mutating action triggers. If
    // the user has switched to a different mailbox via the sidebar
    // switcher, blindly applying these on the next revalidation would
    // silently snap the view back to primary out from under them.
    if (accountInfo && account && accountInfo.id !== account.id) return;
    setFolderList(folders);
    setAccountInfo(account);
    setReminders(initialReminders);
    setSigList(signatures);
    // Default landing: Smart Inbox (bootstrap is already curated)
    if (!activeFolder && folders.length) {
      setActiveFolder(SMART_INBOX_ID);
      setThreads(initialThreads);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, account, initialReminders, signatures]);

  // Keep the list scoped to the selected mailbox / smart label / outbox / page
  useEffect(() => {
    if (!configured) return;
    if (threadQuery.trim().length >= 2) return;
    setSelectedThreadIds(new Set());
    startNavTransition(async () => {
      await reloadActiveView(threadPage);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, activeFolder, activeSmartLabel, threadPage]);

  // Switching mailboxes/pages should always land back at the top of the
  // list — otherwise the new folder renders starting from wherever the
  // previous one happened to be scrolled to. Deliberately separate from
  // the data-fetching effect above (and from reloadActiveView itself, used
  // by background syncs) so a live-update refresh of the *same* view never
  // yanks the scroll position out from under someone mid-read.
  useEffect(() => {
    threadsListRef.current?.scrollTo({ top: 0 });
  }, [activeFolder, activeSmartLabel, threadPage]);

  function openThread(id: string) {
    if ((showCompose || composeFullscreen) && composeIsDirty()) {
      autosaveDraftInBackground({ attachId: false });
    }
    // Urgent path — do NOT use startTransition (that deferred paint ~1s)
    if (id.startsWith("outbox:")) {
      openLocalDraft(id.slice("outbox:".length));
      return;
    }
    if (id.startsWith("outbox-item:")) {
      const row = threads.find((t) => t.id === id);
      haptic("tap");
      setSelectedId(id);
      setMessages([]);
      setDraftId(null);
      setTo((row?.toAddresses || []).join(", "));
      setCc("");
      setBcc("");
      setSubject(row?.subject || "");
      setComposeHtml(row?.bodyHtml || `<p></p><div data-mail-sig="1">${defaultSig}</div>`);
      snapshotComposeBaseline({
        to: (row?.toAddresses || []).join(", "),
        cc: "",
        bcc: "",
        subject: row?.subject || "",
        html: row?.bodyHtml || `<p></p><div data-mail-sig="1">${defaultSig}</div>`,
      });
      setShowCompose(true);
      setComposeFullscreen(false);
      setStatus(
        row?.outboxStatus
          ? `Outbox · ${row.outboxStatus}`
          : "Outbox item",
      );
      return;
    }

    haptic("tap");
      const folder = folderList.find((f) => f.id === activeFolder);
    const inSmartInbox = activeFolder === SMART_INBOX_ID;
    const folderRole = inSmartInbox ? "INBOX" : folder?.role;
    // Paint selection immediately
    setSelectedId(id);
    setShowCompose(false);
    setComposeFullscreen(false);
    setDraftId(null);
    setAskA("");
    setCommitments([]);
    setThreadTasks([]);
    setShowMoveMenu(false);
    setShowSnoozeMenu(false);
    setShowMoreMenu(false);
    setRemindAt("");
    setMessages([]);
    setStatus("Loading…");

    void listTasksForThreadAction(id)
      .then((rows) => setThreadTasks(rows))
      .catch(() => undefined);

    void (async () => {
      try {
        const t = await getMailThread(id, {
          folderId:
            activeFolder &&
            activeFolder !== OUTBOX_ID &&
            activeFolder !== SMART_INBOX_ID
              ? activeFolder
              : undefined,
          folderRole: folderRole,
        });
        if (!t) {
          setStatus("Thread not found");
          return;
        }
        const msgs = t.messages as Msg[];
        setMessages(msgs);
        setStatus("");

        // Always synthesize a fallback row from the thread we just fetched,
        // regardless of whether `id` was in `threads` at click time. That
        // stale-closure check used to gate this: it only asked "was this
        // thread in the list when the click happened," which can no longer
        // be true by the time this async callback runs if `threads` was
        // replaced in the meantime (e.g. a folder-view refresh firing mid
        // -search, or opening from an Ask citation in another folder) —
        // `selectedThread`'s lookup would then find nothing in `threads`
        // AND have no fallback to fall back on, leaving the reader stuck on
        // "Select a thread" even though the fetch itself succeeded. Setting
        // this unconditionally costs nothing when the thread genuinely is
        // still in `threads` — `selectedThread` tries `threads.find` first.
        const last = msgs[msgs.length - 1];
        setSelectedThreadFallback({
          id: t.id,
          subject: t.subject,
          snippet: t.snippet ?? null,
          lastMessageAt: t.lastMessageAt,
          trashedAt: t.trashedAt,
          unreadCount: 0,
          priority: t.priority,
          important: t.important,
          labelsJson: t.labelsJson,
          fromName: last?.fromName ?? null,
          fromAddress: last?.fromAddress ?? null,
          hasAttachments: last?.hasAttachments ?? false,
          answered: false,
        });

        if (folderRole === "INBOX" || inSmartInbox || !folder) {
          setThreads((prev) =>
            prev.map((x) => (x.id === id ? { ...x, unreadCount: 0 } : x)),
          );
          // Never block the reader on mark-read / IMAP
          void markThreadRead(id).catch(() => undefined);
        }

        const viewingDrafts = folderRole === "DRAFTS";

        if (viewingDrafts && last) {
          const draftTo = parseAddrJson(last.toAddresses).join(", ");
          const draftCc = parseAddrJson(last.ccAddresses).join(", ");
          const draftHtml = last.bodyHtml || `<p>${last.bodyText || ""}</p>`;
          setTo(draftTo);
          setCc(draftCc);
          setBcc("");
          setShowCcBcc(Boolean(draftCc));
          setSubject(last.subject);
          setComposeHtml(draftHtml);
          setComposeHeaders({});
          snapshotComposeBaseline({
            to: draftTo,
            cc: draftCc,
            bcc: "",
            subject: last.subject,
            html: draftHtml,
          });
          setShowCompose(true);
          setStatus("Draft opened from mailbox — Save draft to keep edits");
          return;
        }

        applyReplyState(msgs, "reply");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Could not open thread");
        haptic("warn");
      }
    })();
  }

  /** Shared by the reply auto-preload and the explicit Reply-All action. */
  function applyReplyState(msgs: Msg[], mode: "reply" | "reply-all") {
    const last = msgs[msgs.length - 1];
    const reply = replyContext(msgs, {
      folderRole: null,
      myAddress: accountInfo?.address,
      mode,
    });
    const quote = last ? buildQuoteBlock(last) : "";
    const html = `<p></p><div data-mail-sig="1">${defaultSig}</div>${quote}`;
    setTo(reply.to);
    setCc(reply.cc);
    setBcc("");
    setShowCcBcc(Boolean(reply.cc));
    setSubject(reply.subject);
    setComposeHeaders({
      inReplyTo: reply.inReplyTo,
      referencesHdr: reply.referencesHdr,
    });
    setComposeHtml(html);
    setComposeAttachments([]);
    snapshotComposeBaseline({
      to: reply.to,
      cc: reply.cc,
      bcc: "",
      subject: reply.subject,
      html,
    });
  }

  function replyAll() {
    if (!messages.length) return;
    applyReplyState(messages, "reply-all");
    setShowCompose(true);
    haptic("tap");
  }

  function composeForward() {
    const last = messages[messages.length - 1];
    if (!last) return;
    haptic("tap");
    setDraftId(null);
    setTo("");
    setCc("");
    setBcc("");
    setShowCcBcc(false);
    const subject = last.subject.toLowerCase().startsWith("fwd:")
      ? last.subject
      : `Fwd: ${last.subject}`;
    setSubject(subject);
    setComposeHeaders({});
    const html = `<p></p><div data-mail-sig="1">${defaultSig}</div>${buildForwardBlock(last)}`;
    setComposeHtml(html);
    setComposeAttachments([]);
    snapshotComposeBaseline({ to: "", cc: "", bcc: "", subject, html });
    setShowCompose(true);
    setStatus("Forwarding — add a recipient");
    if (last.hasAttachments) {
      void forwardMessageAttachmentsAction(last.id, composeAccountId)
        .then((atts) => {
          if (!atts.length) return;
          setComposeAttachments((prev) => [...prev, ...atts]);
          setStatus("Forwarding — attachments copied, add a recipient");
        })
        .catch(() => {
          setStatus(
            "Forwarding — original attachments could not be copied, add a recipient",
          );
        });
    }
  }

  function splitAddrs(raw: string) {
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function applyBootstrap(data: {
    folders?: Folder[];
    threads?: Thread[];
    account?: typeof accountInfo;
    reminders?: Reminder[];
    signatures?: Signature[];
  }) {
    // Never replace the thread list with unscoped bootstrap while a mailbox is open
    if (data.folders) setFolderList(data.folders);
    if (data.account) setAccountInfo(data.account);
    if (data.reminders) setReminders(data.reminders);
    if (data.signatures) setSigList(data.signatures as SignatureRow[]);
  }

  /** Switch the active mailbox — refetches everything scoped to an account
   * (folders, threads, signatures, reminders) and lands back on Smart
   * Inbox, since the previously active folder id belongs to the old
   * account and won't exist in the new one. */
  async function switchAccount(target: MailAccountSummary) {
    // accountInfo persists across "All Inboxes" (that view never touches
    // it), so a same-account guard here must also require we're not
    // currently in the unified view — otherwise re-clicking the account
    // that was active before switching to All Inboxes silently no-ops
    // instead of switching back to it.
    if (target.id === accountInfo?.id && activeFolder !== ALL_INBOXES_ID) return;
    haptic("tap");
    startNavTransition(async () => {
      const data = await getMailBootstrap(target.id);
      if (!data.configured) return;
      setAccountInfo(data.account);
      setFolderList(data.folders);
      setReminders(data.reminders);
      setSigList(data.signatures as SignatureRow[]);
      setThreadQuery("");
      setActiveSmartLabel(null);
      setSelectedThreadIds(new Set());
      setSelectedId(null);
      setMessages([]);
      setShowCompose(false);
      setComposeFullscreen(false);
      setThreadPage(1);
      setThreadTotal(0);
      setActiveFolder(SMART_INBOX_ID);
      setThreads(data.threads as Thread[]);
    });
  }

  async function reloadActiveView(page = threadPage) {
    const seq = ++threadsFetchSeqRef.current;
    const stale = () => threadsFetchSeqRef.current !== seq;

    if (activeSmartLabel) {
      const res = await listMailThreads({
        label: activeSmartLabel,
        page,
        accountId: accountInfo?.id,
      });
      if (stale()) return;
      setThreads(res.rows as Thread[]);
      setThreadTotal(res.total);
      setThreadPage(res.page);
      return;
    }
    if (activeFolder === OUTBOX_ID) {
      const rows = (await listOutboxAction(accountInfo?.id)) as Thread[];
      if (stale()) return;
      setThreads(rows);
      setThreadTotal(0);
      return;
    }
    if (activeFolder === ALL_INBOXES_ID) {
      const res = await listAllInboxesThreadsAction({ smartInbox: false, page });
      if (stale()) return;
      setThreads(res.rows as Thread[]);
      setThreadTotal(res.total);
      setThreadPage(res.page);
      return;
    }
    if (activeFolder === SMART_INBOX_ID) {
      const res = await listMailThreads({
        smartInbox: true,
        page,
        accountId: accountInfo?.id,
      });
      if (stale()) return;
      setThreads(res.rows as Thread[]);
      setThreadTotal(res.total);
      setThreadPage(res.page);
      return;
    }
    if (activeFolder) {
      const folder = folderList.find((f) => f.id === activeFolder);
      if (folder?.role === "DRAFTS") {
        const rows = (await listDraftsFolderAction(
          activeFolder,
          accountInfo?.id,
        )) as Thread[];
        if (stale()) return;
        setThreads(rows);
        setThreadTotal(0);
      } else {
        const res = await listMailThreads({
          folderId: activeFolder,
          page,
          accountId: accountInfo?.id,
        });
        if (stale()) return;
        setThreads(res.rows as Thread[]);
        setThreadTotal(res.total);
        setThreadPage(res.page);
      }
    }
  }
  // The SSE live-update effect below only subscribes once ([configured]),
  // so it must never call `reloadActiveView` directly — that would close
  // over whichever mailbox was active at mount/subscribe time forever.
  // Read the latest closure through this ref instead, updated every render.
  reloadActiveViewRef.current = reloadActiveView;
  accountInfoRef.current = accountInfo;
  activeFolderRef.current = activeFolder;
  threadQueryRef.current = threadQuery;

  function selectSmartInbox() {
    haptic("tap");
    setActiveSmartLabel(null);
    setThreadQuery("");
    setThreadPage(1);
    setSelectedThreadIds(new Set());
    setActiveFolder(SMART_INBOX_ID);
    if (!(showCompose || composeFullscreen)) {
      setSelectedId(null);
      setMessages([]);
    }
    setStatus("Smart Inbox · mail worth reading");
  }

  function composeNew() {
    haptic("tap");
    setSelectedId(null);
    setMessages([]);
    setDraftId(null);
    setComposeHeaders({});
    setTo("");
    setCc("");
    setBcc("");
    setShowCcBcc(false);
    setSubject("");
    setComposeHtml(`<p></p><div data-mail-sig="1">${defaultSig}</div>`);
    setRefineNote("");
    setComposeBrief("");
    setComposeAttachments([]);
    snapshotComposeBaseline({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      html: `<p></p><div data-mail-sig="1">${defaultSig}</div>`,
    });
    setShowCompose(true);
    setComposeFullscreen(true);
    setStatus("New message — add To, then AI Draft with a short brief");
  }

  function isReplyContext() {
    return Boolean(
      selectedId &&
        !selectedId.startsWith("outbox:") &&
        !selectedId.startsWith("outbox-item:"),
    );
  }

  function selectOutbox() {
    haptic("tap");
    setActiveSmartLabel(null);
    setThreadQuery("");
    setThreadPage(1);
    setSelectedThreadIds(new Set());
    setActiveFolder(OUTBOX_ID);
    if (!(showCompose || composeFullscreen)) {
      setSelectedId(null);
      setMessages([]);
    }
    setStatus("Outbox");
  }

  function selectAllInboxes() {
    haptic("tap");
    setActiveSmartLabel(null);
    setThreadQuery("");
    setThreadPage(1);
    setSelectedThreadIds(new Set());
    setActiveFolder(ALL_INBOXES_ID);
    if (!(showCompose || composeFullscreen)) {
      setSelectedId(null);
      setMessages([]);
    }
    setStatus("All Inboxes · every mailbox merged");
  }

  function selectFolder(folderId: string) {
    haptic("tap");
    setActiveSmartLabel(null);
    setThreadQuery("");
    setThreadPage(1);
    setSelectedThreadIds(new Set());
    setActiveFolder(folderId);
    if (!(showCompose || composeFullscreen)) {
      setSelectedId(null);
      setMessages([]);
    }
  }

  function openLocalDraft(id: string) {
    haptic("tap");
    setSelectedId(`outbox:${id}`);
    setMessages([]);
    setComposeHeaders({ inReplyTo: undefined, referencesHdr: undefined });
    setShowCompose(true);
    // Docked, not fullscreen — matches the real-IMAP-draft branch in
    // openThread (viewingDrafts) and the outbox-item branch above it.
    // Fullscreen is for composeNew() (a genuinely blank message); opening
    // an existing draft from the Drafts folder should land in the normal
    // editor.
    setComposeFullscreen(false);
    setCommitments([]);
    startNavTransition(async () => {
      const d = await getDraftAction(id, accountInfo?.id);
      if (!d) {
        setStatus("Draft not found");
        haptic("warn");
        return;
      }
      setDraftId(d.id);
      setTo(d.to.join(", "));
      setCc(d.cc.join(", "));
      setBcc(d.bcc.join(", "));
      setShowCcBcc(Boolean(d.cc.length || d.bcc.length));
      setSubject(d.subject);
      setComposeHtml(d.bodyHtml || `<p></p><div data-mail-sig="1">${defaultSig}</div>`);
      setComposeHeaders({
        inReplyTo: d.inReplyTo || undefined,
        referencesHdr: d.referencesHdr || undefined,
      });
      snapshotComposeBaseline({
        to: d.to.join(", "),
        cc: d.cc.join(", "),
        bcc: d.bcc.join(", "),
        subject: d.subject,
        html: d.bodyHtml || `<p></p><div data-mail-sig="1">${defaultSig}</div>`,
      });
      setStatus("Draft loaded — edit and Save or Send");
      haptic("success");
    });
  }

  function normalizeComposeBody(html: string) {
    return (html || "")
      .replace(/<div[^>]*data-mail-sig[\s\S]*?<\/div>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * True only if the user has actually changed something from what was
   * auto-populated when this compose context opened (see composeBaselineRef).
   * A reply pre-filled with the sender's address and the default signature is
   * not "dirty" on its own — that would silently draft-save every Reply the
   * user opened and closed without typing a word.
   */
  function composeIsDirty() {
    const b = composeBaselineRef.current;
    return (
      to.trim() !== b.to.trim() ||
      cc.trim() !== b.cc.trim() ||
      bcc.trim() !== b.bcc.trim() ||
      subject.trim() !== b.subject.trim() ||
      normalizeComposeBody(composeHtml) !== normalizeComposeBody(b.html)
    );
  }

  function currentReplyHeaders() {
    if (messages.length) {
      // Conversation-aware: if latest msg is from you, reply to its recipients
      return replyContext(messages, {
        folderRole: null,
        myAddress: accountInfo?.address,
      });
    }
    return {
      to: to,
      cc: cc,
      inReplyTo: composeHeaders.inReplyTo,
      referencesHdr: composeHeaders.referencesHdr,
      subject,
    };
  }

  async function persistDraftNow() {
    const headers = currentReplyHeaders();
    const saved = await saveDraftAction({
      draftId: draftId || undefined,
      to: splitAddrs(to),
      cc: splitAddrs(cc),
      bcc: splitAddrs(bcc),
      subject: subject.trim() || "(no subject)",
      bodyHtml: composeHtml || "<p></p>",
      inReplyTo: headers.inReplyTo,
      referencesHdr: headers.referencesHdr,
      accountId: composeAccountId,
    });
    setDraftId(saved.id);
    return saved;
  }

  function saveCurrentDraft() {
    startTransition(async () => {
      try {
        if (!composeIsDirty() && !draftId) {
          setStatus("Nothing to save yet");
          return;
        }
        const saved = await persistDraftNow();
        setStatus(`Draft saved · ${new Date(saved.updatedAt).toLocaleTimeString()}`);
        haptic("success");
        const draftsFolder = systemFolders.find((f) => f.role === "DRAFTS");
        if (draftsFolder && activeFolder === draftsFolder.id) {
          selectFolder(draftsFolder.id);
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Could not save draft");
        haptic("warn");
      }
    });
  }

  /** Background autosave — never blocks UI / pending state. */
  function autosaveDraftInBackground(opts?: { attachId?: boolean }) {
    if (!composeIsDirty()) return;
    const attachId = opts?.attachId ?? true;
    attachDraftIdRef.current = attachId;
    const headers = currentReplyHeaders();
    const snapshot = {
      draftId: draftId || undefined,
      to: splitAddrs(to),
      cc: splitAddrs(cc),
      bcc: splitAddrs(bcc),
      subject: subject.trim() || "(no subject)",
      bodyHtml: composeHtml || "<p></p>",
      inReplyTo: headers.inReplyTo,
      referencesHdr: headers.referencesHdr,
      accountId: composeAccountId,
    };
    setStatus("Saving draft…");
    void saveDraftAction(snapshot)
      .then((saved) => {
        if (attachDraftIdRef.current) setDraftId(saved.id);
        setStatus("Draft saved to Drafts");
        haptic("success");
      })
      .catch((e) => {
        setStatus(e instanceof Error ? e.message : "Could not save draft");
        haptic("warn");
      });
  }

  function closeCompose(mode: "hide" | "exit-fullscreen") {
    // Exit UI first — never await IMAP save inside useTransition (that freezes all buttons)
    const shouldSave = composeIsDirty();
    if (mode === "exit-fullscreen") {
      setComposeFullscreen(false);
      // "Docked" only has somewhere to render as an inline reply card
      // inside an open thread's message list — with no thread selected
      // (a fresh compose-new session) there's no docked view to fall back
      // to, so exiting fullscreen there should close entirely rather than
      // land on a "docked" state with nothing to show.
      if (!selectedId) setShowCompose(false);
    } else {
      setShowCompose(false);
      setComposeFullscreen(false);
      setRefineNote("");
    }
    haptic("tap");
    if (shouldSave) autosaveDraftInBackground();
  }

  function onPickAttachments(files: FileList | null) {
    if (!files || !files.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    setUploadingAtt(true);
    setStatus("Uploading attachment…");
    void uploadComposeAttachmentAction(fd, composeAccountId)
      .then((uploaded) => {
        setComposeAttachments((prev) => [...prev, ...uploaded]);
        setStatus(
          `${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} added`,
        );
        haptic("success");
      })
      .catch((e) => {
        setStatus(e instanceof Error ? e.message : "Attachment upload failed");
        haptic("warn");
      })
      .finally(() => {
        setUploadingAtt(false);
        if (attachInputRef.current) attachInputRef.current.value = "";
      });
  }

  function handleComposeDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setComposeDragActive(true);
    }
  }

  function handleComposeDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setComposeDragActive(false);
  }

  function handleComposeDrop(e: React.DragEvent) {
    e.preventDefault();
    setComposeDragActive(false);
    if (e.dataTransfer.files?.length) onPickAttachments(e.dataTransfer.files);
  }

  function sendCurrentDraft(e?: React.MouseEvent<HTMLButtonElement>) {
    const recipients = splitAddrs(to);
    if (!recipients.length) {
      setStatus("Add at least one To recipient");
      haptic("warn");
      return;
    }
    if (sending) return;
    const ok = window.confirm(
      `Send from ${accountInfo?.address} to ${recipients.join(", ")}?`,
    );
    if (!ok) {
      haptic("warn");
      return;
    }
    const clickPos = e ? { x: e.clientX, y: e.clientY } : null;
    // Fire immediately on click, not after the send round-trip resolves:
    // a React/Framer Motion animation started from inside the .then()
    // callback loses a race against the heavy re-render that same callback
    // triggers (fullscreen compose closing, thread list reappearing) and
    // doesn't visibly play until that settles, by which point the moment
    // has passed. Sound and animation are both raw DOM/WebAudio effects
    // independent of React, so there's no reason to wait for the server.
    playSendSound();
    if (clickPos) playSendFlyAnimation(clickPos.x, clickPos.y);

    // Do not use startTransition here — long SMTP work would disable every action button
    const headers = currentReplyHeaders();
    const composeSnapshot = {
      to,
      cc,
      bcc,
      subject,
      composeHtml,
      composeHeaders: headers,
      composeBrief,
      draftId,
      composeFullscreen,
      composeAttachments,
    };
    setSending(true);
    setStatus("Sending…");
    const scheduledIso = sendAtLocal
      ? new Date(sendAtLocal).toISOString()
      : null;
    if (scheduledIso && Number.isNaN(Date.parse(scheduledIso))) {
      setStatus("Invalid schedule time");
      haptic("warn");
      return;
    }
    void sendMailAction({
      to: recipients,
      cc: splitAddrs(cc),
      bcc: splitAddrs(bcc),
      subject: subject || "(no subject)",
      bodyHtml: composeHtml,
      confirmed: true,
      sendAt: scheduledIso,
      inReplyTo: headers.inReplyTo,
      referencesHdr: headers.referencesHdr,
      draftId: draftId || undefined,
      attachments: composeAttachments.length ? composeAttachments : undefined,
      undoWindowSeconds: undoWindowSec,
      accountId: composeAccountId,
    })
      .then(async (row) => {
        if (row.status === "FAILED") {
          setStatus(row.error || "Send failed");
          haptic("warn");
          return;
        }
        setShowCompose(false);
        setComposeFullscreen(false);
        setDraftId(null);
        setComposeHeaders({});
        setComposeBrief("");
        setSendAtLocal("");
        haptic("success");

        if (!scheduledIso) {
          // Undo-Send window — held QUEUED server-side; this client timer
          // is what actually triggers the real dispatch (or never does, if
          // the user hits Undo first).
          setStatus(`Sending to ${recipients[0]}${recipients.length > 1 ? ` +${recipients.length - 1}` : ""}…`);
          setPendingSend({
            outboxId: row.id,
            to: recipients.join(", "),
            snapshot: composeSnapshot,
          });
          if (pendingSendTimerRef.current) clearTimeout(pendingSendTimerRef.current);
          const outboxId = row.id;
          pendingSendTimerRef.current = setTimeout(() => {
            flushPendingSendNow(outboxId);
          }, undoWindowSec * 1000);
          return;
        }

        setStatus("Scheduled");
        setComposeAttachments([]);
        await reloadActiveView();
      })
      .catch((e) => {
        setStatus(e instanceof Error ? e.message : "Send failed");
        haptic("warn");
      })
      .finally(() => setSending(false));
  }

  function undoSend() {
    if (!pendingSend) return;
    if (pendingSendTimerRef.current) {
      clearTimeout(pendingSendTimerRef.current);
      pendingSendTimerRef.current = null;
    }
    const id = pendingSend.outboxId;
    const snapshot = pendingSend.snapshot;
    setPendingSend(null);
    startTransition(async () => {
      try {
        await cancelScheduledSend(id, accountInfo?.id);
        setStatus("Send cancelled");
        haptic("success");
        // Restore the exact compose state — including which view (docked
        // vs fullscreen) it was in — not just re-show whatever's currently
        // in the fields, which may have moved on in the meantime.
        setTo(snapshot.to);
        setCc(snapshot.cc);
        setBcc(snapshot.bcc);
        setShowCcBcc(Boolean(snapshot.cc || snapshot.bcc));
        setSubject(snapshot.subject);
        setComposeHtml(snapshot.composeHtml);
        setComposeHeaders(snapshot.composeHeaders);
        setComposeBrief(snapshot.composeBrief);
        setDraftId(snapshot.draftId);
        setComposeAttachments(snapshot.composeAttachments);
        setComposeFullscreen(snapshot.composeFullscreen);
        setShowCompose(true);
      } catch {
        // Lost the race at the edge of the undo window — it already went out.
        setStatus("Too late — already sent");
        haptic("warn");
      }
    });
  }

  /** Actually dispatch a queued send — called by the undo-window timer, or
   * immediately when the user dismisses the toast via its close button. */
  function flushPendingSendNow(outboxId: string) {
    void flushQueuedSendAction(outboxId, accountInfo?.id)
      .then(() => {
        setPendingSend((p) => (p?.outboxId === outboxId ? null : p));
        setStatus("Sent");
        void reloadActiveViewRef.current();
      })
      .catch((e) => {
        setPendingSend((p) => (p?.outboxId === outboxId ? null : p));
        setStatus(e instanceof Error ? e.message : "Send failed");
        haptic("warn");
      });
  }

  /** Close (×) on the send toast — dismiss it now and send right away,
   * distinct from Undo which cancels the send entirely. */
  function sendPendingNow() {
    if (!pendingSend) return;
    if (pendingSendTimerRef.current) {
      clearTimeout(pendingSendTimerRef.current);
      pendingSendTimerRef.current = null;
    }
    haptic("tap");
    flushPendingSendNow(pendingSend.outboxId);
  }

  function resetLabelSuggestionTimer() {
    if (labelSuggestionTimerRef.current) {
      clearTimeout(labelSuggestionTimerRef.current);
    }
    labelSuggestionTimerRef.current = setTimeout(() => {
      setLabelSuggestion(null);
      labelSuggestionTimerRef.current = null;
    }, 15000);
  }

  function openLabelSuggestion(state: LabelSuggestionState) {
    setLabelSuggestion(state);
    resetLabelSuggestionTimer();
  }

  function dismissLabelSuggestion() {
    if (labelSuggestionTimerRef.current) {
      clearTimeout(labelSuggestionTimerRef.current);
      labelSuggestionTimerRef.current = null;
    }
    setLabelSuggestion(null);
  }

  /** Fire-and-forget: ask whether this correction generalizes, and if so, offer it. Never blocks the fast single-thread path that triggered it. */
  function maybeSuggestLabelCorrection(threadId: string, targetLabel: string, base: {
    isSmartLabel: boolean;
    targetLabelDisplay: string;
    folderId?: string;
    folderName?: string;
  }) {
    void suggestLabelCorrectionAction({ threadId, targetLabel }).then((res) => {
      if (!res) return;
      openLabelSuggestion({
        sourceThreadId: threadId,
        targetLabel,
        targetLabelDisplay: base.targetLabelDisplay,
        isSmartLabel: base.isSmartLabel,
        fromContains: res.fromContains,
        subjectContains: res.subjectContains,
        ruleName: res.ruleName,
        folderId: base.folderId,
        folderName: base.folderName,
        matches: res.matches,
        matchesCapped: res.matchesCapped,
        // Default to everything selected — deselecting is the exception, not the norm.
        selectedIds: new Set(res.matches.map((m) => m.id)),
        showMatches: false,
      });
    });
  }

  function toggleLabelSuggestionMatch(id: string) {
    setLabelSuggestion((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedIds: next };
    });
  }

  function setAllLabelSuggestionMatches(selectAll: boolean) {
    setLabelSuggestion((prev) =>
      prev
        ? {
            ...prev,
            selectedIds: selectAll ? new Set(prev.matches.map((m) => m.id)) : new Set(),
          }
        : prev,
    );
  }

  /** Pauses the auto-dismiss timer while the review list is open — don't
   * hide a checklist the user is actively going through — and resumes a
   * fresh window once it's collapsed again. */
  function toggleLabelSuggestionExpanded() {
    setLabelSuggestion((prev) => {
      if (!prev) return prev;
      const opening = !prev.showMatches;
      if (opening) {
        if (labelSuggestionTimerRef.current) {
          clearTimeout(labelSuggestionTimerRef.current);
          labelSuggestionTimerRef.current = null;
        }
      } else {
        resetLabelSuggestionTimer();
      }
      return { ...prev, showMatches: opening };
    });
  }

  function correctSmartLabel(threadId: string, oldLabel: string, newLabel: SmartLabel) {
    setSmartLabelMenuFor(null);
    if (newLabel === oldLabel) return;
    startTransition(async () => {
      const res = await correctSmartLabelAction(threadId, newLabel);
      if (!res.ok) {
        setStatus(res.error);
        haptic("warn");
        return;
      }
      haptic("success");
      setStatus(`Labeled ${SMART_LABEL_META[newLabel].label}`);
      await reloadActiveViewRef.current();
      maybeSuggestLabelCorrection(threadId, newLabel, {
        isSmartLabel: true,
        targetLabelDisplay: SMART_LABEL_META[newLabel].label,
      });
    });
  }

  function applyLabelSuggestionRetroactive() {
    if (!labelSuggestion || !labelSuggestion.selectedIds.size) return;
    const s = labelSuggestion;
    const threadIds = Array.from(s.selectedIds);
    startTransition(async () => {
      const res = await applyLabelCorrectionAction({
        targetLabel: s.targetLabel,
        isSmartLabel: s.isSmartLabel,
        fromContains: s.fromContains,
        subjectContains: s.subjectContains,
        ruleName: s.ruleName,
        sourceThreadId: s.sourceThreadId,
        applyRetroactively: true,
        createStandingRule: false,
        threadIds,
        folderId: s.folderId,
        folderName: s.folderName,
      });
      const count = res.snapshot?.items.length ?? 0;
      haptic("success");
      setLabelSuggestion((prev) =>
        prev && prev.sourceThreadId === s.sourceThreadId
          ? { ...prev, applyResult: { count, snapshot: res.snapshot }, showMatches: false }
          : prev,
      );
      resetLabelSuggestionTimer();
      if (count) void reloadActiveViewRef.current();
    });
  }

  function alwaysApplyLabelSuggestion() {
    if (!labelSuggestion) return;
    const s = labelSuggestion;
    startTransition(async () => {
      const res = await applyLabelCorrectionAction({
        targetLabel: s.targetLabel,
        isSmartLabel: s.isSmartLabel,
        fromContains: s.fromContains,
        subjectContains: s.subjectContains,
        ruleName: s.ruleName,
        sourceThreadId: s.sourceThreadId,
        applyRetroactively: false,
        createStandingRule: true,
        folderId: s.folderId,
        folderName: s.folderName,
      });
      haptic("success");
      setLabelSuggestion((prev) =>
        prev && prev.sourceThreadId === s.sourceThreadId
          ? { ...prev, ruleCreated: res.ruleCreated }
          : prev,
      );
      resetLabelSuggestionTimer();
    });
  }

  function undoLabelSuggestionApply() {
    const snapshot = labelSuggestion?.applyResult?.snapshot;
    if (!snapshot) return;
    if (labelSuggestionTimerRef.current) {
      clearTimeout(labelSuggestionTimerRef.current);
      labelSuggestionTimerRef.current = null;
    }
    setLabelSuggestion(null);
    startTransition(async () => {
      await undoLabelCorrectionAction(snapshot);
      setStatus("Undone");
      haptic("success");
      void reloadActiveViewRef.current();
    });
  }

  function resetSpamSuggestionTimer() {
    if (spamSuggestionTimerRef.current) {
      clearTimeout(spamSuggestionTimerRef.current);
    }
    spamSuggestionTimerRef.current = setTimeout(() => {
      setSpamSuggestion(null);
      spamSuggestionTimerRef.current = null;
    }, 15000);
  }

  function openSpamSuggestion(state: SpamSuggestionState) {
    setSpamSuggestion(state);
    resetSpamSuggestionTimer();
  }

  function dismissSpamSuggestion() {
    if (spamSuggestionTimerRef.current) {
      clearTimeout(spamSuggestionTimerRef.current);
      spamSuggestionTimerRef.current = null;
    }
    setSpamSuggestion(null);
  }

  /** Fire-and-forget: after a manual "Report spam," check whether other
   * inbox mail looks like the same campaign and offer it — never blocks
   * the fast single-thread report that triggered it. */
  function maybeSuggestSpamCorrection(threadId: string) {
    void suggestSpamCorrectionAction({ threadId }).then((res) => {
      if (!res || !res.matches.length) return;
      openSpamSuggestion({
        sourceThreadId: threadId,
        matches: res.matches,
        matchesCapped: res.matchesCapped,
        // Default to everything selected — deselecting is the exception.
        selectedIds: new Set(res.matches.map((m) => m.id)),
        showMatches: false,
      });
    });
  }

  function toggleSpamSuggestionMatch(id: string) {
    setSpamSuggestion((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedIds: next };
    });
  }

  function setAllSpamSuggestionMatches(selectAll: boolean) {
    setSpamSuggestion((prev) =>
      prev
        ? {
            ...prev,
            selectedIds: selectAll ? new Set(prev.matches.map((m) => m.id)) : new Set(),
          }
        : prev,
    );
  }

  function toggleSpamSuggestionExpanded() {
    setSpamSuggestion((prev) => {
      if (!prev) return prev;
      const opening = !prev.showMatches;
      if (opening) {
        if (spamSuggestionTimerRef.current) {
          clearTimeout(spamSuggestionTimerRef.current);
          spamSuggestionTimerRef.current = null;
        }
      } else {
        resetSpamSuggestionTimer();
      }
      return { ...prev, showMatches: opening };
    });
  }

  /** Confirm: move the selected matches to Junk too, reusing the same
   * bulk action manual "Report spam" already uses (real IMAP move +
   * sender-feedback recording) — no separate move mechanism for the
   * suggestion flow. */
  function applySpamSuggestion() {
    if (!spamSuggestion || !spamSuggestion.selectedIds.size) return;
    const s = spamSuggestion;
    const threadIds = Array.from(s.selectedIds);
    startTransition(async () => {
      await markThreadsSpamAction(threadIds);
      haptic("success");
      setThreads((prev) => prev.filter((t) => !s.selectedIds.has(t.id)));
      setSpamSuggestion((prev) =>
        prev && prev.sourceThreadId === s.sourceThreadId
          ? { ...prev, applyResult: { count: threadIds.length, appliedIds: threadIds }, showMatches: false }
          : prev,
      );
      resetSpamSuggestionTimer();
    });
  }

  /** Real IMAP move back to Inbox for the applied batch — the same
   * "Not spam" mechanism a single manual correction already uses. */
  function undoSpamSuggestionApply() {
    const appliedIds = spamSuggestion?.applyResult?.appliedIds;
    if (!appliedIds?.length) return;
    if (spamSuggestionTimerRef.current) {
      clearTimeout(spamSuggestionTimerRef.current);
      spamSuggestionTimerRef.current = null;
    }
    setSpamSuggestion(null);
    startTransition(async () => {
      await markThreadsNotSpamAction(appliedIds);
      setStatus("Undone");
      haptic("success");
      void reloadActiveViewRef.current();
    });
  }

  function archiveSelected() {
    if (!selectedId || selectedId.startsWith("outbox")) return;
    const id = selectedId;
    startTransition(async () => {
      await archiveThreadAction(id);
      setThreads((prev) => prev.filter((x) => x.id !== id));
      setSelectedId(null);
      setMessages([]);
      setShowCompose(false);
      setStatus("Archived");
      haptic("success");
    });
  }

  function markSpamSelected() {
    if (!selectedId || selectedId.startsWith("outbox")) return;
    const id = selectedId;
    startTransition(async () => {
      await markThreadSpamAction(id);
      setThreads((prev) => prev.filter((x) => x.id !== id));
      setSelectedId(null);
      setMessages([]);
      setShowCompose(false);
      setStatus("Reported as spam");
      haptic("success");
      maybeSuggestSpamCorrection(id);
    });
  }

  function markNotSpamSelected() {
    if (!selectedId || selectedId.startsWith("outbox")) return;
    const id = selectedId;
    startTransition(async () => {
      await markThreadNotSpamAction(id);
      setThreads((prev) => prev.filter((x) => x.id !== id));
      setSelectedId(null);
      setMessages([]);
      setShowCompose(false);
      setStatus("Not spam — moved to Inbox");
      haptic("success");
    });
  }

  function trashSelected() {
    if (!selectedId || selectedId.startsWith("outbox")) return;
    const ok = window.confirm("Move this thread to Trash?");
    if (!ok) return;
    const id = selectedId;
    setThreads((prev) => prev.filter((t) => t.id !== id));
    setSelectedId(null);
    setMessages([]);
    setShowCompose(false);
    setStatus("Moving to Trash…");
    startNavTransition(async () => {
      try {
        await trashThreadAction(id, true);
        setStatus("Moved to Trash");
        haptic("success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Trash failed");
        haptic("warn");
        await reloadActiveView();
      }
    });
  }

  function toggleThreadSelected(id: string) {
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedThreadIds(new Set(filteredThreads.map((t) => t.id)));
    haptic("tap");
  }

  function clearThreadSelection() {
    setSelectedThreadIds(new Set());
  }

  function toggleSelectMode() {
    haptic("tap");
    setSelectModeEnabled((v) => {
      if (v) setSelectedThreadIds(new Set()); // turning off clears any selection
      return !v;
    });
  }

  function bulkArchive() {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;
    startTransition(async () => {
      await archiveThreadsAction(ids);
      setThreads((prev) => prev.filter((t) => !selectedThreadIds.has(t.id)));
      setSelectedThreadIds(new Set());
      setStatus(`Archived ${ids.length} thread${ids.length === 1 ? "" : "s"}`);
      haptic("success");
    });
  }

  function bulkTrash() {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;
    const ok = window.confirm(
      `Move ${ids.length} thread${ids.length === 1 ? "" : "s"} to Trash?`,
    );
    if (!ok) return;
    setThreads((prev) => prev.filter((t) => !selectedThreadIds.has(t.id)));
    setSelectedThreadIds(new Set());
    setStatus("Moving to Trash…");
    startNavTransition(async () => {
      try {
        await trashThreadsAction(ids, true);
        setStatus(`Moved ${ids.length} to Trash`);
        haptic("success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Trash failed");
        haptic("warn");
        await reloadActiveView();
      }
    });
  }

  function bulkMarkSpam() {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;
    startTransition(async () => {
      await markThreadsSpamAction(ids);
      setThreads((prev) => prev.filter((t) => !selectedThreadIds.has(t.id)));
      setSelectedThreadIds(new Set());
      setStatus(`Reported ${ids.length} thread${ids.length === 1 ? "" : "s"} as spam`);
      haptic("success");
    });
  }

  function bulkMarkNotSpam() {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;
    startTransition(async () => {
      await markThreadsNotSpamAction(ids);
      setThreads((prev) => prev.filter((t) => !selectedThreadIds.has(t.id)));
      setSelectedThreadIds(new Set());
      setStatus(`Moved ${ids.length} to Inbox`);
      haptic("success");
    });
  }

  function bulkMoveTo(folderId: string, folderName: string) {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;
    setShowBulkMoveMenu(false);
    setThreads((prev) => prev.filter((t) => !selectedThreadIds.has(t.id)));
    setSelectedThreadIds(new Set());
    startTransition(async () => {
      await moveThreadsToFolderAction(ids, folderId);
      setStatus(`Moved ${ids.length} to ${folderName}`);
      haptic("success");
    });
  }

  /**
   * Always-available escape hatch from compose — mirrors Gmail's compose
   * trash icon. If a draft was already persisted, delete it server-side;
   * if not (still mid-edit, autosave hasn't landed), just close without
   * ever saving. Only confirms when there's actually something to lose.
   */
  function discardDraft() {
    const id = draftId;
    const dirty = composeIsDirty();
    if (id || dirty) {
      const ok = window.confirm(
        id
          ? "Discard this draft? This cannot be undone."
          : "Discard these changes without saving?",
      );
      if (!ok) return;
    }
    if (id) setThreads((prev) => prev.filter((t) => t.id !== `outbox:${id}`));
    setShowCompose(false);
    setComposeFullscreen(false);
    setDraftId(null);
    setSelectedId(null);
    setRefineNote("");
    haptic("tap");
    if (!id) {
      setStatus(dirty ? "Discarded" : "");
      return;
    }
    setStatus("Discarding draft…");
    startNavTransition(async () => {
      try {
        await deleteDraftAction(id, accountInfo?.id);
        setStatus("Draft discarded");
        haptic("success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Could not discard draft");
        haptic("warn");
      } finally {
        await reloadActiveView();
      }
    });
  }

  function applySignature(sigId: string) {
    const sig = sigList.find((s) => s.id === sigId);
    if (!sig) return;
    const withoutSig = composeHtml
      .replace(/<div data-mail-sig[\s\S]*?<\/div>/i, "")
      .replace(/<p>Best regards,[\s\S]*?<\/p>/i, "")
      .trim();
    setComposeHtml(
      `${withoutSig || "<p></p>"}<div data-mail-sig="1">${sig.htmlBody}</div>`,
    );
    haptic("tap");
  }

  /** overrideBrief lets a just-finished voice command act on its own
   * transcript immediately, rather than reading composeBrief state that
   * setComposeBrief(next) hasn't flushed into this render's closure yet. */
  function runAiDraft(overrideBrief?: string) {
    setShowCompose(true);
    startTransition(async () => {
      try {
        if (isReplyContext() && selectedId) {
          const d = await draftReplyAction({
            threadId: selectedId,
            intent: (overrideBrief ?? composeBrief).trim() || undefined,
            tone: DEFAULT_DRAFT_TONE,
            attachments: composeAttachments.map((a) => a.filename),
          });
          if (d?.html) {
            setComposeHtml(d.html);
            setRefineNote("");
          }
          if (d?.subject) setSubject(d.subject);
          setStatus(
            d?.html
              ? "AI reply drafted — refine with the presets or edit directly"
              : "AI draft unavailable",
          );
          haptic(d?.html ? "success" : "warn");
          return;
        }

        // Fresh compose — the AI assist box supplies the instruction.
        const brief = (overrideBrief ?? composeBrief).trim() || subject.trim();
        if (!brief) {
          setStatus("Tell AI what to write in the AI assist box, then hit Draft");
          haptic("warn");
          return;
        }

        // The brief is the only place a recipient like "send mail to Akshay
        // on akshayroyal678@gmail.com" gets typed. Always parse it for a
        // recipient/name — even if To is already filled (e.g. this is a
        // second Draft click on the same brief) — since the name hint is a
        // property of the *instruction*, not of whether To happens to be
        // populated yet; only gating on "To empty" here would silently
        // drop the hint on any run after the first.
        let recipients = splitAddrs(to);
        const resolved = await extractDraftRecipientsAction(
          brief,
          accountInfo?.id,
        ).catch(() => null);
        if (!recipients.length && resolved?.to.length) {
          recipients = resolved.to;
          setTo(resolved.to.join(", "));
        }
        // knownName is whatever the user's own instruction named the
        // recipient as (e.g. "...belonging to Baneshwari Royal") when
        // there's no matching contact/client record to confirm it from —
        // still worth carrying through to the draft, since the source is
        // the user's own words, not a guess.
        const recipientNameHint = resolved?.knownName || undefined;

        const d = await draftNewMailAction({
          to: recipients,
          subject: subject.trim() || undefined,
          intent: brief,
          tone: DEFAULT_DRAFT_TONE,
          recipientNameHint,
          accountId: accountInfo?.id,
          attachments: composeAttachments.map((a) => a.filename),
        });
        if (d?.html) {
          setComposeHtml(d.html);
          setRefineNote("");
        }
        if (d?.subject) setSubject(d.subject);
        setStatus(
          d?.html
            ? "AI draft ready — refine with the presets or edit directly"
            : "AI draft unavailable",
        );
        haptic(d?.html ? "success" : "warn");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "AI draft failed");
        haptic("warn");
      }
    });
  }

  /** overrideNote — see runAiDraft's note on why a just-spoken voice
   * command needs to bypass the not-yet-flushed refineNote state. */
  function applyDraftRefine(
    presetId?: DraftRefinePresetId,
    overrideNote?: string,
  ) {
    startTransition(async () => {
      try {
        const html = await refineDraftAction({
          html: composeHtml,
          presetId,
          instruction: (overrideNote ?? refineNote).trim() || undefined,
        });
        if (html) {
          setComposeHtml(html);
          setStatus("Draft updated");
          haptic("success");
        } else {
          setStatus("Could not refine draft");
          haptic("warn");
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Refine failed");
        haptic("warn");
      }
    });
  }

  function runSummarize() {
    if (!selectedId) return;
    startTransition(async () => {
      const s = await summarizeThreadAction(selectedId);
      setAskA(s?.summary || "No summary");
      setStatus(s?.summary ? "Summary ready (below)" : "Summarize unavailable");
      haptic(s?.summary ? "success" : "warn");
    });
  }

  function runTriage() {
    if (!selectedId) return;
    startTransition(async () => {
      const r = await triageThreadAction(selectedId, { force: true });
      setStatus(
        r
          ? `Triage ${r.priority} · ${(r.labels || []).join(", ") || "no labels"}`
          : "AI unavailable",
      );
      if (r) {
        setThreads((prev) =>
          prev.map((t) => {
            if (t.id !== selectedId) return t;
            const existing = parseLabelsJson(t.labelsJson);
            return {
              ...t,
              priority: r.priority || t.priority,
              labelsJson: JSON.stringify(
                mergeSmartLabels(existing, r.labels || []),
              ),
            };
          }),
        );
        if (r.priority) await setThreadPriority(selectedId, r.priority);
        // If this thread is noise, drop it from Smart Inbox immediately
        if (
          activeFolder === SMART_INBOX_ID &&
          (r.labels || []).some(
            (l) =>
              l === "NEWSLETTER" || l === "RECEIPT" || l === "BANKING",
          )
        ) {
          setThreads((prev) => prev.filter((t) => t.id !== selectedId));
          setSelectedId(null);
          setMessages([]);
        }
      }
      haptic(r ? "success" : "warn");
    });
  }

  function selectSmartLabel(label: SmartLabel) {
    haptic("tap");
    setThreadQuery("");
    setThreadPage(1);
    setSelectedThreadIds(new Set());
    setActiveSmartLabel(label);
    setActiveFolder(null);
    if (!(showCompose || composeFullscreen)) {
      setSelectedId(null);
      setMessages([]);
    }
    setStatus(`Smart label · ${SMART_LABEL_META[label].label}`);
  }

  function createLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const folder = await createMailLabelAction(name, accountInfo?.id);
        setFolderList((prev) =>
          prev.some((f) => f.id === folder.id) ? prev : [...prev, folder],
        );
        setNewLabelName("");
        setShowNewLabel(false);
        setLabelsOpen(true);
        setStatus(`Label “${folder.name}” created`);
        haptic("success");
        selectFolder(folder.id);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Could not create label");
        haptic("warn");
      }
    });
  }

  function toggleFolderCollapsed(key: string) {
    setCollapsedFolderKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderFolderNode(node: FolderTreeNode<Folder>): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const collapsed = collapsedFolderKeys.has(node.key);
    return (
      <div key={node.key}>
        <div className="flex items-center gap-0.5" style={{ paddingLeft: node.depth * 12 }}>
          {hasChildren ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded"
              style={{ color: "var(--mail-dim)" }}
              onClick={() => toggleFolderCollapsed(node.key)}
            >
              <ChevronRight
                size={12}
                style={{
                  transform: collapsed ? "none" : "rotate(90deg)",
                  transition: "transform 0.15s",
                }}
              />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {node.folder ? (
              <FolderRow
                name={node.label}
                badge="Lbl"
                active={node.folder.id === activeFolder && !activeSmartLabel}
                onClick={() => selectFolder(node.folder!.id)}
              />
            ) : (
              <p
                className="truncate px-3 py-1.5 text-xs font-semibold"
                style={{ color: "var(--mail-dim)" }}
              >
                {node.label}
              </p>
            )}
          </div>
        </div>
        {hasChildren && !collapsed && node.children.map((c) => renderFolderNode(c))}
      </div>
    );
  }

  function runCategorizeAll() {
    if (categorizing || syncing) return;
    haptic("tap");
    setCategorizing(true);
    setStatus("Categorizing mail…");
    setJobProgress({
      kind: "categorize",
      label: "Repairing bad labels…",
    });
    void (async () => {
      const BATCH = 25;
      const MAX_ROUNDS = 40;
      let repaired = 0;
      let processed = 0;
      let labeled = 0;
      let remaining = 0;
      try {
        // Batch 1: repair + first AI chunk
        let r = await backfillSmartLabelsAction({
          limit: BATCH,
          skipRepair: false,
          withBootstrap: false,
          accountId: accountInfo?.id,
        });
        repaired = r.repaired || 0;
        processed += r.processed;
        labeled += r.labeled;
        remaining = r.remaining;
        setJobProgress({
          kind: "categorize",
          label:
            repaired > 0
              ? `Fixed ${repaired} · AI labeling…`
              : "AI labeling…",
          current: processed,
          total: processed + remaining,
        });
        setStatus(
          `Categorizing… ${processed}/${processed + remaining}`,
        );

        let rounds = 1;
        while (remaining > 0 && rounds < MAX_ROUNDS) {
          r = await backfillSmartLabelsAction({
            limit: BATCH,
            skipRepair: true,
            withBootstrap: false,
            accountId: accountInfo?.id,
          });
          processed += r.processed;
          labeled += r.labeled;
          remaining = r.remaining;
          rounds += 1;
          setJobProgress({
            kind: "categorize",
            label: `AI labeling… batch ${rounds}`,
            current: processed,
            total: processed + remaining,
          });
          setStatus(
            `Categorizing… ${processed}/${processed + remaining}`,
          );
          if (r.processed === 0) break;
        }

        await reloadActiveView();
        const parts = [
          repaired
            ? `Fixed ${repaired} label${repaired === 1 ? "" : "s"}`
            : null,
          processed ? `AI ${labeled}/${processed}` : null,
          remaining ? `${remaining} still pending` : "done",
        ].filter(Boolean);
        setStatus(parts.join(" · "));
        setJobProgress({
          kind: "categorize",
          label: remaining ? "Paused — more left" : "Categorize complete",
          current: processed,
          total: processed + remaining,
        });
        haptic(remaining ? "warn" : "success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Categorize failed");
        setJobProgress(null);
        haptic("warn");
      } finally {
        setCategorizing(false);
        window.setTimeout(() => setJobProgress(null), 2200);
      }
    })();
  }

  function runExtractTasks() {
    if (!selectedId) return;
    startTransition(async () => {
      const c = await extractCommitmentsAction(selectedId);
      setCommitments(c?.items || []);
      setStatus(
        c?.items?.length
          ? `Found ${c.items.length} task(s)`
          : "No tasks found",
      );
      haptic(c?.items?.length ? "success" : "warn");
    });
  }

  function runShorten() {
    startTransition(async () => {
      const html = await rewriteDraftAction({
        html: composeHtml,
        mode: "shorten",
      });
      if (html) setComposeHtml(html);
      haptic(html ? "success" : "warn");
    });
  }

  function runRewrite(mode: "soften" | "formalize" | "translate") {
    startTransition(async () => {
      const html = await rewriteDraftAction({
        html: composeHtml,
        mode,
        targetLang: mode === "translate" ? "hi" : undefined,
      });
      if (html) setComposeHtml(html);
      setStatus(
        mode === "translate"
          ? "Translated (Hindi)"
          : mode === "soften"
            ? "Softened"
            : "Formalized",
      );
      haptic(html ? "success" : "warn");
    });
  }

  function runMultilingualHindi() {
    if (!selectedId || selectedId.startsWith("outbox")) {
      runRewrite("translate");
      return;
    }
    startTransition(async () => {
      const d = await multilingualDraftAction({
        threadId: selectedId,
        language: "hi",
        intent: "Reply in Hindi, keep facts grounded",
      });
      if (d?.html) {
        setComposeHtml(d.html);
        setShowCompose(true);
        setStatus("Drafted in Hindi");
        haptic("success");
      } else {
        haptic("warn");
      }
    });
  }

  function runMeetingInvite() {
    const attendees = [
      ...new Set(
        messages
          .flatMap((m) => [m.fromAddress, ...splitAddrs(m.toAddresses || "")])
          .filter((e) => e && !e.includes("thebluridge.com")),
      ),
    ].slice(0, 8);
    setScheduleMeetingDefaults({
      title: selectedThread?.subject || "Meeting",
      attendees,
    });
    haptic("tap");
  }

  function runBulkCleanup() {
    startTransition(async () => {
      const rows = await bulkCleanupSuggestionsAction(accountInfo?.id);
      setBulkSuggestions(rows);
      setStatus(
        rows.length
          ? `${rows.length} cleanup candidates`
          : "No bulk cleanup suggestions",
      );
      haptic(rows.length ? "success" : "warn");
    });
  }

  function runAsk(question: string) {
    const q = question.trim();
    if (!q) return;
    setAskThinking(true);
    setAskA("");
    setAskCitations([]);
    setAskSources([]);
    const historyForRequest = askHistory;
    startTransition(async () => {
      haptic("tap");
      try {
        const lower = q.toLowerCase();
        const recallMatch = lower.match(/^(recall|who is|about)\s+(.+)/i);
        const a = recallMatch
          ? await recallPersonAction(recallMatch[2]!.trim(), accountInfo?.id)
          : await askMailAction(q, historyForRequest, accountInfo?.id);
        setAskA(a.answer);
        setAskCitations(a.citationRefs || []);
        setAskSources(a.sourceRefs || []);
        setAskHistory((prev) => [...prev, { question: q, answer: a.answer }]);
        haptic(a.notFound ? "warn" : "success");
      } catch (e) {
        setAskA(e instanceof Error ? e.message : "Ask failed — try again.");
        setAskCitations([]);
        setAskSources([]);
        haptic("warn");
      } finally {
        setAskThinking(false);
      }
    });
  }

  function clearAskConversation() {
    setAskHistory([]);
    setAskA("");
    setAskCitations([]);
    setAskSources([]);
    haptic("tap");
  }

  /** Every mail action reachable by voice or typed command, registered with
   * the shared command registry (src/lib/commands/registry.ts) so the same
   * entries are matchable from this page's own voice input AND, once wired
   * up, from the app-wide ⌘K bar / global voice entry point. Guard
   * conditions (thread must be open, etc.) live in each handler exactly as
   * they did in the old bespoke regex dispatcher — only the matching
   * mechanism moved to command-score's fuzzy scoring. */
  function openFolderByRole(role: string, label: string) {
    const folder = folderList.find((f) => f.role === role);
    if (folder) {
      selectFolder(folder.id);
      setStatus(`Opened ${folder.name}`);
    } else {
      setStatus(`No ${label} folder found`);
      haptic("warn");
    }
  }

  const mailCommands: RegisteredCommand[] = [
    {
      id: "mail.compose",
      label: "Compose new email",
      description: "Open a new blank email to compose",
      phrases: [
        "compose",
        "compose new email",
        "write new email",
        "new email",
        "new message",
        "draft new email",
        "start new email",
      ],
      handler: () => composeNew(),
    },
    {
      id: "mail.open-smart-inbox",
      label: "Open Smart Inbox",
      description: "Navigate to the Smart Inbox view",
      phrases: ["smart inbox", "open smart inbox", "go to smart inbox", "show smart inbox"],
      handler: () => selectSmartInbox(),
    },
    {
      id: "mail.open-inbox",
      label: "Open Inbox",
      description: "Navigate to the Inbox folder",
      phrases: ["inbox", "open inbox", "go to inbox", "show inbox", "all inbox"],
      handler: () => openFolderByRole("INBOX", "inbox"),
    },
    {
      id: "mail.open-sent",
      label: "Open Sent",
      description: "Navigate to the Sent folder",
      phrases: ["sent", "open sent", "go to sent", "sent mail", "sent folder"],
      handler: () => openFolderByRole("SENT", "sent"),
    },
    {
      id: "mail.open-drafts",
      label: "Open Drafts",
      description: "Navigate to the Drafts folder",
      phrases: ["drafts", "draft folder", "open drafts", "go to drafts"],
      handler: () => openFolderByRole("DRAFTS", "drafts"),
    },
    {
      id: "mail.open-trash",
      label: "Open Trash",
      description: "Navigate to the Trash folder",
      phrases: ["trash folder", "deleted items", "open trash", "go to trash", "view trash"],
      handler: () => openFolderByRole("TRASH", "trash"),
    },
    {
      id: "mail.open-junk",
      label: "Open Junk",
      description: "Navigate to the Junk/Spam folder",
      phrases: ["junk", "spam", "open junk", "go to junk", "junk mail"],
      handler: () => openFolderByRole("JUNK", "junk"),
    },
    {
      id: "mail.open-archive",
      label: "Open Archive folder",
      description: "Navigate to the Archive folder",
      phrases: ["archive folder", "open archive", "go to archive", "view archive", "archived mail"],
      handler: () => openFolderByRole("ARCHIVE", "archive"),
    },
    {
      id: "mail.open-outbox",
      label: "Open Outbox",
      description: "Navigate to the Outbox",
      phrases: ["outbox", "open outbox", "go to outbox", "outbox folder"],
      handler: () => selectOutbox(),
    },
    {
      id: "mail.search",
      label: "Search mail",
      description: "Search mail for a query",
      phrases: ["search", "search mail", "search for", "find", "look for", "find mail"],
      extractArgs: (raw) => {
        const match = raw
          .trim()
          .match(/^(?:search(?: mail| for)?|find|look for)\s+(.+)/i);
        return match?.[1]?.trim() ? { query: match[1].trim() } : null;
      },
      handler: (args) => {
        const query = typeof args?.query === "string" ? args.query : "";
        if (!query) {
          setStatus('Say what to search for, e.g. "search invoices from BSS"');
          haptic("warn");
          return;
        }
        setActiveSmartLabel(null);
        setThreadQuery(query);
        setStatus(`Searching "${query}"…`);
      },
    },
    {
      id: "mail.archive",
      label: "Archive open thread",
      description: "Archive the currently open mail thread",
      phrases: ["archive", "archive this", "archive this email", "archive this thread", "archive current email"],
      handler: () => {
        if (!selectedId || selectedId.startsWith("outbox")) {
          setStatus("Open a thread first to archive it");
          haptic("warn");
          return;
        }
        archiveSelected();
      },
    },
    {
      id: "mail.trash",
      label: "Trash open thread",
      description: "Move the currently open mail thread to Trash",
      phrases: ["trash", "delete", "trash this", "delete this", "trash this email", "delete this email", "move to trash"],
      handler: () => {
        if (!selectedId || selectedId.startsWith("outbox")) {
          setStatus("Open a thread first to trash it");
          haptic("warn");
          return;
        }
        trashSelected();
      },
    },
    {
      id: "mail.mark-spam",
      label: "Report spam",
      description: "Move the currently open mail thread to Junk/Spam",
      phrases: ["report spam", "mark as spam", "this is spam", "move to spam", "move to junk"],
      handler: () => {
        if (!selectedId || selectedId.startsWith("outbox")) {
          setStatus("Open a thread first to report spam");
          haptic("warn");
          return;
        }
        markSpamSelected();
      },
    },
    {
      id: "mail.mark-not-spam",
      label: "Not spam",
      description: "Move the currently open mail thread out of Junk/Spam back to Inbox",
      phrases: ["not spam", "this isn't spam", "unspam", "remove from spam"],
      handler: () => {
        if (!selectedId || selectedId.startsWith("outbox")) {
          setStatus("Open a thread first to mark it not spam");
          haptic("warn");
          return;
        }
        markNotSpamSelected();
      },
    },
    {
      id: "mail.reply",
      label: "Reply",
      description: "Reply to the currently open mail thread",
      phrases: ["reply", "reply to this", "reply to this email"],
      handler: () => {
        if (!selectedId) {
          setStatus("Open a thread first to reply");
          haptic("warn");
          return;
        }
        setShowCompose(true);
        haptic("tap");
      },
    },
    {
      id: "mail.reply-all",
      label: "Reply all",
      description: "Reply to all recipients of the currently open mail thread",
      phrases: ["reply all", "reply to all"],
      handler: () => {
        if (!messages.length) {
          setStatus("Open a thread first to reply all");
          haptic("warn");
          return;
        }
        replyAll();
      },
    },
    {
      id: "mail.forward",
      label: "Forward",
      description: "Forward the currently open mail thread",
      phrases: ["forward", "forward this", "forward this email", "forward this message"],
      handler: () => {
        if (!messages.length) {
          setStatus("Open a thread first to forward it");
          haptic("warn");
          return;
        }
        composeForward();
      },
    },
  ];

  useRegisterCommands(mailCommands);

  function runAutocomplete() {
    startTransition(async () => {
      const suggestion = await autocompleteAction(
        composeHtml.replace(/<[^>]+>/g, " "),
      );
      if (suggestion) {
        setComposeHtml((h) => `${h}<p>${suggestion}</p>`);
        haptic("success");
      } else {
        haptic("warn");
      }
    });
  }

  /**
   * Always-visible AI writing surface for compose (docked + fullscreen).
   * Instruction → draft the reply / first mail, tone presets + a free-text
   * "exact change" box to reshape the current draft.
   */
  function ComposeAiAssist() {
    const replying = isReplyContext();
    const chip =
      "cursor-pointer rounded-full px-2.5 py-1 text-[0.66rem] font-medium transition-opacity disabled:opacity-50";
    const chipStyle = {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid var(--border-strong)",
      color: "var(--text-muted)",
    } as const;
    return (
      <div
        className="shrink-0 space-y-2.5 rounded-xl px-3.5 py-3"
        style={{
          background: "rgba(139,92,246,0.1)",
          border: "1px solid rgba(139,92,246,0.28)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <AnimatedSparkle size={13} />
          <span
            className="text-[0.68rem] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--accent-bright)" }}
          >
            AI assist
          </span>
        </div>
        {/* Instruction → generate the draft (reply or first mail) */}
        <div className="flex gap-2">
          <input
            className="mail-search min-w-0 flex-1 text-xs"
            placeholder={
              replying
                ? "How should I reply? e.g. politely decline, ask for pricing…"
                : "What should this email say? e.g. intro BluRidge, propose a 20-min call…"
            }
            value={composeBrief}
            disabled={pending}
            onChange={(e) => setComposeBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runAiDraft();
              }
            }}
          />
          <VoiceButton
            disabled={pending}
            onText={(t) => {
              const next = composeBrief ? `${composeBrief} ${t}` : t;
              setComposeBrief(next);
              runAiDraft(next);
            }}
          />
          <GhostBtn primary disabled={pending} onClick={runAiDraft}>
            {pending ? "Drafting…" : replying ? "Draft reply" : "Draft"}
          </GhostBtn>
        </div>
        {/* One-tap tone/shape presets + Hindi — reshape the current draft */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.62rem]" style={{ color: "var(--text-dim)" }}>
            Adjust:
          </span>
          {DRAFT_REFINE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              className={chip}
              style={chipStyle}
              onClick={() => {
                haptic("tap");
                applyDraftRefine(p.id);
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            disabled={pending}
            className={chip}
            style={chipStyle}
            onClick={runMultilingualHindi}
          >
            Hindi
          </button>
        </div>
        {/* Free-text exact edit */}
        <div className="flex gap-2">
          <input
            className="mail-search min-w-0 flex-1 text-xs"
            placeholder="Or type an exact change… e.g. mention the Friday call, add my number"
            value={refineNote}
            disabled={pending}
            onChange={(e) => setRefineNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && refineNote.trim()) {
                e.preventDefault();
                applyDraftRefine();
              }
            }}
          />
          <VoiceButton
            disabled={pending}
            onText={(t) => {
              const next = refineNote ? `${refineNote} ${t}` : t;
              setRefineNote(next);
              applyDraftRefine(undefined, next);
            }}
          />
          <GhostBtn
            disabled={pending || !refineNote.trim()}
            onClick={() => applyDraftRefine()}
          >
            Apply
          </GhostBtn>
        </div>
      </div>
    );
  }

  /** Attached-file chips shared by both compose modes. */
  function AttachmentChips() {
    if (!composeAttachments.length && !uploadingAtt) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        {composeAttachments.map((a, i) => (
          <motion.span
            key={`${a.path}-${i}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-medium"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-muted)",
            }}
          >
            <Paperclip size={11} className="shrink-0" />
            <span className="max-w-44 truncate">{a.filename}</span>
            <span style={{ color: "var(--text-dim)" }}>
              {a.size > 1024 * 1024
                ? `${(a.size / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.max(1, Math.round(a.size / 1024))} KB`}
            </span>
            <button
              type="button"
              title="Remove attachment"
              className="cursor-pointer opacity-70 hover:opacity-100"
              onClick={() => {
                setComposeAttachments((prev) =>
                  prev.filter((_, j) => j !== i),
                );
                haptic("tap");
              }}
            >
              <X size={11} />
            </button>
          </motion.span>
        ))}
        {uploadingAtt && (
          <span
            className="flex items-center gap-1.5 text-[0.68rem]"
            style={{ color: "var(--accent-bright)" }}
          >
            <Loader2 size={12} className="animate-spin" /> uploading…
          </span>
        )}
      </div>
    );
  }

  /** Send bar: AI toggle + attach + schedule + save + send (both modes). */
  function ComposeActionBar({ mode }: { mode: "docked" | "fullscreen" }) {
    return (
      <div>
        {AttachmentChips()}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className="mr-auto text-[0.65rem]"
            style={{ color: "var(--text-dim)" }}
          >
            From {composeAccountAddress}
            {draftId ? " · draft saved" : ""}
          </span>
          <IconBtn
            title={showAiAssist ? "Hide AI assist" : "AI assist — draft, tone, edits"}
            active={showAiAssist}
            icon={<AnimatedSparkle size={15} color="currentColor" />}
            onClick={() => setShowAiAssist((v) => !v)}
          />
          <IconBtn
            title="Attach files"
            icon={<Paperclip size={15} />}
            disabled={uploadingAtt || sending}
            onClick={() => attachInputRef.current?.click()}
          />
          {mode === "docked" && (
            <IconBtn
              title="Fullscreen compose"
              icon={<Maximize2 size={15} />}
              onClick={() => {
                setComposeFullscreen(true);
                haptic("tap");
              }}
            />
          )}
          <IconBtn
            title="Autocomplete — continue writing"
            icon={<WandSparkles size={15} />}
            disabled={pending}
            onClick={runAutocomplete}
          />
          <div className="relative" data-menu>
            <IconBtn
              title={
                sendAtLocal
                  ? `Scheduled for ${formatWhen(new Date(sendAtLocal))}`
                  : "Schedule send"
              }
              active={showSchedule || Boolean(sendAtLocal)}
              icon={<CalendarClock size={15} />}
              disabled={sending}
              onClick={() => setShowSchedule((v) => !v)}
            />
            {showSchedule && (
              <div
                className="absolute bottom-full right-0 z-20 mb-2 w-64 space-y-2 rounded-xl p-2.5 shadow-lg"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <p
                  className="text-[0.62rem] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "var(--text-dim)" }}
                >
                  Schedule send
                </p>
                <input
                  type="datetime-local"
                  className="mail-search w-full py-1 text-[0.7rem]"
                  value={sendAtLocal}
                  disabled={sending}
                  onChange={(e) => setSendAtLocal(e.target.value)}
                />
                {sendAtLocal && (
                  <button
                    type="button"
                    className="cursor-pointer text-[0.68rem] font-medium"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => {
                      setSendAtLocal("");
                      setShowSchedule(false);
                      haptic("tap");
                    }}
                  >
                    Clear schedule — send immediately
                  </button>
                )}
              </div>
            )}
          </div>
          <IconBtn
            title={draftId ? "Discard draft" : "Discard"}
            icon={<Trash2 size={15} />}
            disabled={sending}
            onClick={discardDraft}
          />
          <IconBtn
            title="Save draft"
            icon={<Save size={15} />}
            disabled={pending || sending}
            onClick={saveCurrentDraft}
          />
          <IconBtn
            primary
            size="lg"
            title={
              sending
                ? "Sending…"
                : sendAtLocal
                  ? "Schedule send"
                  : "Send (⌘↵)"
            }
            disabled={sending || !to.trim()}
            icon={
              sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : sendAtLocal ? (
                <CalendarClock size={16} />
              ) : (
                <SendHorizontal size={16} />
              )
            }
            onClick={sendCurrentDraft}
          />
        </div>
      </div>
    );
  }

  function runSync(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) haptic("tap");
    if (!opts?.quiet) {
      setSyncing(true);
      setJobProgress({
        kind: "sync",
        label: "Connecting to mail.thebluridge.com…",
      });
      setStatus("Refreshing…");
    }
    const phases = [
      "Connecting to mail.thebluridge.com…",
      "Listing folders…",
      "Importing messages…",
      "Refreshing labels…",
    ];
    let phaseIdx = 0;
    const phaseTimer =
      opts?.quiet
        ? null
        : window.setInterval(() => {
            phaseIdx = Math.min(phaseIdx + 1, phases.length - 1);
            setJobProgress({
              kind: "sync",
              label: phases[phaseIdx]!,
            });
          }, 2800);

    // Nav transition — must not freeze compose buttons via `pending`
    startNavTransition(async () => {
      try {
        const r = await syncMailAction({ accountId: accountInfo?.id });
        if (r.bootstrap?.configured) applyBootstrap(r.bootstrap);
        await reloadActiveViewRef.current();
        const msg =
          `Refreshed · ${r.imported} new` +
          (r.triaged ? ` · ${r.triaged} categorized` : "");
        setStatus(msg);
        if (!opts?.quiet) {
          setJobProgress({
            kind: "sync",
            label: msg,
            current: 1,
            total: 1,
          });
          haptic("success");
        }
      } catch (e) {
        if (!opts?.quiet) {
          setStatus(e instanceof Error ? e.message : "Refresh failed");
          setJobProgress(null);
          haptic("warn");
        }
      } finally {
        if (phaseTimer != null) window.clearInterval(phaseTimer);
        if (!opts?.quiet) {
          setSyncing(false);
          window.setTimeout(() => setJobProgress(null), 1800);
        }
      }
    });
  }

  // Desktop notifications are opt-in (explicit toggle click, not an
  // unprompted permission request) — but once granted, stay on across visits.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setDesktopNotifsEnabled(Notification.permission === "granted");
  }, []);
  useEffect(() => {
    desktopNotifsRef.current = desktopNotifsEnabled;
  }, [desktopNotifsEnabled]);

  function toggleDesktopNotifications() {
    if (typeof Notification === "undefined") {
      setStatus("Desktop notifications aren't supported in this browser");
      haptic("warn");
      return;
    }
    if (desktopNotifsEnabled) {
      setDesktopNotifsEnabled(false);
      setStatus("Desktop notifications off");
      haptic("tap");
      return;
    }
    void Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        setDesktopNotifsEnabled(true);
        setStatus("Desktop notifications on — you'll be notified of new mail when this tab isn't focused");
        haptic("success");
      } else {
        setStatus("Notifications blocked — allow them in your browser's site settings");
        haptic("warn");
      }
    });
  }

  // Live updates via IMAP IDLE → SSE (near real-time)
  useEffect(() => {
    if (!configured) return;
    let es: EventSource | null = null;
    let closed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        // A background live-sync refresh must never clobber an active search:
        // `threads` backs both the folder view and search results, and
        // reloadActiveView() always repopulates it from the current FOLDER,
        // with no awareness of an in-progress search. Firing it mid-search
        // silently replaces the visible search results with the folder's
        // default listing (same state, unrelated data) — any result not also
        // in that default listing (e.g. an older thread) vanishes from
        // `threads` entirely, and clicking it right as this races leaves the
        // reader stuck on "Select a thread" forever, since openThread's
        // fallback-synthesis check only ran once, at click time, against a
        // `threads` snapshot that still contained it.
        if (threadQueryRef.current.trim().length >= 2) return;
        void reloadActiveViewRef.current().then(() => {
          setAccountInfo((a) => (a ? { ...a, lastSyncedAt: new Date() } : a));
          setStatus((s) =>
            s.startsWith("Live") || !s ? "Live · mailbox updated" : s,
          );
        });
      }, 350);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/mail/live");
      es.onopen = () => setLiveConnected(true);
      es.onerror = () => {
        // EventSource reconnects automatically; mark offline until next open
        setLiveConnected(false);
      };
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as {
            type?: string;
            accountId?: string;
            imported?: number;
            folderRole?: string;
          };
          if (data.type === "hello" || data.type === "ping") {
            setLiveConnected(true);
          }
          if (data.type === "mail:updated") {
            // With IDLE running per mailbox, an update on some *other*
            // mailbox than the one currently in view would otherwise
            // trigger a pointless refetch of what's on screen — only
            // refresh when it's relevant to what's actually being viewed.
            const relevant =
              !data.accountId ||
              data.accountId === accountInfoRef.current?.id ||
              activeFolderRef.current === ALL_INBOXES_ID;
            if (relevant) scheduleRefresh();
            if (
              desktopNotifsRef.current &&
              (data.imported ?? 0) > 0 &&
              data.folderRole !== "SENT" &&
              document.visibilityState !== "visible" &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              const n = new Notification("New mail", {
                body: `${data.imported} new message${data.imported === 1 ? "" : "s"}`,
                tag: "mail-update",
              });
              n.onclick = () => {
                window.focus();
                n.close();
              };
            }
          }
          if (data.type === "mail:idle") {
            setLiveConnected(true);
            setStatus((s) => s || "Live · watching mailbox");
          }
        } catch {
          /* ignore malformed */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      setLiveConnected(false);
      if (refreshTimer) clearTimeout(refreshTimer);
      es?.close();
    };
  }, [configured]);

  // Fallback poll only when live channel is down
  useEffect(() => {
    if (!configured || liveConnected) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      runSync({ quiet: true });
    };
    const id = window.setInterval(tick, MAIL_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, liveConnected]);

  if (!configured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-8"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid rgba(245,158,11,0.35)",
        }}
      >
        <h2 className="text-lg font-semibold" style={{ color: "var(--warning)" }}>
          Connect CEO mailbox
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Set <code>CEO_MAIL_USER</code> / <code>CEO_MAIL_PASS</code> for
          akshay@thebluridge.com in <code>.env.local</code>, then restart the app.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="mail-shell relative flex h-[calc(100vh-7.5rem)] min-h-[560px] flex-col gap-3 overflow-hidden">
      {/* Shared hidden file input for compose attachments (docked + fullscreen) */}
      <input
        ref={attachInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onPickAttachments(e.target.files)}
      />
      {/* Header — one compact row. The app shell already shows a "BluRidge ›
          Mail" breadcrumb above this, so no title block is duplicated here. */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="flex flex-wrap items-center justify-between gap-3 px-2"
      >
        <div className="min-w-0 flex items-baseline gap-2">
          <h1
            className="shrink-0 text-base font-semibold tracking-tight"
            style={{ color: "var(--mail-text)" }}
          >
            Command inbox
          </h1>
          <p
            className="truncate text-xs"
            style={{ color: "var(--mail-dim)" }}
            suppressHydrationWarning
          >
            {activeFolder === ALL_INBOXES_ID ? (
              <>
                <span style={{ color: "var(--mail-muted)" }}>All Inboxes</span>
                {` · ${mailAccounts.length} mailboxes merged · ${threads.length} threads`}
              </>
            ) : (
              <>
                <span style={{ color: "var(--mail-muted)" }}>{accountInfo?.address}</span>
                {accountInfo?.lastSyncedAt
                  ? ` · ${timesReady ? formatSyncedAgo(accountInfo.lastSyncedAt, nowTick) : "—"} · ${threads.length} threads`
                  : " · not synced — hit Refresh"}
                {liveConnected ? " · live" : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostBtn onClick={composeNew} primary>
            Compose
          </GhostBtn>
          <IconBtn
            title={syncing ? "Refreshing…" : "Refresh mailbox"}
            icon={
              <RefreshCw
                size={15}
                className={syncing ? "animate-spin" : undefined}
              />
            }
            disabled={syncing || categorizing}
            onClick={() => runSync()}
          />

          {/* AI mailbox actions, grouped */}
          <div
            className="flex flex-wrap items-center gap-0.5 rounded-full pl-2.5 pr-1.5 py-1"
            style={{
              background: "var(--mail-purple-dim)",
              border: "1px solid rgba(139,92,246,0.28)",
            }}
          >
            <AnimatedSparkle size={13} className="mr-1" />
            <GhostBtn
              bare
              onClick={runCategorizeAll}
              disabled={categorizing || syncing}
            >
              {categorizing
                ? jobProgress?.current != null && jobProgress.total
                  ? `${jobProgress.current}/${jobProgress.total}`
                  : "Categorizing…"
                : "Categorize"}
            </GhostBtn>
            <GhostBtn
              bare
              onClick={() =>
                startTransition(async () => {
                  haptic("tap");
                  const d = await digestAction(accountInfo?.id);
                  setDigest(
                    d.groups
                      .map(
                        (g) =>
                          `${g.priority} — ${g.items.map((i) => i.subject).join(" · ")}`,
                      )
                      .join("\n") || "Inbox is quiet.",
                  );
                  haptic("success");
                })
              }
            >
              Digest
            </GhostBtn>
            <GhostBtn
              bare
              onClick={() =>
                startTransition(async () => {
                  haptic("tap");
                  const n = await createFollowUpRemindersAction(accountInfo?.id);
                  setStatus(`Follow-ups queued: ${n.length}`);
                  haptic("success");
                })
              }
            >
              Follow-ups
            </GhostBtn>
            <GhostBtn bare onClick={runBulkCleanup} disabled={pending}>
              Cleanup
            </GhostBtn>
            <GhostBtn
              bare
              onClick={() =>
                startTransition(async () => {
                  haptic("tap");
                  const style = await refreshStyleAction(accountInfo?.id);
                  setStatus(
                    style
                      ? `Style refreshed (${style.sampleCount} sent samples)`
                      : "No sent samples for style",
                  );
                  haptic(style ? "success" : "warn");
                })
              }
            >
              Style
            </GhostBtn>
          </div>

          <div className="relative" data-menu>
            <IconBtn
              title="Mail settings"
              active={showSettingsMenu}
              icon={<Settings size={15} />}
              onClick={() => {
                setShowSettingsMenu((v) => !v);
                haptic("tap");
              }}
            />
            {showSettingsMenu && (
              <ul
                className="absolute right-0 z-20 mt-1 w-56 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      startTransition(async () => {
                        haptic("tap");
                        const rows = await listMailAccountsAction();
                        setMailAccounts(rows);
                        setShowMailboxes(true);
                      });
                    }}
                  >
                    <MailIcon size={14} /> Mailboxes
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowCalendarPanel(true);
                      haptic("tap");
                    }}
                  >
                    <CalendarClock size={14} /> Calendar
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      startTransition(async () => {
                        haptic("tap");
                        const rows = await listLabelRulesAction(accountInfo?.id);
                        setLabelRules(rows);
                        setShowRules(true);
                      });
                    }}
                  >
                    <SlidersHorizontal size={14} /> Auto-label rules
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowSignatures(true);
                      haptic("tap");
                    }}
                  >
                    <PenLine size={14} /> Signatures
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowVacation(true);
                      haptic("tap");
                    }}
                  >
                    <Plane size={14} /> Out of office
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowShortcutHelp(true);
                      haptic("tap");
                    }}
                  >
                    <Keyboard size={14} /> Keyboard shortcuts
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                    onClick={toggleDesktopNotifications}
                  >
                    {desktopNotifsEnabled ? (
                      <BellRing size={14} />
                    ) : (
                      <Bell size={14} />
                    )}
                    Desktop notifications
                    <span
                      className="ml-auto text-[0.65rem] font-semibold"
                      style={{
                        color: desktopNotifsEnabled
                          ? "#34d399"
                          : "var(--text-dim)",
                      }}
                    >
                      {desktopNotifsEnabled ? "On" : "Off"}
                    </span>
                  </button>
                </li>
                <li>
                  <div className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2" style={{ color: "var(--text)" }}>
                    <Clock3 size={14} />
                    <span>Undo send window</span>
                    <span className="ml-auto flex gap-1">
                      {([10, 20] as const).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          className="cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                          style={{
                            background:
                              undoWindowSec === sec
                                ? "var(--mail-purple-dim)"
                                : "var(--bg-elevated)",
                            color: undoWindowSec === sec ? "#c4b5fd" : "var(--text-dim)",
                            border: "1px solid var(--border-strong)",
                          }}
                          onClick={() => setUndoWindowSec(sec)}
                        >
                          {sec}s
                        </button>
                      ))}
                    </span>
                  </div>
                </li>
              </ul>
            )}
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {jobProgress && (
          <motion.div
            key={`${jobProgress.kind}-${jobProgress.label}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mx-2 overflow-hidden rounded-xl px-3 py-2"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(129,140,248,0.28)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.7rem]">
              <span style={{ color: "var(--accent-bright)" }}>
                {jobProgress.kind === "sync" ? "Refresh" : "Categorize"}
                {" · "}
                {jobProgress.label}
              </span>
              <span
                className="tabular-nums"
                style={{ color: "var(--mail-dim)" }}
              >
                {jobProgress.total != null && jobProgress.current != null
                  ? `${jobProgress.current} / ${jobProgress.total}`
                  : syncing || categorizing
                    ? "working…"
                    : ""}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <div
                className={
                  jobProgress.total == null
                    ? "mail-job-progress-indeterminate h-full rounded-full"
                    : "h-full rounded-full transition-[width] duration-300"
                }
                style={{
                  width:
                    jobProgress.total != null && jobProgress.current != null
                      ? `${Math.min(
                          100,
                          Math.round(
                            (jobProgress.current /
                              Math.max(jobProgress.total, 1)) *
                              100,
                          ),
                        )}%`
                      : "40%",
                  background: "var(--mail-grad, linear-gradient(90deg,#818cf8,#c084fc))",
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SignaturesPanel
        open={showSignatures}
        onClose={() => setShowSignatures(false)}
        signatures={sigList}
        onChange={setSigList}
        accountId={accountInfo?.id}
      />

      <VacationPanel
        open={showVacation}
        onClose={() => setShowVacation(false)}
        accountId={accountInfo?.id}
      />

      <MailboxesPanel
        open={showMailboxes}
        onClose={() => setShowMailboxes(false)}
        accounts={mailAccounts}
        onChange={setMailAccounts}
      />

      <CalendarPanel
        open={showCalendarPanel}
        onClose={() => setShowCalendarPanel(false)}
        accountId={accountInfo?.id}
        accountAddress={accountInfo?.address}
      />

      <ScheduleMeetingPanel
        open={Boolean(scheduleMeetingDefaults)}
        onClose={() => setScheduleMeetingDefaults(null)}
        accountId={accountInfo?.id}
        defaultTitle={scheduleMeetingDefaults?.title || "Meeting"}
        defaultAttendees={scheduleMeetingDefaults?.attendees || []}
      />

      <AnimatePresence>
        {showRules && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close rules"
              className="absolute inset-0 cursor-pointer"
              style={{ background: "rgba(0,0,0,0.55)" }}
              onClick={() => setShowRules(false)}
            />
            <div
              className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl p-4"
              style={{
                background: "var(--bg-elevated, #12141c)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                  Auto-label rules
                </h2>
                <GhostBtn onClick={() => setShowRules(false)}>Close</GhostBtn>
              </div>
              <div className="mb-3 grid gap-2">
                <input
                  className="mail-search text-xs"
                  placeholder="Rule name"
                  value={ruleDraft.name}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, name: e.target.value }))
                  }
                />
                <input
                  className="mail-search text-xs"
                  placeholder="Label (e.g. NEWSLETTER)"
                  value={ruleDraft.label}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, label: e.target.value }))
                  }
                />
                <input
                  className="mail-search text-xs"
                  placeholder="From contains…"
                  value={ruleDraft.fromContains}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, fromContains: e.target.value }))
                  }
                />
                <input
                  className="mail-search text-xs"
                  placeholder="Subject contains…"
                  value={ruleDraft.subjectContains}
                  onChange={(e) =>
                    setRuleDraft((d) => ({
                      ...d,
                      subjectContains: e.target.value,
                    }))
                  }
                />
                <GhostBtn
                  primary
                  disabled={pending || !ruleDraft.name.trim() || !ruleDraft.label.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      await upsertLabelRuleAction({
                        name: ruleDraft.name.trim(),
                        label: ruleDraft.label.trim(),
                        fromContains: ruleDraft.fromContains || undefined,
                        subjectContains: ruleDraft.subjectContains || undefined,
                        accountId: accountInfo?.id,
                      });
                      setLabelRules(await listLabelRulesAction());
                      setRuleDraft({
                        name: "",
                        label: "NEWSLETTER",
                        fromContains: "",
                        subjectContains: "",
                      });
                      setStatus("Label rule saved");
                      haptic("success");
                    })
                  }
                >
                  Add rule
                </GhostBtn>
              </div>
              <ul className="space-y-2">
                {labelRules.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-2 rounded-lg px-2 py-2 text-xs"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text)" }}>
                        {r.name} → {r.label}
                        {r.origin === "correction" && (
                          <span
                            title="Created automatically from a label correction"
                            className="rounded-full px-1.5 py-0.5 text-[0.6rem] font-normal"
                            style={{
                              background: "var(--mail-purple-dim)",
                              color: "#c4b5fd",
                            }}
                          >
                            learned
                          </span>
                        )}
                      </div>
                      <div className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                        {r.matchJson}
                      </div>
                    </div>
                    <GhostBtn
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteLabelRuleAction(r.id, accountInfo?.id);
                          setLabelRules(await listLabelRulesAction());
                        })
                      }
                    >
                      Delete
                    </GhostBtn>
                  </li>
                ))}
                {!labelRules.length && (
                  <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                    No rules yet — applied on sync when present.
                  </p>
                )}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bulkSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-xl px-4 py-3 text-xs"
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
              color: "#fbbf24",
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[0.65rem] uppercase tracking-wider">
                Bulk cleanup ({bulkSuggestions.length})
              </span>
              <button
                type="button"
                className="text-[0.65rem]"
                style={{ color: "var(--text-dim)" }}
                onClick={() => setBulkSuggestions([])}
              >
                Dismiss
              </button>
            </div>
            <ul className="max-h-40 space-y-1 overflow-auto">
              {bulkSuggestions.slice(0, 20).map((b) => (
                <li key={b.threadId} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left"
                    onClick={() => openThread(b.threadId)}
                  >
                    {b.subject} · {b.priority}
                  </button>
                  <GhostBtn
                    disabled={pending}
                    onClick={() => {
                      const ok = window.confirm(`Trash “${b.subject}”?`);
                      if (!ok) return;
                      startTransition(async () => {
                        await trashThreadAction(b.threadId, true);
                        setBulkSuggestions((prev) =>
                          prev.filter((x) => x.threadId !== b.threadId),
                        );
                        setThreads((prev) =>
                          prev.filter((t) => t.id !== b.threadId),
                        );
                      });
                    }}
                  >
                    Trash
                  </GhostBtn>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {status && !jobProgress && (
          <motion.p
            key={status}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs"
            style={{ color: "var(--accent-bright)" }}
          >
            {status}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {digest && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-xl px-4 py-3 text-xs leading-relaxed"
            style={{
              background: "var(--gold-dim)",
              border: "1px solid rgba(240,180,41,0.25)",
              color: "var(--gold)",
            }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[0.65rem] uppercase tracking-wider">AI digest</span>
              <button
                type="button"
                className="text-[0.65rem]"
                style={{ color: "var(--text-dim)" }}
                onClick={() => setDigest("")}
              >
                Dismiss
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans">{digest}</pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workspace */}
      {/* 24-col base (not 12) so the collapsed rail can take a genuinely
          narrow slice (1/24) instead of being stuck at the coarsest 1/12. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-1 lg:grid-cols-[repeat(24,minmax(0,1fr))]">
        {/* Folders + labels */}
        <motion.aside
          layout
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.05 }}
          className={`mail-panel flex min-h-0 flex-col overflow-hidden ${foldersCollapsed ? "lg:col-span-[1]" : "lg:col-span-[4]"}`}
        >
          <div
            className="flex items-center justify-end px-1 pt-1"
            style={{ borderBottom: "1px solid var(--mail-border)" }}
          >
            <IconBtn
              title={foldersCollapsed ? "Expand folders" : "Collapse folders"}
              icon={
                foldersCollapsed ? (
                  <ChevronsRight size={14} />
                ) : (
                  <ChevronsLeft size={14} />
                )
              }
              onClick={() => setFoldersCollapsed((v) => !v)}
            />
          </div>
          {foldersCollapsed ? (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-1.5">
              {mailAccounts.length > 1 && (
                <div className="mb-1 flex flex-col items-center gap-1 pb-1" style={{ borderBottom: "1px solid var(--mail-border)" }}>
                  {mailAccounts.map((a) => {
                    const tone = labelTone(a.address);
                    const active = a.id === accountInfo?.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => switchAccount(a)}
                        title={a.address}
                        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[0.6rem] font-semibold"
                        style={{
                          background: active ? tone.bg : "transparent",
                          color: tone.fg,
                          border: active ? `1px solid ${tone.fg}` : "1px solid transparent",
                        }}
                      >
                        {accountShortName(a)[0]?.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              )}
              <FolderRow
                compact
                name="Smart Inbox"
                badge="★"
                icon={<Star size={16} />}
                active={activeFolder === SMART_INBOX_ID && !activeSmartLabel}
                onClick={selectSmartInbox}
              />
              {mailAccounts.length > 1 && (
                <FolderRow
                  compact
                  name="All Inboxes"
                  badge="Σ"
                  icon={<Layers size={16} />}
                  active={activeFolder === ALL_INBOXES_ID && !activeSmartLabel}
                  onClick={selectAllInboxes}
                />
              )}
              {systemFolders.map((f) => (
                <FolderRow
                  compact
                  key={f.id}
                  name={f.role === "INBOX" ? "All Inbox" : f.name}
                  badge={f.role === "INBOX" ? "All" : f.role.slice(0, 3)}
                  icon={systemFolderIcon(f.role)}
                  active={f.id === activeFolder && !activeSmartLabel}
                  onClick={() => selectFolder(f.id)}
                />
              ))}
              <FolderRow
                compact
                name="Outbox"
                badge="Out"
                icon={<Clock3 size={16} />}
                active={activeFolder === OUTBOX_ID && !activeSmartLabel}
                onClick={selectOutbox}
              />
            </div>
          ) : (
          <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            {mailAccounts.length > 1 && (
              <div className="mb-1 space-y-0.5 pb-1" style={{ borderBottom: "1px solid var(--mail-border)" }}>
                {mailAccounts.map((a) => {
                  const tone = labelTone(a.address);
                  const active = a.id === accountInfo?.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => switchAccount(a)}
                      title={a.address}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                      style={{
                        background: active ? "var(--bg-elevated)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--mail-dim)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: tone.fg }}
                      />
                      <span className="truncate">
                        {accountShortName(a)}
                      </span>
                      {a.isPrimary && (
                        <span
                          className="ml-auto shrink-0 text-[0.6rem]"
                          style={{ color: "var(--mail-dim)" }}
                        >
                          Primary
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <FolderSection
              title="Mailboxes"
              open={mailboxesOpen}
              onToggle={() => setMailboxesOpen((v) => !v)}
            >
              <FolderRow
                name="Smart Inbox"
                badge="★"
                active={activeFolder === SMART_INBOX_ID && !activeSmartLabel}
                onClick={selectSmartInbox}
              />
              {mailAccounts.length > 1 && (
                <FolderRow
                  name="All Inboxes"
                  badge="Σ"
                  active={activeFolder === ALL_INBOXES_ID && !activeSmartLabel}
                  onClick={selectAllInboxes}
                />
              )}
              {systemFolders.map((f) => (
                <FolderRow
                  key={f.id}
                  name={f.role === "INBOX" ? "All Inbox" : f.name}
                  badge={f.role === "INBOX" ? "All" : f.role.slice(0, 3)}
                  active={f.id === activeFolder && !activeSmartLabel}
                  onClick={() => selectFolder(f.id)}
                />
              ))}
              <FolderRow
                name="Outbox"
                badge="Out"
                active={activeFolder === OUTBOX_ID && !activeSmartLabel}
                onClick={selectOutbox}
              />
              {!systemFolders.length && (
                <p className="px-2 py-3 text-xs" style={{ color: "var(--mail-dim)" }}>
                  Sync to load folders
                </p>
              )}
            </FolderSection>

            <FolderSection
              title="Labels"
              open={labelsOpen}
              onToggle={() => setLabelsOpen((v) => !v)}
              action={
                <button
                  type="button"
                  className="cursor-pointer text-[0.65rem] font-semibold"
                  style={{ color: "var(--accent-bright)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewLabel((v) => !v);
                    setLabelsOpen(true);
                  }}
                >
                  + New
                </button>
              }
            >
              {showNewLabel && (
                <div className="mb-1 flex gap-1 px-1">
                  <input
                    className="mail-search min-w-0 flex-1 text-xs"
                    placeholder="Label name"
                    value={newLabelName}
                    disabled={pending}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createLabel();
                    }}
                  />
                  <GhostBtn disabled={pending || !newLabelName.trim()} onClick={createLabel}>
                    Add
                  </GhostBtn>
                </div>
              )}
              {labelFolderTree.map((n) => renderFolderNode(n))}
              {!labelFolders.length && !showNewLabel && (
                <p className="px-2 py-2 text-[0.7rem]" style={{ color: "var(--mail-dim)" }}>
                  No custom labels yet
                </p>
              )}
            </FolderSection>

            <FolderSection
              title="Smart labels"
              open={smartOpen}
              onToggle={() => setSmartOpen((v) => !v)}
            >
              {SMART_LABELS.map((id) => {
                const meta = SMART_LABEL_META[id];
                const active = activeSmartLabel === id;
                return (
                  <FolderRow
                    key={id}
                    name={meta.label}
                    badge={meta.hint.slice(0, 3)}
                    active={active}
                    onClick={() => selectSmartLabel(id)}
                  />
                );
              })}
              <p className="px-2 pt-1 text-[0.65rem]" style={{ color: "var(--mail-dim)" }}>
                AI fills these on sync (new mail) or via Categorize
              </p>
            </FolderSection>
          </div>
          )}

          {!foldersCollapsed && reminders.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)" }}>
              <div
                className="px-3 py-2 text-[0.65rem] uppercase tracking-[0.18em]"
                style={{ color: "var(--warning)" }}
              >
                Reminders
              </div>
              <ul className="max-h-28 space-y-1 overflow-auto px-2 pb-2">
                {reminders.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-1 rounded-lg px-2 py-1.5 text-[0.7rem]"
                    style={{
                      background: "rgba(245,158,11,0.1)",
                      color: "#fbbf24",
                    }}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate text-left"
                      onClick={() => {
                        // threadId may be on reminder when present
                        const tid = (r as Reminder & { threadId?: string | null })
                          .threadId;
                        if (tid) openThread(tid);
                      }}
                    >
                      {r.note || r.kind}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer text-[0.65rem] opacity-80 hover:opacity-100"
                      onClick={() =>
                        startTransition(async () => {
                          await dismissReminderAction(r.id, accountInfo?.id);
                          setReminders((prev) => prev.filter((x) => x.id !== r.id));
                          haptic("tap");
                        })
                      }
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.aside>

        {/* Thread list — collapses into focus mode while composing a reply,
            unless pinned back via threadsPinnedWhileComposing */}
        <AnimatePresence mode="popLayout">
          {!hideThreadsForFocus && (
        <motion.section
          key="thread-list"
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ ...spring, delay: hideThreadsForFocus ? 0 : 0.08 }}
          className={`mail-panel flex min-h-0 flex-col overflow-hidden ${foldersCollapsed ? "lg:col-span-[9]" : "lg:col-span-[6]"}`}
        >
          <div
            className="space-y-2.5 px-3 py-3"
            style={{ borderBottom: "1px solid var(--mail-border)" }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[0.65rem] font-semibold uppercase tracking-[0.18em]"
                style={{ color: "var(--mail-dim)" }}
              >
                Threads
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                  style={{
                    background: "var(--mail-purple-dim)",
                    color: "#c4b5fd",
                  }}
                >
                  {filteredThreads.length}
                </span>
                <IconBtn
                  title={selectModeEnabled ? "Done selecting" : "Select threads for bulk actions"}
                  active={selectModeEnabled}
                  icon={<ListChecks size={14} />}
                  onClick={toggleSelectMode}
                />
              </div>
            </div>
            <div className="relative">
              <input
                ref={searchInputRef}
                className="mail-search pr-8"
                placeholder={
                  searching
                    ? "Searching…"
                    : "Search mail  ·  press /  ·  e.g. SBI POS machine…"
                }
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
              />
              {threadQuery.length > 0 && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-0.5 text-xs opacity-60 hover:opacity-100"
                  style={{ color: "var(--mail-dim)" }}
                  onClick={() => {
                    setThreadQuery("");
                    haptic("tap");
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                  ["priority", "Priority"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`mail-pill ${threadFilter === id ? "is-active" : ""}`}
                  onClick={() => {
                    setThreadFilter(id);
                    haptic("tap");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <AnimatePresence>
              {selectedThreadIds.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={spring}
                  className="flex flex-wrap items-center gap-1.5 overflow-hidden rounded-lg px-2 py-1.5"
                  style={{ background: "var(--mail-purple-dim)" }}
                >
                  <span
                    className="text-[0.68rem] font-semibold"
                    style={{ color: "#c4b5fd" }}
                  >
                    {selectedThreadIds.size} selected
                  </span>
                  {selectedThreadIds.size < filteredThreads.length && (
                    <button
                      type="button"
                      className="cursor-pointer text-[0.65rem] font-medium underline"
                      style={{ color: "#c4b5fd" }}
                      onClick={selectAllOnPage}
                    >
                      Select all {filteredThreads.length}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <IconBtn
                      title="Archive selected"
                      icon={<ArchiveIcon size={14} />}
                      onClick={bulkArchive}
                    />
                    <IconBtn
                      title="Trash selected"
                      danger
                      icon={<Trash2 size={14} />}
                      onClick={bulkTrash}
                    />
                    <IconBtn
                      title={viewingJunk ? "Not spam" : "Report spam"}
                      icon={
                        viewingJunk ? (
                          <ShieldOff size={14} />
                        ) : (
                          <ShieldAlert size={14} />
                        )
                      }
                      onClick={viewingJunk ? bulkMarkNotSpam : bulkMarkSpam}
                    />
                    <div className="relative" data-menu>
                      <IconBtn
                        title="Move selected to…"
                        active={showBulkMoveMenu}
                        icon={<FolderInput size={14} />}
                        onClick={() => setShowBulkMoveMenu((v) => !v)}
                      />
                      {showBulkMoveMenu && (
                        <ul
                          className="absolute right-0 z-10 mt-1 max-h-56 w-44 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                          style={{
                            background: "var(--bg-elevated)",
                            border: "1px solid var(--border-strong)",
                          }}
                        >
                          {folderList
                            .filter((f) => f.role !== "TRASH")
                            .map((f) => (
                              <li key={f.id}>
                                <button
                                  type="button"
                                  className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                  style={{ color: "var(--text)" }}
                                  onClick={() => bulkMoveTo(f.id, f.name)}
                                >
                                  {f.name}
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                    <IconBtn
                      title="Clear selection"
                      icon={<X size={14} />}
                      onClick={clearThreadSelection}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <motion.ul
            ref={threadsListRef}
            variants={listStagger}
            initial="hidden"
            animate="show"
            className="min-h-0 flex-1 overflow-auto py-1"
          >
            {(() => {
              const viewingTrash =
                folderList.find((f) => f.id === activeFolder)?.role === "TRASH";
              return filteredThreads.map((t, idx) => {
              const active = selectedId === t.id;
              const tone = priorityTone(t.priority);
              const labels = parseLabelsJson(t.labelsJson);
              const sender =
                t.fromName?.trim() ||
                t.fromAddress?.split("@")[0] ||
                t.subject;
              const hue = avatarHue(t.fromAddress || t.subject);
              const featured = idx === 0 && t.unreadCount > 0 && !active;
              return (
                <motion.li key={t.id} variants={listItem} layout>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.985 }}
                    onClick={() => openThread(t.id)}
                    aria-label={`${sender}: ${t.subject || "(no subject)"}`}
                    className={`mail-thread-card ${active ? "is-active" : ""} ${featured ? "is-featured" : ""}`}
                  >
                    <div className="flex items-start gap-2.5">
                      {(selectModeEnabled || selectedThreadIds.size > 0) && (
                        <span
                          role="checkbox"
                          aria-checked={selectedThreadIds.has(t.id)}
                          aria-label={`Select thread: ${sender}: ${t.subject || "(no subject)"}`}
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleThreadSelected(t.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleThreadSelected(t.id);
                            }
                          }}
                          className="mt-1.5 flex shrink-0 cursor-pointer items-center justify-center rounded"
                          style={{
                            width: 16,
                            height: 16,
                            border: selectedThreadIds.has(t.id)
                              ? "none"
                              : "1.5px solid var(--mail-border)",
                            background: selectedThreadIds.has(t.id)
                              ? "var(--accent-bright)"
                              : "transparent",
                          }}
                        >
                          {selectedThreadIds.has(t.id) && (
                            <Check size={11} color="#fff" strokeWidth={3} />
                          )}
                        </span>
                      )}
                      <div className="relative shrink-0">
                        {t.unreadCount > 0 && (
                          <span
                            className="absolute -left-1 top-1.5 h-1.5 w-1.5 rounded-full"
                            style={{ background: "#60a5fa" }}
                          />
                        )}
                        <div
                          className="mail-avatar"
                          style={{
                            background: `hsl(${hue} 48% 32%)`,
                            color: `hsl(${hue} 80% 90%)`,
                          }}
                        >
                          {threadInitials(sender)}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className="truncate text-sm"
                            style={{
                              color: "#fff",
                              fontWeight: t.unreadCount > 0 ? 650 : 500,
                            }}
                          >
                            {sender}
                          </p>
                          <span
                            className="flex shrink-0 items-center gap-1 text-[0.65rem] tabular-nums"
                            style={{
                              color: featured
                                ? "rgba(255,255,255,0.75)"
                                : "var(--mail-dim)",
                            }}
                          >
                            {t.hasAttachments ? (
                              <span title="Attachment" aria-label="Attachment">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                </svg>
                              </span>
                            ) : null}
                            {t.answered ? (
                              <span title="Replied" aria-label="Replied">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M9 14L4 9l5-5" />
                                  <path d="M20 20v-7a4 4 0 00-4-4H4" />
                                </svg>
                              </span>
                            ) : null}
                            <span suppressHydrationWarning>
                              {timesReady ? formatWhen(t.lastMessageAt) : "—"}
                            </span>
                          </span>
                        </div>
                        <p
                          className="mt-0.5 truncate text-xs font-medium"
                          style={{
                            color: featured
                              ? "rgba(255,255,255,0.92)"
                              : "var(--mail-text)",
                          }}
                        >
                          {t.subject}
                        </p>
                        <p
                          className="mt-0.5 line-clamp-1 text-xs leading-relaxed"
                          style={{
                            color: featured
                              ? "rgba(255,255,255,0.78)"
                              : "var(--mail-muted)",
                          }}
                        >
                          {t.snippet || "—"}
                        </p>
                        {viewingTrash && t.trashedAt && (
                          <p
                            className="mt-0.5 text-[0.65rem]"
                            style={{ color: "var(--mail-dim)" }}
                            suppressHydrationWarning
                          >
                            {formatDeletedAgo(t.trashedAt)}
                          </p>
                        )}
                        {(tone || labels.length > 0 || activeFolder === ALL_INBOXES_ID) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {activeFolder === ALL_INBOXES_ID &&
                              t.accountId &&
                              (() => {
                                const acct = mailAccounts.find(
                                  (a) => a.id === t.accountId,
                                );
                                if (!acct) return null;
                                const at = labelTone(acct.address);
                                return (
                                  <span
                                    className="mail-tag"
                                    title={acct.address}
                                    style={{ background: at.bg, color: at.fg }}
                                  >
                                    {accountShortName(acct)}
                                  </span>
                                );
                              })()}
                            {tone && (
                              <span
                                className="mail-tag"
                                style={{ background: tone.bg, color: tone.fg }}
                              >
                                {t.priority}
                              </span>
                            )}
                            {labels.slice(0, 4).map((l) => {
                              const lt = labelTone(l);
                              const pretty =
                                SMART_LABEL_META[l as SmartLabel]?.label || l;
                              return (
                                <span
                                  key={l}
                                  className="mail-tag"
                                  style={{ background: lt.bg, color: lt.fg }}
                                >
                                  {pretty}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.button>
                </motion.li>
              );
              });
            })()}
            {!filteredThreads.length && (
              <li className="p-6 text-center text-sm" style={{ color: "var(--mail-dim)" }}>
                <p className="mb-3">
                  {threadQuery.trim().length >= 2
                    ? "No search results"
                    : "No threads match"}
                </p>
                <GhostBtn onClick={() => runSync()} primary>
                  Refresh mailbox
                </GhostBtn>
              </li>
            )}
          </motion.ul>
          {threadQuery.trim().length < 2 && threadTotal > 0 && (
            <div
              className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
              style={{ borderTop: "1px solid var(--mail-border)" }}
            >
              <span
                className="text-[0.68rem] tabular-nums"
                style={{ color: "var(--mail-dim)" }}
              >
                {(threadPage - 1) * THREADS_PAGE_SIZE + 1}
                {"–"}
                {Math.min(threadPage * THREADS_PAGE_SIZE, threadTotal)} of{" "}
                {threadTotal}
              </span>
              <div className="flex items-center gap-1">
                <IconBtn
                  title="Newer (previous page)"
                  icon={<ChevronLeft size={14} />}
                  disabled={threadPage <= 1}
                  onClick={() => {
                    haptic("tap");
                    setThreadPage((p) => Math.max(1, p - 1));
                  }}
                />
                <IconBtn
                  title="Older (next page)"
                  icon={<ChevronRight size={14} />}
                  disabled={threadPage * THREADS_PAGE_SIZE >= threadTotal}
                  onClick={() => {
                    haptic("tap");
                    setThreadPage((p) => p + 1);
                  }}
                />
              </div>
            </div>
          )}
        </motion.section>
          )}
        </AnimatePresence>

        {/* Reader + compose */}
        <motion.section
          layout
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.12 }}
          className={`mail-panel relative flex min-h-0 flex-col overflow-hidden ${readerSpanClass}`}
        >
          <AnimatePresence mode="wait">
            {selectedId && selectedThread ? (
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={spring}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div
                  className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <h2
                      className="truncate text-base font-semibold"
                      style={{ color: "var(--text)" }}
                    >
                      {selectedThread.subject}
                    </h2>
                    <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                      {selectedThread.fromName || selectedThread.fromAddress
                        ? `${selectedThread.fromName || selectedThread.fromAddress}`
                        : null}
                      {selectedThread.fromName || selectedThread.fromAddress
                        ? " · "
                        : null}
                      {messages.length
                        ? `${messages.length} message${messages.length === 1 ? "" : "s"}`
                        : selectedThread.outboxStatus
                          ? `Outbox · ${selectedThread.outboxStatus}`
                          : "Thread"}
                    </p>
                    {(() => {
                      const labels = parseLabelsJson(selectedThread.labelsJson);
                      const hasSmartLabel = labels.some((l) => isSmartLabel(l));
                      const isRealThread =
                        Boolean(selectedId) &&
                        !selectedId!.startsWith("outbox") &&
                        !composeFullscreen;
                      // Always render this row — a thread with no labels yet
                      // (nothing assigned, or nothing correctable) should look
                      // and behave the same as one that does, just with a
                      // "+ Label" placeholder instead of an existing chip.
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {labels.map((l) => {
                            const lt = labelTone(l);
                            const pretty =
                              SMART_LABEL_META[l as SmartLabel]?.label || l;
                            if (!isSmartLabel(l)) {
                              return (
                                <span
                                  key={l}
                                  className="mail-tag"
                                  style={{ background: lt.bg, color: lt.fg }}
                                >
                                  {pretty}
                                </span>
                              );
                            }
                            // Smart labels (AI-assigned) get a correction affordance;
                            // custom labels are managed via "Move to…" instead.
                            return (
                              <div key={l} className="relative" data-menu>
                                <button
                                  type="button"
                                  title="Correct this label"
                                  className="mail-tag cursor-pointer"
                                  style={{ background: lt.bg, color: lt.fg }}
                                  onClick={() =>
                                    setSmartLabelMenuFor((prev) =>
                                      prev === l ? null : l,
                                    )
                                  }
                                >
                                  {pretty} <ChevronDown size={10} className="inline" />
                                </button>
                                {smartLabelMenuFor === l && (
                                  <ul
                                    className="absolute left-0 z-20 mt-1 w-44 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                                    style={{
                                      background: "var(--bg-elevated)",
                                      border: "1px solid var(--border-strong)",
                                    }}
                                  >
                                    {SMART_LABELS.map((id) => (
                                      <li key={id}>
                                        <button
                                          type="button"
                                          className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                          style={{
                                            color:
                                              id === l ? "var(--mail-purple)" : "var(--text)",
                                          }}
                                          onClick={() =>
                                            correctSmartLabel(selectedThread.id, l, id)
                                          }
                                        >
                                          {SMART_LABEL_META[id].label}
                                          {id === l ? " ✓" : ""}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                          {!hasSmartLabel && isRealThread && (
                            <div className="relative" data-menu>
                              <button
                                type="button"
                                title="Add a label"
                                className="mail-tag cursor-pointer border border-dashed"
                                style={{
                                  background: "transparent",
                                  color: "var(--text-dim)",
                                  borderColor: "var(--border-strong)",
                                }}
                                onClick={() =>
                                  setSmartLabelMenuFor((prev) =>
                                    prev === "__new__" ? null : "__new__",
                                  )
                                }
                              >
                                + Label <ChevronDown size={10} className="inline" />
                              </button>
                              {smartLabelMenuFor === "__new__" && (
                                <ul
                                  className="absolute left-0 z-20 mt-1 w-44 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                                  style={{
                                    background: "var(--bg-elevated)",
                                    border: "1px solid var(--border-strong)",
                                  }}
                                >
                                  {SMART_LABELS.map((id) => (
                                    <li key={id}>
                                      <button
                                        type="button"
                                        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                        style={{ color: "var(--text)" }}
                                        onClick={() =>
                                          correctSmartLabel(selectedThread.id, "", id)
                                        }
                                      >
                                        {SMART_LABEL_META[id].label}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {selectedId &&
                      !selectedId.startsWith("outbox") &&
                      !composeFullscreen && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <div className="relative" data-menu>
                            {(() => {
                              const tone = priorityTone(selectedThread.priority) ?? {
                                bg: "rgba(255,255,255,0.06)",
                                fg: "var(--text-muted)",
                              };
                              return (
                                <button
                                  type="button"
                                  disabled={pending}
                                  className="flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                                  style={{
                                    background: tone.bg,
                                    color: tone.fg,
                                    border: "1px solid var(--border-strong)",
                                  }}
                                  onClick={() => {
                                    setShowPriorityMenu((v) => !v);
                                    setShowMoveMenu(false);
                                    setShowSnoozeMenu(false);
                                    setShowMoreMenu(false);
                                  }}
                                >
                                  {selectedThread.priority === "NONE"
                                    ? "No priority"
                                    : selectedThread.priority}
                                  <ChevronDown size={12} />
                                </button>
                              );
                            })()}
                            {showPriorityMenu && (
                              <ul
                                className="absolute left-0 z-10 mt-1 w-36 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                                style={{
                                  background: "var(--bg-elevated)",
                                  border: "1px solid var(--border-strong)",
                                }}
                              >
                                {["P1", "P2", "P3", "P4", "NONE"].map((p) => {
                                  const tone = priorityTone(p);
                                  return (
                                    <li key={p}>
                                      <button
                                        type="button"
                                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                        style={{ color: "var(--text)" }}
                                        onClick={() => {
                                          setShowPriorityMenu(false);
                                          startTransition(async () => {
                                            await setThreadPriority(
                                              selectedId,
                                              p,
                                            );
                                            setThreads((prev) =>
                                              prev.map((x) =>
                                                x.id === selectedId
                                                  ? { ...x, priority: p }
                                                  : x,
                                              ),
                                            );
                                            setStatus(`Priority set to ${p}`);
                                            haptic("tap");
                                          });
                                        }}
                                      >
                                        <span
                                          className="h-2 w-2 shrink-0 rounded-full"
                                          style={{
                                            background: tone?.fg || "#71717a",
                                          }}
                                        />
                                        {p === "NONE" ? "No priority" : p}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                          <IconBtn
                            title={
                              selectedThread.important
                                ? "Unmark important"
                                : "Mark important"
                            }
                            disabled={pending}
                            icon={
                              <Star
                                size={15}
                                fill={
                                  selectedThread.important
                                    ? "#fbbf24"
                                    : "none"
                                }
                                color={
                                  selectedThread.important
                                    ? "#fbbf24"
                                    : "currentColor"
                                }
                              />
                            }
                            onClick={() => {
                              const next = !selectedThread.important;
                              startTransition(async () => {
                                await setThreadImportant(selectedId, next);
                                setThreads((prev) =>
                                  prev.map((x) =>
                                    x.id === selectedId
                                      ? { ...x, important: next }
                                      : x,
                                  ),
                                );
                                setStatus(
                                  next ? "Marked important" : "Unmarked important",
                                );
                                haptic("tap");
                              });
                            }}
                          />
                        </div>
                      )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Compact Gmail/Outlook-style icon toolbar. AI stays in the thread header for docked compose; fullscreen has its own bottom bar */}
                    {composingDocked && (
                      <IconBtn
                        title={
                          hideThreadsForFocus
                            ? "Show thread list"
                            : "Hide thread list"
                        }
                        active={threadsPinnedWhileComposing}
                        icon={<PanelLeftOpen size={15} />}
                        onClick={() =>
                          setThreadsPinnedWhileComposing((v) => !v)
                        }
                      />
                    )}
                    {!composeFullscreen && (
                      <>
                        <IconBtn
                          title="Archive (E)"
                          icon={<ArchiveIcon size={15} />}
                          disabled={pending || !selectedId}
                          onClick={archiveSelected}
                        />
                        <IconBtn
                          title="Trash"
                          danger
                          icon={<Trash2 size={15} />}
                          disabled={pending || !selectedId}
                          onClick={trashSelected}
                        />
                        <IconBtn
                          title={viewingJunk ? "Not spam" : "Report spam"}
                          icon={
                            viewingJunk ? (
                              <ShieldOff size={15} />
                            ) : (
                              <ShieldAlert size={15} />
                            )
                          }
                          disabled={pending || !selectedId}
                          onClick={
                            viewingJunk ? markNotSpamSelected : markSpamSelected
                          }
                        />
                        <div className="relative" data-menu>
                          <IconBtn
                            title="Move to…"
                            active={showMoveMenu}
                            icon={<FolderInput size={15} />}
                            disabled={pending || !selectedId}
                            onClick={() => {
                              setShowMoveMenu((v) => !v);
                              setShowSnoozeMenu(false);
                              setShowMoreMenu(false);
                              setShowPriorityMenu(false);
                            }}
                          />
                          {showMoveMenu && (
                            <ul
                              className="absolute left-0 z-10 mt-1 max-h-56 w-44 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                              style={{
                                background: "var(--bg-elevated)",
                                border: "1px solid var(--border-strong)",
                              }}
                            >
                              {folderList
                                .filter((f) => f.role !== "TRASH")
                                .map((f) => (
                                  <li key={f.id}>
                                    <button
                                      type="button"
                                      className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                      style={{ color: "var(--text)" }}
                                      onClick={() => {
                                        setShowMoveMenu(false);
                                        const movedId = selectedId!;
                                        startTransition(async () => {
                                          await moveThreadToFolderAction(
                                            movedId,
                                            f.id,
                                          );
                                          setThreads((prev) =>
                                            prev.filter((x) => x.id !== movedId),
                                          );
                                          setSelectedId(null);
                                          setStatus(`Moved to ${f.name}`);
                                          haptic("success");
                                          maybeSuggestLabelCorrection(movedId, f.name, {
                                            isSmartLabel: false,
                                            targetLabelDisplay: f.name,
                                            folderId: f.id,
                                            folderName: f.name,
                                          });
                                        });
                                      }}
                                    >
                                      {f.name}
                                    </button>
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                        <div className="relative" data-menu>
                          <IconBtn
                            title="Snooze / remind me"
                            active={showSnoozeMenu}
                            icon={<BellRing size={15} />}
                            disabled={pending || !selectedId}
                            onClick={() => {
                              setShowSnoozeMenu((v) => !v);
                              setShowMoveMenu(false);
                              setShowMoreMenu(false);
                              setShowPriorityMenu(false);
                            }}
                          />
                          {showSnoozeMenu && (
                            <div
                              className="absolute left-0 z-10 mt-1 w-64 space-y-2 rounded-xl p-2.5 text-xs shadow-lg"
                              style={{
                                background: "var(--bg-elevated)",
                                border: "1px solid var(--border-strong)",
                              }}
                            >
                              <button
                                type="button"
                                className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                style={{ color: "var(--text)" }}
                                onClick={() => {
                                  setShowSnoozeMenu(false);
                                  const until = new Date(
                                    Date.now() + 24 * 60 * 60 * 1000,
                                  );
                                  startTransition(async () => {
                                    await snoozeThread(
                                      selectedId!,
                                      until.toISOString(),
                                    );
                                    setStatus("Snoozed until tomorrow");
                                    haptic("success");
                                  });
                                }}
                              >
                                Tomorrow
                              </button>
                              <div className="flex gap-1.5">
                                <input
                                  type="datetime-local"
                                  className="mail-search min-w-0 flex-1 py-1 text-[0.68rem]"
                                  value={remindAt}
                                  disabled={pending}
                                  onChange={(e) => setRemindAt(e.target.value)}
                                />
                                <GhostBtn
                                  disabled={pending || !selectedId || !remindAt}
                                  onClick={() => {
                                    const iso = new Date(remindAt).toISOString();
                                    startTransition(async () => {
                                      await snoozeThread(selectedId!, iso);
                                      setRemindAt("");
                                      setShowSnoozeMenu(false);
                                      setStatus(
                                        `Reminder set for ${formatWhen(iso)}`,
                                      );
                                      haptic("success");
                                    });
                                  }}
                                >
                                  Set
                                </GhostBtn>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="relative" data-menu>
                          <IconBtn
                            title="More"
                            active={showMoreMenu}
                            icon={<MoreHorizontal size={15} />}
                            disabled={pending}
                            onClick={() => {
                              setShowMoreMenu((v) => !v);
                              setShowMoveMenu(false);
                              setShowSnoozeMenu(false);
                              setShowPriorityMenu(false);
                            }}
                          />
                          {showMoreMenu && (
                            <ul
                              className="absolute left-0 z-10 mt-1 w-48 overflow-auto rounded-xl p-1 text-xs shadow-lg"
                              style={{
                                background: "var(--bg-elevated)",
                                border: "1px solid var(--border-strong)",
                              }}
                            >
                              {[
                                {
                                  label: "Triage",
                                  onClick: runTriage,
                                },
                                {
                                  label: "Summarize",
                                  onClick: runSummarize,
                                },
                                {
                                  label: "AI Draft",
                                  onClick: () => {
                                    setShowCompose(true);
                                    runAiDraft();
                                  },
                                },
                                {
                                  label: "Tasks",
                                  onClick: runExtractTasks,
                                },
                                {
                                  label: "Shorten",
                                  onClick: () => {
                                    setShowCompose(true);
                                    runShorten();
                                  },
                                },
                                {
                                  label: "Schedule meeting",
                                  onClick: runMeetingInvite,
                                },
                                {
                                  label: "Block sender",
                                  danger: true,
                                  onClick: () => {
                                    const address = selectedThread.fromAddress;
                                    if (!address) return;
                                    const ok = window.confirm(
                                      `Block ${address}? Future mail from this sender will be filtered on sync, and this thread moves to Trash now.`,
                                    );
                                    if (!ok) return;
                                    startTransition(async () => {
                                      await blockSenderAction({
                                        address,
                                        threadId: selectedId!,
                                        confirmed: true,
                                        accountId: accountInfo?.id,
                                      });
                                      setThreads((prev) =>
                                        prev.filter((x) => x.id !== selectedId),
                                      );
                                      setSelectedId(null);
                                      setStatus(`Blocked ${address}`);
                                      haptic("success");
                                    });
                                  },
                                },
                              ].map((item, i, arr) => (
                                <li key={item.label}>
                                  {item.danger && i > 0 && !arr[i - 1]?.danger && (
                                    <div
                                      className="my-1"
                                      style={{
                                        borderTop: "1px solid var(--border-strong)",
                                      }}
                                    />
                                  )}
                                  {i === 0 && (
                                    <p
                                      className="px-2 pb-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em]"
                                      style={{ color: "var(--accent-bright)" }}
                                    >
                                      AI actions
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                                    style={{
                                      color: item.danger
                                        ? "#f87171"
                                        : "var(--text)",
                                    }}
                                    onClick={() => {
                                      setShowMoreMenu(false);
                                      item.onClick();
                                    }}
                                  >
                                    {item.label}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                    {showCompose ? (
                      <IconBtn
                        primary
                        size="lg"
                        title="Minimize reply"
                        icon={<Minus size={16} />}
                        onClick={() => closeCompose("hide")}
                      />
                    ) : (
                      <>
                        <IconBtn
                          primary
                          size="lg"
                          title="Reply (R)"
                          icon={<ReplyIcon size={16} />}
                          onClick={() => {
                            setShowCompose(true);
                            haptic("tap");
                          }}
                        />
                        <IconBtn
                          size="lg"
                          title="Reply all"
                          icon={<ReplyAllIcon size={15} />}
                          onClick={replyAll}
                        />
                        <IconBtn
                          size="lg"
                          title="Reply in fullscreen"
                          icon={<Maximize2 size={15} />}
                          onClick={() => {
                            setShowCompose(true);
                            setComposeFullscreen(true);
                            haptic("tap");
                          }}
                        />
                        <IconBtn
                          size="lg"
                          title="Forward (F)"
                          icon={<ForwardIcon size={15} />}
                          onClick={composeForward}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
                  {messages.map((m, i) => (
                    <MessageReader
                      key={m.id}
                      message={m}
                      index={i}
                      defaultExpanded={i === messages.length - 1}
                      onSummarizeAttachment={(attachmentId, filename) =>
                        startTransition(async () => {
                          setStatus(`Summarizing ${filename}…`);
                          const res = await summarizeAttachmentAction(attachmentId);
                          setAskA(res?.summary || "No summary");
                          setAskCitations([]);
                          setStatus(res?.summary ? "Attachment summarized" : "No extractable text");
                          haptic(res?.summary ? "success" : "warn");
                        })
                      }
                      onUnsubscribe={(messageId) =>
                        startTransition(async () => {
                          const ok = window.confirm(
                            "Open unsubscribe target for this message? (Irreversible HTTP is never auto-fired.)",
                          );
                          if (!ok) return;
                          try {
                            const cand = await unsubscribeCandidateAction(messageId, {
                              confirmed: true,
                            });
                            const raw = cand.listUnsubscribe || "";
                            const url =
                              raw.match(/<(https?:[^>]+)>/i)?.[1] ||
                              raw.match(/https?:\/\/\S+/i)?.[0] ||
                              raw.match(/mailto:([^\s>]+)/i)?.[0];
                            if (url?.startsWith("http")) {
                              window.open(url, "_blank", "noopener,noreferrer");
                              setStatus("Opened unsubscribe URL");
                            } else if (url?.startsWith("mailto:")) {
                              window.location.href = url;
                              setStatus("Opened unsubscribe mailto");
                            } else {
                              setStatus(`Unsubscribe: ${raw.slice(0, 120)}`);
                            }
                            haptic("success");
                          } catch (e) {
                            setStatus(
                              e instanceof Error ? e.message : "Unsubscribe failed",
                            );
                            haptic("warn");
                          }
                        })
                      }
                    />
                  ))}
                  {pending && !messages.length && (
                    <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                      Loading thread…
                    </p>
                  )}

                  {/* Gmail-style inline reply: an in-flow card at the end of
                      the thread, inside the same scroll — nothing overlaps. */}
                  <AnimatePresence>
                    {showCompose && !composeFullscreen && (
                      <motion.div
                        ref={composeCardRef}
                        initial={{ opacity: 0, y: 18, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12 }}
                        transition={spring}
                        className="overflow-hidden rounded-2xl"
                        style={{
                          border: "1px solid rgba(139,92,246,0.35)",
                          background: "var(--bg)",
                          boxShadow: "0 16px 44px rgba(0,0,0,0.4)",
                        }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
                          <div>
                            <p
                              className="text-xs font-semibold uppercase tracking-[0.16em]"
                              style={{ color: "var(--accent-bright)" }}
                            >
                              Reply
                            </p>
                            {mailAccounts.length > 1 && (
                              <p className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                                From {composeAccountAddress}
                              </p>
                            )}
                          </div>
                        </div>

                        <div
                          className="relative space-y-3 px-4 py-2"
                          onDragOver={handleComposeDragOver}
                          onDragLeave={handleComposeDragLeave}
                          onDrop={handleComposeDrop}
                        >
                          {composeDragActive && (
                            <div
                              className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl text-sm font-semibold"
                              style={{
                                border: "2px dashed var(--accent-bright)",
                                background: "rgba(139,92,246,0.12)",
                                color: "var(--accent-bright)",
                              }}
                            >
                              Drop to attach
                            </div>
                          )}
                          <div
                            className="rounded-xl px-3.5 py-1"
                            style={{
                              background: "var(--bg-elevated)",
                              border: "1px solid var(--border-strong)",
                            }}
                          >
                            <div className="mail-compose-field">
                              <label htmlFor="mail-to">To</label>
                              <div className="flex items-center gap-2">
                                <RecipientAutocomplete
                                  id="mail-to"
                                  wrapClassName="min-w-0 flex-1"
                                  placeholder="name@company.com, …"
                                  value={to}
                                  onChange={setTo}
                                  accountId={composeAccountId}
                                />
                                <button
                                  type="button"
                                  className="shrink-0 cursor-pointer text-[0.7rem] font-medium"
                                  style={{ color: "var(--text-dim)" }}
                                  onClick={() => {
                                    setShowCcBcc((v) => !v);
                                    haptic("tap");
                                  }}
                                >
                                  {showCcBcc || cc || bcc ? "Cc / Bcc ▴" : "Cc / Bcc"}
                                </button>
                              </div>
                            </div>
                            {(showCcBcc || cc) && (
                              <div className="mail-compose-field">
                                <label htmlFor="mail-cc">Cc</label>
                                <RecipientAutocomplete
                                  id="mail-cc"
                                  wrapClassName="min-w-0"
                                  placeholder="Optional carbon copy"
                                  value={cc}
                                  onChange={setCc}
                                  accountId={composeAccountId}
                                />
                              </div>
                            )}
                            {(showCcBcc || bcc) && (
                              <div className="mail-compose-field">
                                <label htmlFor="mail-bcc">Bcc</label>
                                <RecipientAutocomplete
                                  id="mail-bcc"
                                  wrapClassName="min-w-0"
                                  placeholder="Optional blind copy"
                                  value={bcc}
                                  onChange={setBcc}
                                  accountId={composeAccountId}
                                />
                              </div>
                            )}
                            <div className="mail-compose-field">
                              <label htmlFor="mail-subject">Subject</label>
                              <input
                                id="mail-subject"
                                placeholder="Subject"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                              />
                            </div>
                          </div>

                          <AnimatePresence>
                            {showAiAssist && (
                              <motion.div
                                initial={{ opacity: 0, height: 0, y: -6 }}
                                animate={{ opacity: 1, height: "auto", y: 0 }}
                                exit={{ opacity: 0, height: 0, y: -6 }}
                                transition={spring}
                                className="overflow-hidden"
                              >
                                {ComposeAiAssist()}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {sigList.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span style={{ color: "var(--text-dim)" }}>Signature</span>
                              <select
                                className="cursor-pointer rounded-lg px-2 py-1.5 outline-none"
                                style={{
                                  background: "var(--bg-elevated)",
                                  border: "1px solid var(--border)",
                                  color: "var(--text-muted)",
                                }}
                                defaultValue=""
                                onChange={(e) => {
                                  if (e.target.value) applySignature(e.target.value);
                                  e.target.value = "";
                                }}
                              >
                                <option value="">Insert…</option>
                                {sigList.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                    {s.isDefault ? " (default)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <MailComposer
                            initialHtml={composeHtml}
                            onChange={setComposeHtml}
                            minHeight={160}
                          />
                        </div>

                        <div
                          className="px-4 py-3"
                          style={{
                            borderTop: "1px solid var(--border)",
                            background: "rgba(7,7,8,0.92)",
                          }}
                        >
                          {ComposeActionBar({ mode: "docked" })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <AnimatePresence>
                  {commitments.length > 0 && (
                    <motion.ul
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mx-4 mb-2 space-y-1 rounded-xl p-2"
                      style={{
                        background: "rgba(16,185,129,0.1)",
                        border: "1px solid rgba(16,185,129,0.3)",
                      }}
                    >
                      {commitments.map((c, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 px-1 text-xs"
                          style={{ color: "var(--success)" }}
                        >
                          <span>{c.title}</span>
                          <GhostBtn
                            onClick={() =>
                              startTransition(async () => {
                                await acceptCommitmentAction({
                                  threadId: selectedId,
                                  title: c.title,
                                  dueAt: c.dueAt,
                                  priority: c.priority,
                                  confirmed: true,
                                });
                                if (selectedId) {
                                  void listTasksForThreadAction(selectedId)
                                    .then((rows) => setThreadTasks(rows))
                                    .catch(() => undefined);
                                }
                                setStatus(`Task created: ${c.title}`);
                                haptic("success");
                              })
                            }
                          >
                            Accept → Task
                          </GhostBtn>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>

                {threadTasks.length > 0 && (
                  <ul
                    className="mx-4 mb-2 space-y-1 rounded-xl p-2"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                    }}
                  >
                    {threadTasks.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 px-1 text-xs"
                        style={{ color: "var(--text-dim)" }}
                      >
                        <span className={t.status === "DONE" ? "line-through opacity-60" : ""}>
                          {t.title}
                        </span>
                        <span className="shrink-0 opacity-70">
                          {t.dueAt ? formatWhen(t.dueAt) : t.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
              >
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}
                  className="flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{
                    background: "var(--accent-dim)",
                    border: "1px solid rgba(99,102,241,0.35)",
                    color: "var(--accent-bright)",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 6h16v12H4V6z" />
                    <path d="M4 7l8 6 8-6" />
                  </svg>
                </motion.div>
                <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  Select a thread
                </p>
                <p className="max-w-xs text-xs" style={{ color: "var(--text-dim)" }}>
                  AI triage, summarize, draft, and ask all sit on the right
                  once a conversation is open.
                </p>
                <GhostBtn onClick={composeNew} primary>
                  <span className="flex items-center gap-1.5">
                    <PenLine size={13} /> Write a new message
                  </span>
                </GhostBtn>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Ask dock — hide while composing so Send/AI bar stays visible */}
          <div
            className="mt-auto px-4 py-3"
            style={{
              borderTop: "1px solid var(--mail-border)",
              background:
                "linear-gradient(180deg, transparent, rgba(139,92,246,0.08))",
              display: showCompose && !composeFullscreen ? "none" : undefined,
            }}
          >
            <div className="flex gap-2">
              <input
                className="mail-search flex-1"
                placeholder="Ask mailbox… or “recall Name”"
                value={askQ}
                disabled={askThinking}
                onChange={(e) => setAskQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && askQ.trim()) runAsk(askQ);
                }}
              />
              <VoiceButton
                disabled={askThinking}
                onText={(t) => {
                  const next = askQ ? `${askQ} ${t}` : t;
                  setAskQ(next);
                  runAsk(next);
                }}
              />
              <GhostBtn
                primary
                disabled={askThinking || !askQ.trim()}
                onClick={() => runAsk(askQ)}
              >
                {askThinking ? "Thinking…" : "Ask"}
              </GhostBtn>
              {askHistory.length > 0 && (
                <IconBtn
                  title="Clear conversation — start a fresh question"
                  icon={<X size={14} />}
                  onClick={clearAskConversation}
                />
              )}
            </div>
            <AnimatePresence mode="wait">
              {askThinking ? (
                <motion.div
                  key="ask-thinking"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-2 flex items-center gap-2 text-xs"
                  style={{ color: "var(--accent-bright)" }}
                >
                  <Loader2 size={14} className="animate-spin" />
                  <span>Searching your mail &amp; reading the matches…</span>
                </motion.div>
              ) : askA ? (
                <motion.div
                  key="ask-answer"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 max-h-80 space-y-2.5 overflow-auto pr-1"
                >
                  {askHistory.slice(0, -1).length > 0 && (
                    <div
                      className="space-y-2 pb-2"
                      style={{
                        borderBottom: "1px solid var(--mail-border)",
                      }}
                    >
                      {askHistory.slice(0, -1).map((t, i) => (
                        <div key={i} className="text-[0.7rem]">
                          <p
                            className="font-medium"
                            style={{ color: "var(--text-dim)" }}
                          >
                            {t.question}
                          </p>
                          <p
                            className="line-clamp-2"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {t.answer.replace(/\[\[[^\]]+\]\]/g, "")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <FormattedAnswer
                    text={askA}
                    sources={askSourcesMap}
                    onOpen={(threadId) => {
                      haptic("tap");
                      openThread(threadId);
                    }}
                  />
                  {!askHasInlineCitations && askCitations.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p
                        className="text-[0.6rem] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: "var(--mail-dim)" }}
                      >
                        Sources · click to open
                      </p>
                      <ul className="space-y-1">
                        {askCitations.map((c) => (
                          <li key={c.messageId}>
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.7rem] font-medium transition-colors hover:brightness-125"
                              style={{
                                background: "rgba(139,92,246,0.12)",
                                border: "1px solid rgba(139,92,246,0.3)",
                                color: "var(--accent-bright)",
                              }}
                              title={`Open: ${c.subject}`}
                              onClick={() => {
                                haptic("tap");
                                openThread(c.threadId);
                              }}
                            >
                              <MailIcon size={13} className="shrink-0" />
                              <span className="truncate">
                                {c.subject || c.messageId.slice(0, 8)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.section>
      </div>

      <AnimatePresence>
        {composeFullscreen && (
          <motion.div
            className="mail-compose-fs fixed inset-0 z-[100] flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              background: "var(--bg)",
              backgroundImage: "var(--grad-hero)",
            }}
          >
            <div
              className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4"
              style={{
                borderBottom: "1px solid var(--border)",
                background: "rgba(7,7,8,0.92)",
                backdropFilter: "blur(16px)",
              }}
            >
              <div>
                <p
                  className="text-[0.65rem] font-semibold uppercase tracking-[0.2em]"
                  style={{
                    background: "var(--grad-cta)",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  Fullscreen compose
                </p>
                <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  From {composeAccountAddress}
                </p>
              </div>
              <IconBtn
                title="Exit fullscreen"
                icon={<Minimize2 size={16} />}
                onClick={() => closeCompose("exit-fullscreen")}
              />
            </div>

            <div
              className="relative flex min-h-0 flex-1 flex-col gap-3 px-6 py-4"
              onDragOver={handleComposeDragOver}
              onDragLeave={handleComposeDragLeave}
              onDrop={handleComposeDrop}
            >
              {composeDragActive && (
                <div
                  className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl text-base font-semibold"
                  style={{
                    border: "2px dashed var(--accent-bright)",
                    background: "rgba(139,92,246,0.12)",
                    color: "var(--accent-bright)",
                  }}
                >
                  Drop to attach
                </div>
              )}
              <div
                className="shrink-0 rounded-2xl px-4 py-1"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <div className="mail-compose-field">
                  <label htmlFor="mail-to-fs">To</label>
                  <div className="flex items-center gap-2">
                    <RecipientAutocomplete
                      id="mail-to-fs"
                      wrapClassName="min-w-0 flex-1"
                      placeholder="name@company.com, …"
                      value={to}
                      onChange={setTo}
                      accountId={composeAccountId}
                    />
                    {/* Gmail-style: Cc/Bcc toggles from the To row, not the header */}
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer text-[0.7rem] font-medium"
                      style={{ color: "var(--text-dim)" }}
                      onClick={() => {
                        setShowCcBcc((v) => !v);
                        haptic("tap");
                      }}
                    >
                      {showCcBcc || cc || bcc ? "Cc / Bcc ▴" : "Cc / Bcc"}
                    </button>
                  </div>
                </div>
                {(showCcBcc || cc) && (
                  <div className="mail-compose-field">
                    <label htmlFor="mail-cc-fs">Cc</label>
                    <RecipientAutocomplete
                      id="mail-cc-fs"
                      wrapClassName="min-w-0"
                      value={cc}
                      onChange={setCc}
                      accountId={composeAccountId}
                    />
                  </div>
                )}
                {(showCcBcc || bcc) && (
                  <div className="mail-compose-field">
                    <label htmlFor="mail-bcc-fs">Bcc</label>
                    <RecipientAutocomplete
                      id="mail-bcc-fs"
                      wrapClassName="min-w-0"
                      value={bcc}
                      onChange={setBcc}
                      accountId={composeAccountId}
                    />
                  </div>
                )}
                <div className="mail-compose-field">
                  <label htmlFor="mail-subject-fs">Subject</label>
                  <input
                    id="mail-subject-fs"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
              </div>

              {/* Fullscreen hides the reader, so surface the message being
                  replied to as read-only context. */}
              {isReplyContext() && messages.length > 0 && (
                <ReplyContextCard
                  message={messages[messages.length - 1]!}
                  subject={selectedThread?.subject}
                />
              )}

              <AnimatePresence>
                {showAiAssist && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -6 }}
                    transition={spring}
                    className="shrink-0 overflow-hidden"
                  >
                    {ComposeAiAssist()}
                  </motion.div>
                )}
              </AnimatePresence>

              {sigList.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  <span style={{ color: "var(--text-dim)" }}>Signature</span>
                  <select
                    className="cursor-pointer rounded-full px-3 py-1.5 outline-none"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                    }}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) applySignature(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Insert…</option>
                    {sigList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mail-compose-fs-editor min-h-0 flex-1">
                <MailComposer
                  initialHtml={composeHtml}
                  onChange={setComposeHtml}
                  minHeight={480}
                  fillViewport
                  fullscreenActive
                  onFullscreen={() => closeCompose("exit-fullscreen")}
                />
              </div>
            </div>

            <div
              className="shrink-0 px-6 py-4"
              style={{
                borderTop: "1px solid var(--border)",
                background: "rgba(7,7,8,0.95)",
                boxShadow: "0 -12px 40px rgba(0,0,0,0.35)",
              }}
            >
              {ComposeActionBar({ mode: "fullscreen" })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShortcutHelp && (
          <motion.div
            key="shortcut-help"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setShowShortcutHelp(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={spring}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl p-5"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2
                  className="text-sm font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  Keyboard shortcuts
                </h2>
                <IconBtn
                  title="Close"
                  icon={<X size={14} />}
                  onClick={() => setShowShortcutHelp(false)}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {(
                  [
                    ["c", "Compose"],
                    ["r", "Reply"],
                    ["a", "Reply all"],
                    ["f", "Forward"],
                    ["e", "Archive"],
                    ["#", "Trash"],
                    ["x", "Select thread"],
                    ["j", "Next thread"],
                    ["k", "Previous thread"],
                    ["/", "Search"],
                    ["⌘/Ctrl + Enter", "Send"],
                    ["Esc", "Close / deselect"],
                    ["?", "This help"],
                  ] as const
                ).map(([key, label]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2"
                  >
                    <span style={{ color: "var(--text-muted)" }}>{label}</span>
                    <kbd
                      className="rounded px-1.5 py-0.5 text-[0.7rem]"
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        color: "var(--text)",
                      }}
                    >
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
              <div
                className="mt-3 pt-3 text-[0.7rem]"
                style={{ borderTop: "1px solid var(--border)", color: "var(--text-dim)" }}
              >
                <p className="mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>
                  Search operators
                </p>
                <p>
                  from: to: has:attachment is:unread is:starred label: before:YYYY-MM-DD after:YYYY-MM-DD
                </p>
              </div>
              <div
                className="mt-3 pt-3 text-[0.7rem]"
                style={{ borderTop: "1px solid var(--border)", color: "var(--text-dim)" }}
              >
                <p className="mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>
                  Voice & ⌘K commands
                </p>
                <p>
                  The mic button and ⌘K (top bar, every page) run all of
                  these — say or type them naturally: “compose new email”,
                  “search invoices from BSS”, “archive this”, “trash this”,
                  “reply all”, “open drafts”. Works from any page, not just
                  Mail.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {pendingSend && (
              <motion.div
                key="undo-send-toast"
                initial={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                exit={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                transition={spring}
                className="fixed bottom-6 left-1/2 z-[200] flex items-center gap-3 rounded-full px-4 py-2.5 shadow-lg"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <span className="text-sm" style={{ color: "var(--text)" }}>
                  Sending to {pendingSend.to}…
                </span>
                <button
                  type="button"
                  className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                  style={{
                    background: "var(--mail-purple-dim)",
                    color: "#c4b5fd",
                  }}
                  onClick={undoSend}
                >
                  Undo
                </button>
                <button
                  type="button"
                  title="Send now"
                  aria-label="Send now"
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full"
                  style={{ color: "var(--text-dim)" }}
                  onClick={sendPendingNow}
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {labelSuggestion && (
              <motion.div
                key="label-suggestion-toast"
                initial={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                exit={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                transition={spring}
                className={`fixed left-1/2 z-[200] flex w-[26rem] max-w-[92vw] flex-col items-center gap-2 ${pendingSend ? "bottom-20" : "bottom-6"}`}
              >
                {labelSuggestion.showMatches && !labelSuggestion.applyResult && (
                  <div
                    data-menu
                    className="flex w-full flex-col overflow-hidden rounded-2xl shadow-lg"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <span style={{ color: "var(--text-dim)" }}>
                        {labelSuggestion.selectedIds.size} of{" "}
                        {labelSuggestion.matches.length} selected
                        {labelSuggestion.matchesCapped
                          ? " (most recent — there may be more)"
                          : ""}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          style={{ color: "var(--mail-purple)" }}
                          onClick={() => setAllLabelSuggestionMatches(true)}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          style={{ color: "var(--text-dim)" }}
                          onClick={() => setAllLabelSuggestionMatches(false)}
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>
                    <ul className="max-h-64 overflow-y-auto p-1">
                      {labelSuggestion.matches.map((m) => (
                        <li key={m.id}>
                          <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                            <input
                              type="checkbox"
                              className="mt-0.5 shrink-0"
                              checked={labelSuggestion.selectedIds.has(m.id)}
                              onChange={() => toggleLabelSuggestionMatch(m.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-xs font-medium"
                                style={{ color: "var(--text)" }}
                              >
                                {m.fromName || m.fromAddress || "Unknown sender"}
                              </span>
                              <span
                                className="block truncate text-[0.7rem]"
                                style={{ color: "var(--text-dim)" }}
                              >
                                {m.subject || "(no subject)"}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                      {!labelSuggestion.matches.length && (
                        <li
                          className="px-2 py-3 text-center text-xs"
                          style={{ color: "var(--text-dim)" }}
                        >
                          No existing matches — this rule only affects future
                          mail.
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <div
                  data-menu
                  className="flex max-w-full flex-wrap items-center gap-3 rounded-full px-4 py-2.5 shadow-lg"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                  }}
                >
                  <span className="text-sm" style={{ color: "var(--text)" }}>
                    {labelSuggestion.applyResult ? (
                      labelSuggestion.applyResult.count > 0 ? (
                        `${labelSuggestion.isSmartLabel ? "Relabeled" : "Moved"} ${labelSuggestion.applyResult.count} more${labelSuggestion.ruleCreated ? " · Rule created" : ""}`
                      ) : (
                        `No matches applied${labelSuggestion.ruleCreated ? " · Rule created" : ""}`
                      )
                    ) : (
                      <>
                        <button
                          type="button"
                          className="cursor-pointer underline decoration-dotted underline-offset-2"
                          onClick={toggleLabelSuggestionExpanded}
                        >
                          {labelSuggestion.matches.length}
                          {labelSuggestion.matchesCapped ? "+" : ""} similar email
                          {labelSuggestion.matches.length === 1 ? "" : "s"}
                        </button>
                        {` — apply “${labelSuggestion.targetLabelDisplay}” too?`}
                      </>
                    )}
                  </span>
                  {labelSuggestion.applyResult?.snapshot && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                      style={{ background: "var(--mail-purple-dim)", color: "#c4b5fd" }}
                      onClick={undoLabelSuggestionApply}
                    >
                      Undo
                    </button>
                  )}
                  {!labelSuggestion.applyResult && labelSuggestion.selectedIds.size > 0 && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                      style={{ background: "var(--mail-purple-dim)", color: "#c4b5fd" }}
                      disabled={pending}
                      onClick={applyLabelSuggestionRetroactive}
                    >
                      Apply to {labelSuggestion.selectedIds.size}
                    </button>
                  )}
                  {!labelSuggestion.ruleCreated && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                      style={{ background: "rgba(255,255,255,0.08)", color: "var(--text)" }}
                      disabled={pending}
                      onClick={alwaysApplyLabelSuggestion}
                    >
                      Always do this
                    </button>
                  )}
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full"
                    style={{ color: "var(--text-dim)" }}
                    onClick={dismissLabelSuggestion}
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
            {spamSuggestion && (
              <motion.div
                key="spam-suggestion-toast"
                initial={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                exit={{ opacity: 0, y: 20, scale: 0.96, x: "-50%" }}
                transition={spring}
                className={`fixed left-1/2 z-[200] flex w-[26rem] max-w-[92vw] flex-col items-center gap-2 ${pendingSend ? "bottom-20" : "bottom-6"}`}
              >
                {spamSuggestion.showMatches && !spamSuggestion.applyResult && (
                  <div
                    data-menu
                    className="flex w-full flex-col overflow-hidden rounded-2xl shadow-lg"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <span style={{ color: "var(--text-dim)" }}>
                        {spamSuggestion.selectedIds.size} of{" "}
                        {spamSuggestion.matches.length} selected
                        {spamSuggestion.matchesCapped
                          ? " (most recent — there may be more)"
                          : ""}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          style={{ color: "var(--mail-purple)" }}
                          onClick={() => setAllSpamSuggestionMatches(true)}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          style={{ color: "var(--text-dim)" }}
                          onClick={() => setAllSpamSuggestionMatches(false)}
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>
                    <ul className="max-h-64 overflow-y-auto p-1">
                      {spamSuggestion.matches.map((m) => (
                        <li key={m.id}>
                          <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                            <input
                              type="checkbox"
                              className="mt-0.5 shrink-0"
                              checked={spamSuggestion.selectedIds.has(m.id)}
                              onChange={() => toggleSpamSuggestionMatch(m.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-xs font-medium"
                                style={{ color: "var(--text)" }}
                              >
                                {m.fromName || m.fromAddress || "Unknown sender"}
                              </span>
                              <span
                                className="block truncate text-[0.7rem]"
                                style={{ color: "var(--text-dim)" }}
                              >
                                {m.subject || "(no subject)"}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div
                  data-menu
                  className="flex max-w-full flex-wrap items-center gap-3 rounded-full px-4 py-2.5 shadow-lg"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-strong)",
                  }}
                >
                  <span className="text-sm" style={{ color: "var(--text)" }}>
                    {spamSuggestion.applyResult ? (
                      spamSuggestion.applyResult.count > 0 ? (
                        `Moved ${spamSuggestion.applyResult.count} more to Junk`
                      ) : (
                        "No matches moved"
                      )
                    ) : (
                      <>
                        <button
                          type="button"
                          className="cursor-pointer underline decoration-dotted underline-offset-2"
                          onClick={toggleSpamSuggestionExpanded}
                        >
                          {spamSuggestion.matches.length}
                          {spamSuggestion.matchesCapped ? "+" : ""} other email
                          {spamSuggestion.matches.length === 1 ? "" : "s"}
                        </button>
                        {" look like the same campaign — move to Junk too?"}
                      </>
                    )}
                  </span>
                  {spamSuggestion.applyResult && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                      style={{ background: "var(--mail-purple-dim)", color: "#c4b5fd" }}
                      onClick={undoSpamSuggestionApply}
                    >
                      Undo
                    </button>
                  )}
                  {!spamSuggestion.applyResult && spamSuggestion.selectedIds.size > 0 && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-full px-3 py-1 text-sm font-semibold"
                      style={{ background: "var(--mail-purple-dim)", color: "#c4b5fd" }}
                      disabled={pending}
                      onClick={applySpamSuggestion}
                    >
                      Move {spamSuggestion.selectedIds.size}
                    </button>
                  )}
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full"
                    style={{ color: "var(--text-dim)" }}
                    onClick={dismissSpamSuggestion}
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
