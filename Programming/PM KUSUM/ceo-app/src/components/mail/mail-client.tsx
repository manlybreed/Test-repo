"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  Inbox as InboxIcon,
  Loader2,
  Mail as MailIcon,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Save,
  SendHorizontal,
  RefreshCw,
  Reply as ReplyIcon,
  ReplyAll as ReplyAllIcon,
  Send,
  ShieldAlert,
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
import { haptic } from "@/components/mail/haptics";
import { buildFolderTree, type FolderTreeNode } from "@/lib/mail/folder-tree";
import {
  askMailAction,
  autocompleteAction,
  draftReplyAction,
  draftNewMailAction,
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
  buildMeetingInviteAction,
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
  type SmartLabel,
} from "@/lib/mail/ai/smart-labels";

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
const THREADS_PAGE_SIZE = 50;

type Thread = {
  id: string;
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
  onClick: () => void;
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
      onClick={() => {
        haptic(danger ? "warn" : "tap");
        onClick();
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
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wrapClassName?: string;
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
      void findContactsAction(fragment)
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
  // Same rich rendering as the reader pane (sanitized HTML, dark-adapted) —
  // images/links intact instead of a stripped text dump.
  const html = prepareMailHtml(message.bodyHtml, message.bodyText, "dark");
  const who = message.fromName || message.fromAddress;
  return (
    <details
      open
      className="shrink-0 overflow-hidden rounded-xl"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-sm"
        style={{ color: "var(--text-dim)" }}
      >
        <ReplyIcon size={14} style={{ color: "var(--accent-bright)" }} />
        <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
          Replying to {who}
        </span>
        {subject ? <span className="truncate">· {subject}</span> : null}
        <span className="ml-auto text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
          click to collapse
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  } | null>(null);
  const pendingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
  const [sendAtLocal, setSendAtLocal] = useState("");
  const [bulkSuggestions, setBulkSuggestions] = useState<
    { threadId: string; subject: string; priority: string; labels: string[] }[]
  >([]);
  const [showRules, setShowRules] = useState(false);
  const [labelRules, setLabelRules] = useState<
    { id: string; name: string; label: string; matchJson: string; enabled: boolean }[]
  >([]);
  const [ruleDraft, setRuleDraft] = useState({
    name: "",
    label: "NEWSLETTER",
    fromContains: "",
    subjectContains: "",
  });
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
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [activeSmartLabel, setActiveSmartLabel] = useState<SmartLabel | null>(
    null,
  );
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
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
      !showBulkMoveMenu
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
  // and give the reader the freed columns (restores when the reply closes).
  const composingDocked = showCompose && !composeFullscreen;
  const readerSpanClass = composingDocked
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

  // Smart search: AI expands intent, then matches subject/body/sender@domain
  useEffect(() => {
    const q = threadQuery.trim();
    if (q.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    setStatus("Searching…");
    // Slightly longer debounce — AI expand + rerank costs a round-trip
    const handle = window.setTimeout(() => {
      startNavTransition(async () => {
        const startedAt = performance.now();
        try {
          const rows = (await searchThreadsAction(q)) as Thread[];
          const elapsedMs = Math.round(performance.now() - startedAt);
          setThreads(rows);
          setActiveSmartLabel(null);
          setStatus(
            rows.length
              ? `Search · ${rows.length} result${rows.length === 1 ? "" : "s"} · ${elapsedMs}ms`
              : `Search · no matches · ${elapsedMs}ms`,
          );
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "Search failed");
        } finally {
          setSearching(false);
        }
      });
    }, 480);
    return () => window.clearTimeout(handle);
  }, [threadQuery]);

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

        // If this thread isn't in the current list (e.g. opened from an Ask
        // citation in another folder), synthesize a row so the reader renders.
        if (!threads.some((x) => x.id === id)) {
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
        } else {
          setSelectedThreadFallback(null);
        }

        if (folderRole === "INBOX" || inSmartInbox || !folder) {
          setThreads((prev) =>
            prev.map((x) => (x.id === id ? { ...x, unreadCount: 0 } : x)),
          );
          // Never block the reader on mark-read / IMAP
          void markThreadRead(id).catch(() => undefined);
        }

        const last = msgs[msgs.length - 1];
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
      void forwardMessageAttachmentsAction(last.id)
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

  async function reloadActiveView(page = threadPage) {
    if (activeSmartLabel) {
      const res = await listMailThreads({ label: activeSmartLabel, page });
      setThreads(res.rows as Thread[]);
      setThreadTotal(res.total);
      setThreadPage(res.page);
      return;
    }
    if (activeFolder === OUTBOX_ID) {
      setThreads((await listOutboxAction()) as Thread[]);
      setThreadTotal(0);
      return;
    }
    if (activeFolder === SMART_INBOX_ID) {
      const res = await listMailThreads({ smartInbox: true, page });
      setThreads(res.rows as Thread[]);
      setThreadTotal(res.total);
      setThreadPage(res.page);
      return;
    }
    if (activeFolder) {
      const folder = folderList.find((f) => f.id === activeFolder);
      if (folder?.role === "DRAFTS") {
        setThreads(
          (await listDraftsFolderAction(activeFolder)) as Thread[],
        );
        setThreadTotal(0);
      } else {
        const res = await listMailThreads({ folderId: activeFolder, page });
        setThreads(res.rows as Thread[]);
        setThreadTotal(res.total);
        setThreadPage(res.page);
      }
    }
  }

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
    setComposeFullscreen(true);
    setCommitments([]);
    startNavTransition(async () => {
      const d = await getDraftAction(id);
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
      if (!selectedId) setShowCompose(true);
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
    void uploadComposeAttachmentAction(fd)
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

  function sendCurrentDraft() {
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

    // Do not use startTransition here — long SMTP work would disable every action button
    const headers = currentReplyHeaders();
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
          setPendingSend({ outboxId: row.id, to: recipients.join(", ") });
          if (pendingSendTimerRef.current) clearTimeout(pendingSendTimerRef.current);
          const outboxId = row.id;
          pendingSendTimerRef.current = setTimeout(() => {
            void flushQueuedSendAction(outboxId)
              .then(() => {
                setPendingSend((p) => (p?.outboxId === outboxId ? null : p));
                setStatus("Sent");
                void reloadActiveView();
              })
              .catch((e) => {
                setPendingSend((p) => (p?.outboxId === outboxId ? null : p));
                setStatus(e instanceof Error ? e.message : "Send failed");
                haptic("warn");
              });
          }, 10_000);
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
    setPendingSend(null);
    startTransition(async () => {
      try {
        await cancelScheduledSend(id);
        setStatus("Send cancelled");
        haptic("success");
        setShowCompose(true);
      } catch {
        // Lost the race at the edge of the undo window — it already went out.
        setStatus("Too late — already sent");
        haptic("warn");
      }
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
        await trashThreadAction(id);
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
        await trashThreadsAction(ids);
        setStatus(`Moved ${ids.length} to Trash`);
        haptic("success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Trash failed");
        haptic("warn");
        await reloadActiveView();
      }
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
        await deleteDraftAction(id);
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

  function runAiDraft() {
    setShowCompose(true);
    startTransition(async () => {
      try {
        if (isReplyContext() && selectedId) {
          const d = await draftReplyAction({
            threadId: selectedId,
            intent: composeBrief.trim() || undefined,
            tone: DEFAULT_DRAFT_TONE,
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
        const brief = composeBrief.trim() || subject.trim();
        if (!brief) {
          setStatus("Tell AI what to write in the AI assist box, then hit Draft");
          haptic("warn");
          return;
        }

        const d = await draftNewMailAction({
          to: splitAddrs(to),
          subject: subject.trim() || undefined,
          intent: brief,
          tone: DEFAULT_DRAFT_TONE,
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

  function applyDraftRefine(presetId?: DraftRefinePresetId) {
    startTransition(async () => {
      try {
        const html = await refineDraftAction({
          html: composeHtml,
          presetId,
          instruction: refineNote.trim() || undefined,
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
        const folder = await createMailLabelAction(name);
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
    const title =
      window.prompt("Meeting title", selectedThread?.subject || "Meeting") || "";
    if (!title.trim()) return;
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const attendees = [
      ...new Set(
        messages
          .flatMap((m) => [m.fromAddress, ...splitAddrs(m.toAddresses || "")])
          .filter((e) => e && !e.includes("thebluridge.com")),
      ),
    ].slice(0, 8);
    startTransition(async () => {
      try {
        const invite = await buildMeetingInviteAction({
          title: title.trim(),
          description: "Scheduled from BluRidge Mail",
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          attendees,
          confirmed: true,
        });
        const blob = new Blob([invite.ics], {
          type: "text/calendar;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = invite.filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("ICS downloaded — attach or forward as needed");
        haptic("success");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Invite failed");
        haptic("warn");
      }
    });
  }

  function runBulkCleanup() {
    startTransition(async () => {
      const rows = await bulkCleanupSuggestionsAction();
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
    startTransition(async () => {
      haptic("tap");
      try {
        const lower = q.toLowerCase();
        const recallMatch = lower.match(/^(recall|who is|about)\s+(.+)/i);
        const a = recallMatch
          ? await recallPersonAction(recallMatch[2]!.trim())
          : await askMailAction(q);
        setAskA(a.answer);
        setAskCitations(a.citationRefs || []);
        setAskSources(a.sourceRefs || []);
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
            From {accountInfo?.address}
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
        const r = await syncMailAction();
        if (r.bootstrap?.configured) applyBootstrap(r.bootstrap);
        await reloadActiveView();
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
        void reloadActiveView().then(() => {
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
            imported?: number;
            folderRole?: string;
          };
          if (data.type === "hello" || data.type === "ping") {
            setLiveConnected(true);
          }
          if (data.type === "mail:updated") {
            scheduleRefresh();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- live channel while configured
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
            <span style={{ color: "var(--mail-muted)" }}>{accountInfo?.address}</span>
            {accountInfo?.lastSyncedAt
              ? ` · ${timesReady ? formatSyncedAgo(accountInfo.lastSyncedAt, nowTick) : "—"} · ${threads.length} threads`
              : " · not synced — hit Refresh"}
            {liveConnected ? " · live" : ""}
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
                  const d = await digestAction();
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
                  const n = await createFollowUpRemindersAction();
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
                  const style = await refreshStyleAction();
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

          <IconBtn
            title="Auto-label rules"
            icon={<SlidersHorizontal size={15} />}
            onClick={() =>
              startTransition(async () => {
                haptic("tap");
                const rows = await listLabelRulesAction();
                setLabelRules(rows);
                setShowRules(true);
              })
            }
          />
          <IconBtn
            title="Signatures"
            icon={<PenLine size={15} />}
            onClick={() => {
              setShowSignatures(true);
              haptic("tap");
            }}
          />
          <IconBtn
            title="Keyboard shortcuts (?)"
            icon={<Keyboard size={15} />}
            onClick={() => {
              setShowShortcutHelp(true);
              haptic("tap");
            }}
          />
          <IconBtn
            title={
              desktopNotifsEnabled
                ? "Desktop notifications on — click to turn off"
                : "Turn on desktop notifications for new mail"
            }
            active={desktopNotifsEnabled}
            icon={desktopNotifsEnabled ? <BellRing size={15} /> : <Bell size={15} />}
            onClick={toggleDesktopNotifications}
          />
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
                      <div className="font-medium" style={{ color: "var(--text)" }}>
                        {r.name} → {r.label}
                      </div>
                      <div className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                        {r.matchJson}
                      </div>
                    </div>
                    <GhostBtn
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteLabelRuleAction(r.id);
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
                        await trashThreadAction(b.threadId);
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
              <FolderRow
                compact
                name="Smart Inbox"
                badge="★"
                icon={<Star size={16} />}
                active={activeFolder === SMART_INBOX_ID && !activeSmartLabel}
                onClick={selectSmartInbox}
              />
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
                          await dismissReminderAction(r.id);
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

        {/* Thread list — collapses into focus mode while composing a reply */}
        <AnimatePresence mode="popLayout">
          {!composingDocked && (
        <motion.section
          key="thread-list"
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ ...spring, delay: composingDocked ? 0 : 0.08 }}
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
              <span
                className="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                style={{
                  background: "var(--mail-purple-dim)",
                  color: "#c4b5fd",
                }}
              >
                {filteredThreads.length}
              </span>
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
                    className={`mail-thread-card ${active ? "is-active" : ""} ${featured ? "is-featured" : ""}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        role="checkbox"
                        aria-checked={selectedThreadIds.has(t.id)}
                        aria-label="Select thread"
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
                        {(tone || labels.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
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
                    {parseLabelsJson(selectedThread.labelsJson).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {parseLabelsJson(selectedThread.labelsJson).map((l) => {
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
                                        startTransition(async () => {
                                          await moveThreadToFolderAction(
                                            selectedId!,
                                            f.id,
                                          );
                                          setThreads((prev) =>
                                            prev.filter((x) => x.id !== selectedId),
                                          );
                                          setSelectedId(null);
                                          setStatus(`Moved to ${f.name}`);
                                          haptic("success");
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
                                  label: "Forward",
                                  onClick: composeForward,
                                },
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
                                  label: "Meeting ICS",
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
                          <p
                            className="text-xs font-semibold uppercase tracking-[0.16em]"
                            style={{ color: "var(--accent-bright)" }}
                          >
                            Reply
                          </p>
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
                  AI triage, summarize, draft, and ask sit on the right once a
                  conversation is open.
                </p>
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
              <GhostBtn
                primary
                disabled={askThinking || !askQ.trim()}
                onClick={() => runAsk(askQ)}
              >
                {askThinking ? "Thinking…" : "Ask"}
              </GhostBtn>
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
                  From {accountInfo?.address}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingSend && (
          <motion.div
            key="undo-send-toast"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={spring}
            className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 shadow-lg"
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
