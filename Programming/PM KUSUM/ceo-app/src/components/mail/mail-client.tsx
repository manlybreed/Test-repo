"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MailComposer } from "@/components/mail/composer";
import { MessageReader, type MailMessageView } from "@/components/mail/message-reader";
import {
  SignaturesPanel,
  type SignatureRow,
} from "@/components/mail/signatures-panel";
import { haptic } from "@/components/mail/haptics";
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
  refineDraftAction,
  createMailLabelAction,
  backfillSmartLabelsAction,
  searchThreadsAction,
  listOutboxAction,
  trashThreadAction,
  multilingualDraftAction,
  recallPersonAction,
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

const MAIL_POLL_MS = 3 * 60 * 1000;
const OUTBOX_ID = "__outbox__";
const SMART_INBOX_ID = "__smart_inbox__";

type Thread = {
  id: string;
  subject: string;
  snippet: string | null;
  lastMessageAt: string | Date;
  unreadCount: number;
  priority: string;
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
  opts: { folderRole?: string | null; myAddress?: string | null },
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

  const toList = fromMe
    ? parseAddrJson(last.toAddresses)
    : [last.fromAddress].filter(Boolean);
  const ccList = fromMe ? parseAddrJson(last.ccAddresses) : [];

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
}: {
  name: string;
  badge: string;
  active: boolean;
  onClick: () => void;
}) {
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={() => {
        haptic(danger ? "warn" : "tap");
        onClick();
      }}
      className={`cursor-pointer rounded-full px-3.5 py-2 text-xs font-semibold tracking-wide disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "mail-cta-primary" : ""}`}
      style={
        primary
          ? undefined
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
  const [showDraftRefine, setShowDraftRefine] = useState(false);
  const [refineNote, setRefineNote] = useState("");
  /** Brief for AI Draft on a fresh (non-reply) email */
  const [composeBrief, setComposeBrief] = useState("");
  const [pending, startTransition] = useTransition();
  /** Mailbox/thread-list loads — must NOT share `pending` or compose buttons freeze */
  const [, startNavTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [sending, setSending] = useState(false);
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
  /** When false, a background draft save must not reattach draftId (e.g. after opening a thread). */
  const attachDraftIdRef = useRef(true);
  const [status, setStatus] = useState("");
  const [askQ, setAskQ] = useState("");
  const [askA, setAskA] = useState("");
  const [askCitations, setAskCitations] = useState<AskCitation[]>([]);
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
  const [threadFilter, setThreadFilter] = useState<"all" | "unread" | "priority">(
    "all",
  );
  const [threadQuery, setThreadQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeSmartLabel, setActiveSmartLabel] = useState<SmartLabel | null>(
    null,
  );
  const [mailboxesOpen, setMailboxesOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(true);
  const [smartOpen, setSmartOpen] = useState(true);
  const [newLabelName, setNewLabelName] = useState("");
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [commitments, setCommitments] = useState<
    { title: string; dueAt?: string | null; priority?: string }[]
  >([]);

  const systemFolders = useMemo(
    () => pickSystemFolders(folderList),
    [folderList],
  );
  const labelFolders = useMemo(
    () => pickLabelFolders(folderList),
    [folderList],
  );

  const defaultSig = useMemo(
    () => sigList.find((s) => s.isDefault)?.htmlBody || "",
    [sigList],
  );

  const selectedThread = threads.find((t) => t.id === selectedId) || null;

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (threadFilter === "unread" && t.unreadCount <= 0) return false;
      if (threadFilter === "priority" && !["P1", "P2"].includes(t.priority)) {
        return false;
      }
      return true;
    });
  }, [threads, threadFilter]);

  // Smart search: AI expands intent, then matches subject/body/sender@domain
  useEffect(() => {
    const q = threadQuery.trim();
    if (q.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    setStatus("Searching with AI…");
    // Slightly longer debounce — AI expand + rerank costs a round-trip
    const handle = window.setTimeout(() => {
      startNavTransition(async () => {
        try {
          const rows = (await searchThreadsAction(q)) as Thread[];
          setThreads(rows);
          setActiveSmartLabel(null);
          setStatus(
            rows.length
              ? `Search · ${rows.length} result${rows.length === 1 ? "" : "s"}`
              : "Search · no matches",
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

  // Keep the list scoped to the selected mailbox / smart label / outbox
  useEffect(() => {
    if (!configured) return;
    if (threadQuery.trim().length >= 2) return;
    startNavTransition(async () => {
      await reloadActiveView();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, activeFolder, activeSmartLabel]);

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
      setComposeHtml(row?.bodyHtml || `<p></p>${defaultSig}`);
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
    setMessages([]);
    setStatus("Loading…");

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
          setTo(parseAddrJson(last.toAddresses).join(", "));
          setCc(parseAddrJson(last.ccAddresses).join(", "));
          setBcc("");
          setShowCcBcc(Boolean(parseAddrJson(last.ccAddresses).length));
          setSubject(last.subject);
          setComposeHtml(last.bodyHtml || `<p>${last.bodyText || ""}</p>`);
          setComposeHeaders({});
          setShowCompose(true);
          setStatus("Draft opened from mailbox — Save draft to keep edits");
          return;
        }

        const reply = replyContext(msgs, {
          folderRole: null,
          myAddress: accountInfo?.address,
        });
        setTo(reply.to);
        setCc(reply.cc);
        setBcc("");
        setShowCcBcc(Boolean(reply.cc));
        setSubject(reply.subject);
        setComposeHeaders({
          inReplyTo: reply.inReplyTo,
          referencesHdr: reply.referencesHdr,
        });
        setComposeHtml(`<p></p>${defaultSig}`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Could not open thread");
        haptic("warn");
      }
    })();
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

  async function reloadActiveView() {
    if (activeSmartLabel) {
      setThreads(
        (await listMailThreads({ label: activeSmartLabel })) as Thread[],
      );
      return;
    }
    if (activeFolder === OUTBOX_ID) {
      setThreads((await listOutboxAction()) as Thread[]);
      return;
    }
    if (activeFolder === SMART_INBOX_ID) {
      setThreads((await listMailThreads({ smartInbox: true })) as Thread[]);
      return;
    }
    if (activeFolder) {
      const folder = folderList.find((f) => f.id === activeFolder);
      if (folder?.role === "DRAFTS") {
        setThreads(
          (await listDraftsFolderAction(activeFolder)) as Thread[],
        );
      } else {
        setThreads(
          (await listMailThreads({ folderId: activeFolder })) as Thread[],
        );
      }
    }
  }

  function selectSmartInbox() {
    haptic("tap");
    setActiveSmartLabel(null);
    setThreadQuery("");
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
    setComposeHtml(`<p></p>${defaultSig}`);
    setShowDraftRefine(false);
    setRefineNote("");
    setComposeBrief("");
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
      setComposeHtml(d.bodyHtml || `<p></p>${defaultSig}`);
      setComposeHeaders({
        inReplyTo: d.inReplyTo || undefined,
        referencesHdr: d.referencesHdr || undefined,
      });
      setStatus("Draft loaded — edit and Save or Send");
      haptic("success");
    });
  }

  function composeIsDirty() {
    const body = (composeHtml || "")
      .replace(/<div[^>]*data-mail-sig[\s\S]*?<\/div>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return Boolean(
      to.trim() ||
        cc.trim() ||
        bcc.trim() ||
        subject.trim() ||
        (body && !/^best regards,?$/i.test(body)),
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
      setShowDraftRefine(false);
      setRefineNote("");
    }
    haptic("tap");
    if (shouldSave) autosaveDraftInBackground();
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
    })
      .then(async (row) => {
        if (row.status === "FAILED") {
          setStatus(row.error || "Send failed");
          haptic("warn");
          return;
        }
        setStatus(scheduledIso ? "Scheduled" : "Sent");
        setShowCompose(false);
        setComposeFullscreen(false);
        setDraftId(null);
        setComposeHeaders({});
        setShowDraftRefine(false);
        setComposeBrief("");
        setSendAtLocal("");
        haptic("success");
        await reloadActiveView();
      })
      .catch((e) => {
        setStatus(e instanceof Error ? e.message : "Send failed");
        haptic("warn");
      })
      .finally(() => setSending(false));
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
            setShowDraftRefine(true);
            setRefineNote("");
          }
          if (d?.subject) setSubject(d.subject);
          setStatus(
            d?.html
              ? "AI draft ready — pick a change below or keep as-is"
              : "AI draft unavailable",
          );
          haptic(d?.html ? "success" : "warn");
          return;
        }

        // Fresh compose — need a brief (what the email is about)
        const brief =
          composeBrief.trim() ||
          subject.trim() ||
          (await Promise.resolve(
            window.prompt(
              "What should this email say? (e.g. Intro BluRidge and propose a 20‑min call next week)",
            ),
          ))?.trim();

        if (!brief) {
          setStatus("Add a short brief for AI Draft, then try again");
          haptic("warn");
          return;
        }
        setComposeBrief(brief);

        const d = await draftNewMailAction({
          to: splitAddrs(to),
          subject: subject.trim() || undefined,
          intent: brief,
          tone: DEFAULT_DRAFT_TONE,
        });
        if (d?.html) {
          setComposeHtml(d.html);
          setShowDraftRefine(true);
          setRefineNote("");
        }
        if (d?.subject) setSubject(d.subject);
        setStatus(
          d?.html
            ? "AI draft ready — pick a change below or keep as-is"
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
    startTransition(async () => {
      haptic("tap");
      const lower = q.toLowerCase();
      const recallMatch = lower.match(/^(recall|who is|about)\s+(.+)/i);
      const a = recallMatch
        ? await recallPersonAction(recallMatch[2]!.trim())
        : await askMailAction(q);
      setAskA(a.answer);
      setAskCitations(a.citationRefs || []);
      haptic("success");
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

  function DraftRefinePanel() {
    if (!showDraftRefine) return null;
    return (
      <div
        className="space-y-2.5 rounded-xl px-3.5 py-3"
        style={{
          background: "rgba(139,92,246,0.1)",
          border: "1px solid rgba(139,92,246,0.28)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p
              className="text-xs font-semibold"
              style={{ color: "var(--accent-bright)" }}
            >
              What should we change?
            </p>
            <p className="mt-0.5 text-[0.7rem]" style={{ color: "var(--text-dim)" }}>
              Drafted in default warm-professional tone. Pick a preset or describe
              an edit.
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer text-[0.7rem] font-medium"
            style={{ color: "var(--text-muted)" }}
            disabled={pending}
            onClick={() => {
              setShowDraftRefine(false);
              setRefineNote("");
              setStatus("Keeping draft as-is");
              haptic("tap");
            }}
          >
            Keep as-is
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DRAFT_REFINE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              className="cursor-pointer rounded-full px-2.5 py-1 text-[0.68rem] font-medium transition-opacity disabled:opacity-50"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-muted)",
              }}
              onClick={() => {
                haptic("tap");
                applyDraftRefine(p.id);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="mail-search min-w-0 flex-1 text-xs"
            placeholder="Or type a change… e.g. mention the Friday call"
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

  /** Docked: Save + Send (+ autocomplete). Fullscreen: full AI toolkit. */
  function ComposeActionBar({ mode }: { mode: "docked" | "fullscreen" }) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span
          className="mr-auto text-[0.65rem]"
          style={{ color: "var(--text-dim)" }}
        >
          From {accountInfo?.address}
          {draftId ? " · draft saved" : ""}
        </span>
        {mode === "docked" && (
          <GhostBtn
            onClick={() => {
              setComposeFullscreen(true);
              haptic("tap");
            }}
          >
            Fullscreen
          </GhostBtn>
        )}
        <GhostBtn disabled={pending} onClick={runAutocomplete}>
          Autocomplete
        </GhostBtn>
        <GhostBtn disabled={pending} onClick={runAiDraft}>
          AI Draft
        </GhostBtn>
        {mode === "fullscreen" && (
          <>
            <GhostBtn disabled={pending} onClick={runShorten}>
              Shorten
            </GhostBtn>
            <GhostBtn disabled={pending} onClick={() => runRewrite("soften")}>
              Soften
            </GhostBtn>
            <GhostBtn disabled={pending} onClick={() => runRewrite("formalize")}>
              Formalize
            </GhostBtn>
            <GhostBtn disabled={pending} onClick={runMultilingualHindi}>
              Hindi
            </GhostBtn>
            <GhostBtn disabled={pending || !selectedId} onClick={runExtractTasks}>
              Tasks
            </GhostBtn>
            <GhostBtn disabled={pending || !selectedId} onClick={runTriage}>
              Triage
            </GhostBtn>
            <GhostBtn disabled={pending || !selectedId} onClick={runSummarize}>
              Summarize
            </GhostBtn>
            <GhostBtn disabled={pending} onClick={runMeetingInvite}>
              Meeting ICS
            </GhostBtn>
          </>
        )}
        <label
          className="flex items-center gap-1.5 text-[0.65rem]"
          style={{ color: "var(--text-dim)" }}
          title="Schedule send (AI-19)"
        >
          Send at
          <input
            type="datetime-local"
            className="mail-search py-1 text-[0.65rem]"
            value={sendAtLocal}
            disabled={sending}
            onChange={(e) => setSendAtLocal(e.target.value)}
          />
        </label>
        <GhostBtn disabled={pending || sending} onClick={saveCurrentDraft}>
          Save draft
        </GhostBtn>
        <GhostBtn
          primary
          disabled={sending || !to.trim()}
          onClick={sendCurrentDraft}
        >
          {sending
            ? "Sending…"
            : sendAtLocal
              ? "Schedule"
              : "Send"}
        </GhostBtn>
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
      setStatus("Syncing…");
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
          `Synced · ${r.imported} new` +
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
          setStatus(e instanceof Error ? e.message : "Sync failed");
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

  // Auto-check for new mail every 3 minutes while this page is open
  useEffect(() => {
    if (!configured) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      runSync({ quiet: true });
    };
    const id = window.setInterval(tick, MAIL_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only while configured
  }, [configured]);

  return (
    <div className="mail-shell relative flex h-[calc(100vh-7.5rem)] min-h-[560px] flex-col gap-3 overflow-hidden">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="flex flex-wrap items-end justify-between gap-3 px-2 pt-1"
      >
        <div>
          <p
            className="text-[0.65rem] font-semibold uppercase tracking-[0.24em]"
            style={{
              background: "var(--mail-grad)",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            BluRidge / Mail
          </p>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight"
            style={{ color: "var(--mail-text)" }}
          >
            Command inbox
          </h1>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--mail-dim)" }}
            suppressHydrationWarning
          >
            <span style={{ color: "var(--mail-muted)" }}>{accountInfo?.address}</span>
            {accountInfo?.lastSyncedAt
              ? ` · ${timesReady ? formatWhen(accountInfo.lastSyncedAt) : "—"} · ${threads.length} threads`
              : " · not synced — hit Sync"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostBtn onClick={composeNew} primary>
            Compose
          </GhostBtn>
          <GhostBtn onClick={() => runSync()} disabled={syncing || categorizing}>
            {syncing ? "Syncing…" : "Sync"}
          </GhostBtn>
          <GhostBtn onClick={runCategorizeAll} disabled={categorizing || syncing}>
            {categorizing
              ? jobProgress?.current != null && jobProgress.total
                ? `${jobProgress.current}/${jobProgress.total}`
                : "Categorizing…"
              : "Categorize"}
          </GhostBtn>
          <GhostBtn
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
          <GhostBtn onClick={runBulkCleanup} disabled={pending}>
            Cleanup
          </GhostBtn>
          <GhostBtn
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
          <GhostBtn
            onClick={() =>
              startTransition(async () => {
                haptic("tap");
                const rows = await listLabelRulesAction();
                setLabelRules(rows);
                setShowRules(true);
              })
            }
          >
            Rules
          </GhostBtn>
          <GhostBtn
            onClick={() => {
              setShowSignatures(true);
              haptic("tap");
            }}
          >
            Signatures
          </GhostBtn>
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
                {jobProgress.kind === "sync" ? "Sync" : "Categorize"}
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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-1 lg:grid-cols-12">
        {/* Folders + labels */}
        <motion.aside
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.05 }}
          className="mail-panel flex min-h-0 flex-col overflow-hidden lg:col-span-2"
        >
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
              {labelFolders.map((f) => (
                <FolderRow
                  key={f.id}
                  name={f.name}
                  badge="Lbl"
                  active={f.id === activeFolder && !activeSmartLabel}
                  onClick={() => selectFolder(f.id)}
                />
              ))}
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

          {reminders.length > 0 && (
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

        {/* Thread list */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.08 }}
          className="mail-panel flex min-h-0 flex-col overflow-hidden lg:col-span-3"
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
            <input
              className="mail-search"
              placeholder={
                searching
                  ? "Searching…"
                  : "Search anything — e.g. SBI POS machine…"
              }
              value={threadQuery}
              onChange={(e) => setThreadQuery(e.target.value)}
            />
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
          </div>
          <motion.ul
            variants={listStagger}
            initial="hidden"
            animate="show"
            className="min-h-0 flex-1 overflow-auto py-1"
          >
            {filteredThreads.map((t, idx) => {
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
            })}
            {!filteredThreads.length && (
              <li className="p-6 text-center text-sm" style={{ color: "var(--mail-dim)" }}>
                <p className="mb-3">
                  {threadQuery.trim().length >= 2
                    ? "No search results"
                    : "No threads match"}
                </p>
                <GhostBtn onClick={() => runSync()} primary>
                  Sync mailbox
                </GhostBtn>
              </li>
            )}
          </motion.ul>
        </motion.section>

        {/* Reader + compose */}
        <motion.section
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring, delay: 0.12 }}
          className="mail-panel relative flex min-h-0 flex-col overflow-hidden lg:col-span-7"
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
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* AI stays in the thread header for docked compose; fullscreen has its own bottom bar */}
                    {!composeFullscreen && (
                      <>
                        <GhostBtn
                          disabled={pending || !selectedId}
                          onClick={trashSelected}
                        >
                          Trash
                        </GhostBtn>
                        <GhostBtn disabled={pending} onClick={runTriage}>
                          Triage
                        </GhostBtn>
                        <GhostBtn disabled={pending} onClick={runSummarize}>
                          Summarize
                        </GhostBtn>
                        <GhostBtn
                          disabled={pending}
                          onClick={() => {
                            setShowCompose(true);
                            runAiDraft();
                          }}
                        >
                          AI Draft
                        </GhostBtn>
                        <GhostBtn disabled={pending} onClick={runExtractTasks}>
                          Tasks
                        </GhostBtn>
                        <GhostBtn
                          disabled={pending}
                          onClick={() => {
                            setShowCompose(true);
                            runShorten();
                          }}
                        >
                          Shorten
                        </GhostBtn>
                        <GhostBtn disabled={pending} onClick={runMeetingInvite}>
                          Meeting ICS
                        </GhostBtn>
                        <GhostBtn
                          disabled={pending || !selectedId}
                          onClick={() => {
                            const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
                            startTransition(async () => {
                              await snoozeThread(selectedId!, until.toISOString());
                              setStatus("Snoozed until tomorrow");
                              haptic("success");
                            });
                          }}
                        >
                          Snooze 1d
                        </GhostBtn>
                      </>
                    )}
                    <GhostBtn
                      primary
                      onClick={() => {
                        if (showCompose) {
                          closeCompose("hide");
                        } else {
                          setShowCompose(true);
                          haptic("tap");
                        }
                      }}
                    >
                      {showCompose ? "Hide reply" : "Reply"}
                    </GhostBtn>
                    {!showCompose && (
                      <GhostBtn
                        onClick={() => {
                          setShowCompose(true);
                          setComposeFullscreen(true);
                          haptic("tap");
                        }}
                      >
                        Reply fullscreen
                      </GhostBtn>
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

                <AnimatePresence>
                  {showCompose && !composeFullscreen && (
                    <motion.div
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 16 }}
                      transition={spring}
                      className="flex max-h-[58%] min-h-[280px] flex-col"
                      style={{
                        borderTop: "1px solid var(--border)",
                        background:
                          "linear-gradient(180deg, rgba(139,92,246,0.08), transparent 40%)",
                      }}
                    >
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-3">
                        <p
                          className="text-xs font-semibold uppercase tracking-[0.16em]"
                          style={{ color: "var(--accent-bright)" }}
                        >
                          Compose reply
                        </p>
                        <button
                          type="button"
                          className="cursor-pointer text-xs font-medium"
                          style={{ color: "var(--text-muted)" }}
                          onClick={() => {
                            setShowCcBcc((v) => !v);
                            haptic("tap");
                          }}
                        >
                          {showCcBcc || cc || bcc ? "Hide Cc / Bcc" : "Cc / Bcc"}
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-2">
                        <div
                          className="rounded-xl px-3.5 py-1"
                          style={{
                            background: "var(--bg-elevated)",
                            border: "1px solid var(--border-strong)",
                          }}
                        >
                          <div className="mail-compose-field">
                            <label htmlFor="mail-to">To</label>
                            <input
                              id="mail-to"
                              placeholder="name@company.com, …"
                              value={to}
                              onChange={(e) => setTo(e.target.value)}
                              autoComplete="email"
                            />
                          </div>
                          {(showCcBcc || cc) && (
                            <div className="mail-compose-field">
                              <label htmlFor="mail-cc">Cc</label>
                              <input
                                id="mail-cc"
                                placeholder="Optional carbon copy"
                                value={cc}
                                onChange={(e) => setCc(e.target.value)}
                                autoComplete="email"
                              />
                            </div>
                          )}
                          {(showCcBcc || bcc) && (
                            <div className="mail-compose-field">
                              <label htmlFor="mail-bcc">Bcc</label>
                              <input
                                id="mail-bcc"
                                placeholder="Optional blind copy"
                                value={bcc}
                                onChange={(e) => setBcc(e.target.value)}
                                autoComplete="email"
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
                          {!isReplyContext() && (
                            <div className="mail-compose-field">
                              <label htmlFor="mail-brief">AI brief</label>
                              <input
                                id="mail-brief"
                                placeholder="What should this email say?"
                                value={composeBrief}
                                onChange={(e) => setComposeBrief(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    runAiDraft();
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>

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
                          minHeight={180}
                        />

                        <DraftRefinePanel />
                      </div>

                      <div
                        className="shrink-0 px-4 py-3"
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: "rgba(7,7,8,0.92)",
                        }}
                      >
                        <ComposeActionBar mode="docked" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                onChange={(e) => setAskQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && askQ.trim()) runAsk(askQ);
                }}
              />
              <GhostBtn
                primary
                disabled={pending || !askQ.trim()}
                onClick={() => runAsk(askQ)}
              >
                Ask
              </GhostBtn>
            </div>
            <AnimatePresence>
              {askA && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 max-h-40 space-y-2 overflow-auto"
                >
                  <pre
                    className="whitespace-pre-wrap font-sans text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {askA}
                  </pre>
                  {askCitations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {askCitations.map((c) => (
                        <button
                          key={c.messageId}
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-1 text-[0.65rem] font-medium"
                          style={{
                            background: "rgba(139,92,246,0.15)",
                            border: "1px solid rgba(139,92,246,0.35)",
                            color: "var(--accent-bright)",
                          }}
                          title={c.subject}
                          onClick={() => {
                            haptic("tap");
                            openThread(c.threadId);
                          }}
                        >
                          {c.subject.slice(0, 36) || c.messageId.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
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
              <div className="flex flex-wrap gap-2">
                <GhostBtn
                  onClick={() => {
                    setShowCcBcc((v) => !v);
                    haptic("tap");
                  }}
                >
                  {showCcBcc || cc || bcc ? "Hide Cc / Bcc" : "Cc / Bcc"}
                </GhostBtn>
                <GhostBtn onClick={() => closeCompose("exit-fullscreen")}>
                  Exit fullscreen
                </GhostBtn>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
              <div
                className="shrink-0 rounded-2xl px-4 py-1"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                <div className="mail-compose-field">
                  <label htmlFor="mail-to-fs">To</label>
                  <input
                    id="mail-to-fs"
                    placeholder="name@company.com, …"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
                {(showCcBcc || cc) && (
                  <div className="mail-compose-field">
                    <label htmlFor="mail-cc-fs">Cc</label>
                    <input
                      id="mail-cc-fs"
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                    />
                  </div>
                )}
                {(showCcBcc || bcc) && (
                  <div className="mail-compose-field">
                    <label htmlFor="mail-bcc-fs">Bcc</label>
                    <input
                      id="mail-bcc-fs"
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
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
                {!isReplyContext() && (
                  <div className="mail-compose-field">
                    <label htmlFor="mail-brief-fs">AI brief</label>
                    <input
                      id="mail-brief-fs"
                      placeholder="What should this email say?"
                      value={composeBrief}
                      onChange={(e) => setComposeBrief(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          runAiDraft();
                        }
                      }}
                    />
                  </div>
                )}
              </div>

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

              <div className="shrink-0 px-1 pb-1">
                <DraftRefinePanel />
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
              <ComposeActionBar mode="fullscreen" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
