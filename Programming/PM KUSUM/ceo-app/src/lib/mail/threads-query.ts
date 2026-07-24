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
  subject: string;
  snippet: string | null;
  lastMessageAt: Date;
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
    select: { labelsJson: true },
  });
  if (!thread) return;

  const labels = parseLabels(thread.labelsJson).filter((l) => !FLAG_LABELS.has(l));

  if (!latest) {
    const anyLeft = await prisma.mailMessage.count({ where: { threadId } });
    if (!anyLeft) {
      await prisma.mailThread.delete({ where: { id: threadId } }).catch(() => undefined);
      return;
    }
    await prisma.mailThread.update({
      where: { id: threadId },
      data: { unreadCount: unread, labelsJson: JSON.stringify(labels) },
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
    subject: string;
    snippet: string | null;
    lastMessageAt: Date;
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
    subject: preview?.subject || t.subject,
    snippet: preview?.snippet ?? t.snippet,
    lastMessageAt: preview?.date || t.lastMessageAt,
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
  accountId: string;
  folderId?: string;
  folderRole?: string | null;
  label?: string;
  query?: string;
  /** AI / lexical concept plan for smarter search */
  searchPlan?: SearchPlanLike | null;
  /** Curated Inbox: actionable / readable mail only */
  smartInbox?: boolean;
  take?: number;
}): Promise<ThreadListRow[]> {
  const take = opts.take ?? 150;
  const label = opts.label?.trim();
  const q = opts.query?.trim();
  const searchPlan = opts.searchPlan ?? null;
  const smartInbox = Boolean(opts.smartInbox);

  let folderId = opts.folderId;
  let folderRole = opts.folderRole ?? null;

  if (smartInbox) {
    const inbox = await resolveSystemFolder(opts.accountId, "INBOX");
    folderId = inbox?.id;
    folderRole = "INBOX";
  } else if (!folderId && opts.folderRole) {
    const folder = await resolveSystemFolder(opts.accountId, opts.folderRole);
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

  const threads = await prisma.mailThread.findMany({
    where: q
      ? {
          accountId: opts.accountId,
          AND: [
            { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }] },
            ...(folderId ? [{ messages: { some: { folderId } } }] : []),
            ...(label ? [{ labelsJson: { contains: label } }] : []),
            ...excludeSmartInbox,
            ...smartInboxBulkGuard,
            ...searchAnd,
          ],
        }
      : {
          accountId: opts.accountId,
          AND: [
            { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }] },
            ...(folderId ? [{ messages: { some: { folderId } } }] : []),
            ...(label ? [{ labelsJson: { contains: label } }] : []),
            ...excludeSmartInbox,
            ...smartInboxBulkGuard,
          ],
        },
    orderBy: { lastMessageAt: "desc" },
    // Search pulls a wider net then re-ranks by relevance
    take: q
      ? Math.min(take * 4, 320)
      : smartInbox
        ? Math.min(take * 5, 500)
        : folderId
          ? Math.min(take * 3, 400)
          : take,
    select: {
      id: true,
      subject: true,
      snippet: true,
      lastMessageAt: true,
      unreadCount: true,
      priority: true,
      important: true,
      labelsJson: true,
    },
  });

  if (!threads.length) return [];

  const ids = threads.map((t) => t.id);

  const previewWhere = folderId
    ? { threadId: { in: ids }, folderId }
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
      if (folderId && !p) return null;
      return toRow(t, p, folderRole);
    })
    .filter((r): r is ThreadListRow => Boolean(r));

  if (q) {
    return mapped
      .map((row) => ({
        row,
        score: scoreSearchHit({
          query: q,
          subject: row.subject,
          snippet: row.snippet,
          fromAddress: row.fromAddress,
          fromName: row.fromName,
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
  }

  return mapped
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    )
    .slice(0, take);
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
