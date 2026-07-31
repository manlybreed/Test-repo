import { prisma } from "@/lib/prisma";
import { SMART_INBOX_EXCLUDE_LABELS } from "@/lib/mail/ai/smart-labels";
import {
  buildThreadSearchAnd,
  scoreSearchHit,
  type SearchPlanLike,
} from "@/lib/mail/mail-search";

/** IMAP flag chips — never treat as smart/user labels on the thread. */
export const FLAG_LABELS = new Set([
  "Draft",
  "Answered",
  "Starred",
  "Forwarded",
]);

const PREVIEW_EXCLUDE_ROLES = ["DRAFTS", "TRASH"] as const;

export type ThreadListRow = {
  id: string;
  /** Which mailbox this thread belongs to — lets the unified "All Inboxes"
   * view badge each row by account (client resolves this id to an address
   * via its already-loaded mailbox list; no join needed here). */
  accountId: string;
  subject: string;
  snippet: string | null;
  lastMessageAt: Date;
  /** When moved to Trash — retention metadata only, never used for sort/display date. */
  trashedAt: Date | null;
  unreadCount: number;
  priority: string;
  important: boolean;
  labelsJson: string;
  fromName: string | null;
  fromAddress: string | null;
  hasAttachments: boolean;
  answered: boolean;
};

function parseLabels(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function displayLabels(raw: string, folderRole: string | null): string[] {
  let labels = parseLabels(raw).filter((l) => !FLAG_LABELS.has(l));
  if (folderRole === "DRAFTS") labels = [...labels, "Draft"];
  return labels;
}

/**
 * Recompute shared thread denorm from non-draft/non-trash messages.
 * Call after import, delete, trash, or send.
 */
export async function recomputeThreadDenorm(threadId: string) {
  const latest = await prisma.mailMessage.findFirst({
    where: {
      threadId,
      folder: { role: { notIn: [...PREVIEW_EXCLUDE_ROLES] } },
    },
    orderBy: { date: "desc" },
    select: { date: true, snippet: true, subject: true },
  });

  const unread = await prisma.mailMessage.count({
    where: {
      threadId,
      seen: false,
      folder: { role: "INBOX" },
    },
  });

  const thread = await prisma.mailThread.findUnique({
    where: { id: threadId },
    select: { labelsJson: true, trashedAt: true },
  });
  if (!thread) return;

  const labels = parseLabels(thread.labelsJson).filter((l) => !FLAG_LABELS.has(l));

  if (!latest) {
    const anyLeft = await prisma.mailMessage.count({ where: { threadId } });
    if (!anyLeft) {
      await prisma.mailThread.delete({ where: { id: threadId } }).catch(() => undefined);
      return;
    }
    // `latest` came back empty, so every remaining message is Drafts/Trash.
    // If every one of them is specifically Trash (not just a lingering
    // draft), the thread itself must be marked trashed — otherwise it keeps
    // showing up, with stale subject/snippet, in every non-Trash view
    // (Inbox, All Inbox, "contacts"/keyword search) with an empty message
    // list once opened, since those views only ever exclude by folder scope
    // or by this trashedAt flag, never by "does anything survive to show."
    const nonTrashLeft = await prisma.mailMessage.count({
      where: { threadId, folder: { role: { not: "TRASH" } } },
    });
    await prisma.mailThread.update({
      where: { id: threadId },
      data: {
        unreadCount: unread,
        labelsJson: JSON.stringify(labels),
        trashedAt: nonTrashLeft === 0 ? (thread.trashedAt ?? new Date()) : thread.trashedAt,
      },
    });
    return;
  }

  await prisma.mailThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: latest.date,
      snippet: latest.snippet,
      subject: latest.subject || undefined,
      unreadCount: unread,
      labelsJson: JSON.stringify(labels),
      // A real non-Draft/non-Trash message exists — the thread can never be
      // considered trashed while that's true, even if it previously was.
      trashedAt: null,
    },
  });
}

type MsgPreview = {
  fromName: string | null;
  fromAddress: string;
  toAddresses: string;
  hasAttachments: boolean;
  answered: boolean;
  date: Date;
  snippet: string | null;
  subject: string;
};

function firstAddress(raw: string | null | undefined): string | null {
  try {
    const v = JSON.parse(raw || "[]");
    if (Array.isArray(v) && v[0]) return String(v[0]);
  } catch {
    /* ignore */
  }
  return null;
}

function toRow(
  t: {
    id: string;
    accountId: string;
    subject: string;
    snippet: string | null;
    lastMessageAt: Date;
    trashedAt: Date | null;
    unreadCount: number;
    priority: string;
    important: boolean;
    labelsJson: string;
  },
  preview: MsgPreview | null,
  folderRole: string | null,
): ThreadListRow {
  // Sent/Drafts: show the counterpart (To), not yourself as From
  const counterpart =
    folderRole === "SENT" || folderRole === "DRAFTS"
      ? firstAddress(preview?.toAddresses)
      : null;

  return {
    id: t.id,
    accountId: t.accountId,
    subject: preview?.subject || t.subject,
    snippet: preview?.snippet ?? t.snippet,
    lastMessageAt: preview?.date || t.lastMessageAt,
    trashedAt: t.trashedAt,
    unreadCount: folderRole === "INBOX" ? t.unreadCount : 0,
    priority: t.priority,
    important: t.important,
    labelsJson: JSON.stringify(displayLabels(t.labelsJson, folderRole)),
    fromName: counterpart ? null : preview?.fromName || null,
    fromAddress: counterpart || preview?.fromAddress || null,
    hasAttachments: preview?.hasAttachments ?? false,
    answered: preview?.answered ?? false,
  };
}

/** Strip IMAP flag chips that were historically stored on shared threads. */
export async function reconcileThreadFlagLabels(accountId: string) {
  const dirty = await prisma.mailThread.findMany({
    where: {
      accountId,
      OR: [...FLAG_LABELS].map((l) => ({
        labelsJson: { contains: `"${l}"` },
      })),
    },
    select: { id: true, labelsJson: true },
    take: 500,
  });
  for (const t of dirty) {
    const next = parseLabels(t.labelsJson).filter((l) => !FLAG_LABELS.has(l));
    const prev = parseLabels(t.labelsJson);
    if (next.length === prev.length) continue;
    await prisma.mailThread.update({
      where: { id: t.id },
      data: { labelsJson: JSON.stringify(next) },
    });
  }
  return dirty.length;
}

/**
 * Folder / label / search thread list with correct preview semantics:
 * - Folder view: preview + sort from messages in THAT folder only
 * - Smart Inbox: Inbox minus newsletters/receipts/list-unsubscribe bulk
 * - Global/search: preview from latest non-draft/non-trash message
 */
export async function queryThreadsForView(opts: {
  /** Single-mailbox view. Exactly one of accountId / accountIds is required. */
  accountId?: string;
  /** Unified "All Inboxes" view — spans every listed mailbox. There's no
   * single "the INBOX folder" once more than one account is in play, so a
   * folderId can't be resolved the way the single-account path does;
   * folder scoping falls back to matching folder ROLE across all of them. */
  accountIds?: string[];
  folderId?: string;
  folderRole?: string | null;
  label?: string;
  query?: string;
  /** AI / lexical concept plan for smarter search */
  searchPlan?: SearchPlanLike | null;
  /** Curated Inbox: actionable / readable mail only */
  smartInbox?: boolean;
  take?: number;
  /** Page offset (non-search views only — search always returns its top-ranked take). */
  skip?: number;
  /** Extra Prisma where fragments ANDed in as-is (e.g. parsed search operators). */
  extraWhere?: object[];
}): Promise<{ rows: ThreadListRow[]; total: number }> {
  const take = opts.take ?? 150;
  const skip = opts.skip ?? 0;
  const label = opts.label?.trim();
  const q = opts.query?.trim();
  const searchPlan = opts.searchPlan ?? null;
  const smartInbox = Boolean(opts.smartInbox);
  const unified = Boolean(opts.accountIds?.length);
  if (!unified && !opts.accountId) {
    throw new Error("queryThreadsForView requires accountId or accountIds");
  }
  const accountFilter: string | { in: string[] } = unified
    ? { in: opts.accountIds! }
    : opts.accountId!;

  let folderId = opts.folderId;
  /** Unified-view equivalent of folderId: one real folder id per account
   * sharing the resolved role, so preview/scoping stays exact (each
   * thread's preview comes from *that* folder, not just "some folder with
   * a matching role") instead of falling back to a looser role-only match. */
  let folderIds: string[] | null = null;
  let folderRole = opts.folderRole ?? null;

  if (unified) {
    if (smartInbox) folderRole = "INBOX";
    else if (opts.folderRole) folderRole = opts.folderRole;
    if (folderRole) {
      const rows = await prisma.mailFolder.findMany({
        where: { accountId: { in: opts.accountIds! }, role: folderRole },
        select: { id: true },
      });
      folderIds = rows.map((r) => r.id);
    }
  } else if (smartInbox) {
    const inbox = await resolveSystemFolder(opts.accountId!, "INBOX");
    folderId = inbox?.id;
    folderRole = "INBOX";
  } else if (!folderId && opts.folderRole) {
    const folder = await resolveSystemFolder(opts.accountId!, opts.folderRole);
    folderId = folder?.id;
    folderRole = folder?.role || opts.folderRole;
  } else if (folderId) {
    const folder = await prisma.mailFolder.findFirst({
      where: { id: folderId, accountId: opts.accountId },
      select: { role: true },
    });
    folderRole = folder?.role || null;
  }

  const excludeSmartInbox = smartInbox
    ? [
        ...SMART_INBOX_EXCLUDE_LABELS.map((l) => ({
          NOT: { labelsJson: { contains: `"${l}"` } },
        })),
        // P4 = noise (digests, tests, bulk mislabeled as FYI) — keep out of Smart Inbox
        { NOT: { priority: "P4" } },
      ]
    : [];

  const smartInboxBulkGuard = smartInbox
    ? [
        {
          NOT: {
            messages: {
              some: {
                ...(folderId ? { folderId } : { folder: { role: "INBOX" } }),
                listUnsubscribe: { not: null },
              },
            },
          },
        },
        // Known bulk senders even if triage said FYI
        {
          NOT: {
            messages: {
              some: {
                ...(folderId ? { folderId } : { folder: { role: "INBOX" } }),
                OR: [
                  { fromAddress: { contains: "hackernoon" } },
                  { fromAddress: { contains: "redditmail" } },
                  { fromAddress: { contains: "substack" } },
                  { fromAddress: { contains: "mailchimp" } },
                  { fromAddress: { contains: "beehiiv" } },
                  { fromAddress: { contains: "linkedin.com" } },
                  { fromAddress: { contains: "facebookmail" } },
                  { fromAddress: { contains: "email.claude.com" } },
                  { fromAddress: { contains: "reportsmailer" } },
                ],
              },
            },
          },
        },
      ]
    : [];

  const searchAnd = q ? buildThreadSearchAnd(q, searchPlan) : [];

  const folderScope = folderId
    ? { messages: { some: { folderId } } }
    : folderIds
      ? { messages: { some: { folderId: { in: folderIds } } } }
      : null;

  // Only the Trash folder view itself should ever surface a thread whose
  // messages have all been trashed. Every other view (Inbox, All Inbox,
  // a specific label, contacts/keyword search — none of which pass a
  // folderScope tight enough to exclude Trash on their own, e.g. the merged
  // "All Inbox" and the "contacts" search tier query with no folder scope
  // at all) relied on nothing to keep these out; trashedAt was previously
  // set but never actually enforced as a filter here. Without this, a
  // thread whose sole message got trashed kept appearing everywhere with
  // stale subject/snippet, opening to an empty message list once selected.
  const inTrash = folderRole === "TRASH";

  const whereClause = {
    accountId: accountFilter,
    AND: [
      { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }] },
      ...(inTrash ? [] : [{ trashedAt: null }]),
      ...(folderScope ? [folderScope] : []),
      ...(label ? [{ labelsJson: { contains: label } }] : []),
      ...excludeSmartInbox,
      ...smartInboxBulkGuard,
      ...searchAnd,
      ...(opts.extraWhere || []),
    ],
  };

  // Trash is sorted by when the message actually landed there, not by its
  // original send/receive date — otherwise trashing something old never
  // surfaces it at the top, which is the entire point of checking Trash
  // right after deleting something.

  // Non-search views paginate for real (skip/take at the DB level); search
  // pulls a wider net and re-ranks by relevance instead of paging.
  const [threads, total] = await Promise.all([
    prisma.mailThread.findMany({
      where: whereClause,
      orderBy: inTrash
        ? [{ trashedAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: "desc" }]
        : { lastMessageAt: "desc" },
      skip: q ? undefined : skip,
      take: q ? Math.min(take * 4, 320) : take,
      select: {
        id: true,
        accountId: true,
        subject: true,
        snippet: true,
        lastMessageAt: true,
        trashedAt: true,
        unreadCount: true,
        priority: true,
        important: true,
        labelsJson: true,
      },
    }),
    q ? Promise.resolve(0) : prisma.mailThread.count({ where: whereClause }),
  ]);

  if (!threads.length) return { rows: [], total };

  const ids = threads.map((t) => t.id);

  const previewWhere = folderId
    ? { threadId: { in: ids }, folderId }
    : folderIds
      ? { threadId: { in: ids }, folderId: { in: folderIds } }
      : {
          threadId: { in: ids },
          folder: { role: { notIn: [...PREVIEW_EXCLUDE_ROLES] } },
        };

  const previewCandidates = await prisma.mailMessage.findMany({
    where: previewWhere,
    orderBy: { date: "desc" },
    select: {
      threadId: true,
      fromName: true,
      fromAddress: true,
      toAddresses: true,
      hasAttachments: true,
      answered: true,
      date: true,
      snippet: true,
      subject: true,
    },
  });

  const byThread = new Map<string, (typeof previewCandidates)[number]>();
  for (const m of previewCandidates) {
    if (!byThread.has(m.threadId)) byThread.set(m.threadId, m);
  }

  const mapped = threads
    .map((t) => {
      const p = byThread.get(t.id) || null;
      if ((folderId || folderIds) && !p) return null;
      return toRow(t, p, folderRole);
    })
    .filter((r): r is ThreadListRow => Boolean(r));

  if (q) {
    const rows = mapped
      .map((row) => ({
        row,
        score: scoreSearchHit({
          query: q,
          subject: row.subject,
          snippet: row.snippet,
          fromAddress: row.fromAddress,
          fromName: row.fromName,
          date: row.lastMessageAt,
          plan: searchPlan,
        }),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (
          new Date(b.row.lastMessageAt).getTime() -
          new Date(a.row.lastMessageAt).getTime()
        );
      })
      .slice(0, take)
      .map((x) => x.row);
    return { rows, total: rows.length };
  }

  const rows = mapped.sort((a, b) => {
    if (inTrash) {
      const at = a.trashedAt ? new Date(a.trashedAt).getTime() : -Infinity;
      const bt = b.trashedAt ? new Date(b.trashedAt).getTime() : -Infinity;
      if (at !== bt) return bt - at;
    }
    return (
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  });
  return { rows, total };
}

/** Prefer canonical system folder for a role (shortest path / exact name). */
export async function resolveSystemFolder(
  accountId: string,
  role: string,
) {
  const folders = await prisma.mailFolder.findMany({
    where: { accountId, role },
  });
  if (!folders.length) return null;
  const score = (f: { path: string; name: string }) => {
    let s = 200 - f.path.length;
    const base = (f.path.split(/[/.]/).pop() || f.name).toLowerCase();
    if (
      ["inbox", "sent", "drafts", "draft", "trash", "junk", "spam", "archive"].includes(
        base,
      )
    ) {
      s += 80;
    }
    if (!f.path.includes(".") && !f.path.includes("/")) s += 40;
    return s;
  };
  return folders.sort((a, b) => score(b) - score(a))[0]!;
}
