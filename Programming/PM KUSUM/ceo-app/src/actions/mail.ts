"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { auth } from "@/lib/auth";
import { ceoMailConfigured } from "@/lib/mail/ceo-config";
import { ensureCeoMailAccount } from "@/lib/mail/account";
import { syncCeoMail, verifyCeoImap } from "@/lib/mail/sync";
import { cancelScheduled, flushDueScheduled, flushOutboxItem } from "@/lib/mail/outbox";
import { assertAutonomy } from "@/lib/mail/ai/policy";
import {
  backfillSmartLabels,
  repairSmartLabels,
  triageThread,
} from "@/lib/mail/ai/triage";
import { createMailLabel } from "@/lib/mail/labels";
import {
  archiveMailThread,
  archiveMailThreads,
  markInboxMessagesSeen,
  moveMailThreadToFolder,
  moveMailThreadsToFolder,
  trashMailThread,
  trashMailThreads,
} from "@/lib/mail/imap-mailbox";
import {
  queryThreadsForView,
  recomputeThreadDenorm,
  resolveSystemFolder,
} from "@/lib/mail/threads-query";
import { parseSearchOperators } from "@/lib/mail/mail-search";
import { summarizeThread } from "@/lib/mail/ai/summarize";
import { askMailbox, recallPerson, searchMail } from "@/lib/mail/ai/ask";
import { buildInboxDigest } from "@/lib/mail/ai/digest";
import {
  autocompleteDraft,
  DEFAULT_DRAFT_TONE,
  DRAFT_REFINE_PRESETS,
  draftNewMail,
  draftReply,
  multilingualDraft,
  refineDraftWithInstruction,
  rewriteDraft,
  type DraftRefinePresetId,
  type RewriteMode,
} from "@/lib/mail/ai/draft";
import {
  acceptCommitmentAsTask,
  extractCommitments,
} from "@/lib/mail/ai/commitments";
import { createFollowUpReminders, detectAwaitingReply } from "@/lib/mail/ai/followup";
import {
  extractAttachmentText,
  summarizeAttachment,
} from "@/lib/mail/ai/attachments";
import { buildIcsInvite } from "@/lib/mail/ai/meeting";
import {
  confirmUnsubscribeAction,
  suggestBulkCleanup,
} from "@/lib/mail/ai/bulk";
import { refreshStyleFromSent } from "@/lib/mail/ai/style";
import { htmlToText } from "@/lib/mail/normalize";
import {
  deleteLocalDraft,
  getLocalDraft,
  listLocalDrafts,
  saveMailDraft,
} from "@/lib/mail/drafts";
import { findContacts } from "@/lib/mail/contacts";

function revalidateMail() {
  revalidatePath("/ceo/mail");
  revalidatePath("/ceo/time");
}

async function requireAccount() {
  await requireCeo();
  const session = await auth();
  const account = await ensureCeoMailAccount(session?.user?.id);
  if (!account) throw new Error("Configure CEO_MAIL_USER and CEO_MAIL_PASS");
  return { account, userId: session?.user?.id as string };
}

export async function isCeoMailConfigured() {
  await requireCeo();
  return ceoMailConfigured();
}

export async function syncMailAction(opts?: { maxTriageNew?: number }) {
  const { userId } = await requireAccount();
  const result = await syncCeoMail({
    userId,
    maxPerFolder: 200,
    maxTriageNew: opts?.maxTriageNew ?? 8,
  });
  revalidateMail();
  const bootstrap = await getMailBootstrap();
  return { ...result, bootstrap };
}

export async function createMailLabelAction(name: string) {
  const { account } = await requireAccount();
  const folder = await createMailLabel({ accountId: account.id, name });
  revalidateMail();
  return folder;
}

export async function backfillSmartLabelsAction(opts?: {
  limit?: number;
  /** Skip heuristic repair (use on batch 2+ of a long run). */
  skipRepair?: boolean;
  /** Skip bootstrap payload — client reloads the active view at the end. */
  withBootstrap?: boolean;
}) {
  const { account } = await requireAccount();
  const limit = opts?.limit ?? 25;
  const skipRepair = Boolean(opts?.skipRepair);
  const withBootstrap = opts?.withBootstrap !== false;

  let repaired = 0;
  if (!skipRepair) {
    repaired = (
      await repairSmartLabels({
        accountId: account.id,
        limit: 100,
      }).catch(() => ({ checked: 0, fixed: 0 }))
    ).fixed;
  }

  const result = await backfillSmartLabels({
    accountId: account.id,
    limit,
  });
  revalidateMail();
  const bootstrap = withBootstrap ? await getMailBootstrap() : null;
  return { ...result, repaired, bootstrap };
}

export async function verifyCeoMailAction() {
  await requireCeo();
  if (!ceoMailConfigured()) return { ok: false, error: "Not configured" };
  try {
    await verifyCeoImap();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listMailFolders() {
  const { account } = await requireAccount();
  const rows = await prisma.mailFolder.findMany({
    where: { accountId: account.id },
    orderBy: { path: "asc" },
    include: { _count: { select: { messages: true } } },
  });
  return rows.map((f) => ({
    id: f.id,
    path: f.path,
    name: f.name,
    role: f.role,
    messageCount: f._count.messages,
  }));
}

export async function trashThreadAction(threadId: string) {
  const { account } = await requireAccount();
  assertAutonomy("delete", { confirmed: true });
  if (threadId.startsWith("outbox:") || threadId.startsWith("outbox-item:")) {
    throw new Error("Use Drafts/Outbox controls for local items");
  }
  const result = await trashMailThread({
    accountId: account.id,
    threadId,
  });
  // Targeted sync in background — do not block the UI
  void syncCeoMail({
    userId: account.userId,
    maxPerFolder: 40,
    maxTriageNew: 0,
  }).catch(() => undefined);
  revalidateMail();
  return result;
}

export async function archiveThreadAction(threadId: string) {
  const { account } = await requireAccount();
  assertAutonomy("archive");
  if (threadId.startsWith("outbox:") || threadId.startsWith("outbox-item:")) {
    throw new Error("Use Drafts/Outbox controls for local items");
  }
  const result = await archiveMailThread({ accountId: account.id, threadId });
  void syncCeoMail({
    userId: account.userId,
    maxPerFolder: 40,
    maxTriageNew: 0,
  }).catch(() => undefined);
  revalidateMail();
  return result;
}

export async function moveThreadToFolderAction(
  threadId: string,
  folderId: string,
) {
  const { account } = await requireAccount();
  assertAutonomy("move");
  if (threadId.startsWith("outbox:") || threadId.startsWith("outbox-item:")) {
    throw new Error("Use Drafts/Outbox controls for local items");
  }
  const result = await moveMailThreadToFolder({
    accountId: account.id,
    threadId,
    folderId,
  });
  void syncCeoMail({
    userId: account.userId,
    maxPerFolder: 40,
    maxTriageNew: 0,
  }).catch(() => undefined);
  revalidateMail();
  return result;
}

/** Real (non-outbox) thread ids only — local drafts/outbox items use their own controls. */
function realThreadIds(ids: string[]) {
  return ids.filter(
    (id) => !id.startsWith("outbox:") && !id.startsWith("outbox-item:"),
  );
}

export async function archiveThreadsAction(threadIds: string[]) {
  const { account, userId } = await requireAccount();
  assertAutonomy("archive");
  const ids = realThreadIds(threadIds);
  if (!ids.length) return { ok: true as const, archivePath: null };
  const result = await archiveMailThreads({ accountId: account.id, threadIds: ids });
  void syncCeoMail({ userId, maxPerFolder: 40, maxTriageNew: 0 }).catch(() => undefined);
  revalidateMail();
  return result;
}

export async function trashThreadsAction(threadIds: string[]) {
  const { account, userId } = await requireAccount();
  assertAutonomy("delete", { confirmed: true });
  const ids = realThreadIds(threadIds);
  if (!ids.length) return { ok: true as const, trashPath: null };
  const result = await trashMailThreads({ accountId: account.id, threadIds: ids });
  void syncCeoMail({ userId, maxPerFolder: 40, maxTriageNew: 0 }).catch(() => undefined);
  revalidateMail();
  return result;
}

export async function moveThreadsToFolderAction(threadIds: string[], folderId: string) {
  const { account, userId } = await requireAccount();
  assertAutonomy("move");
  const ids = realThreadIds(threadIds);
  if (!ids.length) return { ok: true as const, path: null };
  const result = await moveMailThreadsToFolder({
    accountId: account.id,
    threadIds: ids,
    folderId,
  });
  void syncCeoMail({ userId, maxPerFolder: 40, maxTriageNew: 0 }).catch(() => undefined);
  revalidateMail();
  return result;
}

export async function setThreadImportant(threadId: string, important: boolean) {
  await requireAccount();
  assertAutonomy("important");
  await prisma.mailThread.update({
    where: { id: threadId },
    data: { important },
  });
  revalidateMail();
}

export async function listTasksForThreadAction(threadId: string) {
  const { userId } = await requireAccount();
  if (!userId) return [];
  return prisma.task.findMany({
    where: { userId, mailThreadId: threadId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });
}

export async function blockSenderAction(input: {
  address: string;
  /** Also move this currently-open thread to Trash. */
  threadId?: string;
  confirmed?: boolean;
}) {
  const { account } = await requireAccount();
  assertAutonomy("block_sender", { confirmed: input.confirmed });
  const address = input.address.trim().toLowerCase();
  if (!address || !address.includes("@")) {
    throw new Error("A valid email address is required");
  }
  const row = await prisma.blockedSender.upsert({
    where: { accountId_address: { accountId: account.id, address } },
    create: { accountId: account.id, address },
    update: {},
  });
  if (
    input.threadId &&
    !input.threadId.startsWith("outbox:") &&
    !input.threadId.startsWith("outbox-item:")
  ) {
    await trashMailThread({ accountId: account.id, threadId: input.threadId }).catch(
      () => undefined,
    );
  }
  revalidateMail();
  return row;
}

export async function listBlockedSendersAction() {
  const { account } = await requireAccount();
  return prisma.blockedSender.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function unblockSenderAction(id: string) {
  const { account } = await requireAccount();
  await prisma.blockedSender.deleteMany({
    where: { id, accountId: account.id },
  });
  revalidateMail();
}

const THREADS_PAGE_SIZE = 50;

export async function listMailThreads(opts?: {
  folderId?: string;
  folderRole?: string;
  priority?: string;
  /** Match labelsJson substring (smart or custom label name). */
  label?: string;
  /** Curated Inbox — excludes newsletters, receipts, list-unsubscribe bulk */
  smartInbox?: boolean;
  /** 1-based page number for the thread list (ignored by priority filtering). */
  page?: number;
  pageSize?: number;
}) {
  const { account } = await requireAccount();
  const pageSize = opts?.pageSize ?? THREADS_PAGE_SIZE;
  const page = Math.max(1, opts?.page ?? 1);
  const { rows, total } = await queryThreadsForView({
    accountId: account.id,
    folderId: opts?.folderId,
    folderRole: opts?.folderRole,
    label: opts?.label,
    smartInbox: opts?.smartInbox,
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
  const filtered = opts?.priority
    ? rows.filter((r) => r.priority === opts.priority)
    : rows;
  return { rows: filtered, total, page, pageSize };
}

/**
 * Full-mailbox smart search:
 * 1) AI expands the query into concept groups (SBI POS → State Bank + e-statement…)
 * 2) Lexical match across subject / body / sender user@domain / attachments
 * 3) AI re-ranks the shortlist by intent
 */
export async function searchThreadsAction(query: string) {
  const { account } = await requireAccount();
  const q = query.trim();
  if (q.length < 2) return [];

  const { freeText, whereFragments } = parseSearchOperators(q);

  if (!freeText) {
    // Operators only (e.g. "is:unread has:attachment") — nothing to rank,
    // so just filter + sort by date instead of running AI-expand on "".
    const { rows } = await queryThreadsForView({
      accountId: account.id,
      extraWhere: whereFragments,
      take: 80,
    });
    return rows;
  }

  const { expandSearchQuery, lexicalSearchPlan, rerankSearchHits } =
    await import("@/lib/mail/ai/search-expand");

  const plan = await expandSearchQuery(freeText);

  let { rows } = await queryThreadsForView({
    accountId: account.id,
    query: freeText,
    searchPlan: plan,
    extraWhere: whereFragments,
    take: 80,
  });

  // If AI concepts were too strict, relax to lexical-only
  if (!rows.length && plan.mustGroups.length > 1) {
    ({ rows } = await queryThreadsForView({
      accountId: account.id,
      query: freeText,
      searchPlan: lexicalSearchPlan(freeText),
      extraWhere: whereFragments,
      take: 80,
    }));
  }

  if (rows.length < 2) return rows;

  const ordered = await rerankSearchHits({
    query: freeText,
    intent: plan.intent,
    candidates: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      fromAddress: r.fromAddress,
      fromName: r.fromName,
      snippet: r.snippet,
    })),
  });

  if (!ordered?.length) return rows;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ranked = ordered
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const seen = new Set(ranked.map((r) => r.id));
  for (const r of rows) {
    if (!seen.has(r.id)) ranked.push(r);
  }
  return ranked;
}

/** Pending / failed / recent sends (app outbox, not IMAP). */
export async function listOutboxAction() {
  const { account } = await requireAccount();
  await flushDueScheduled(10).catch(() => undefined);
  const rows = await prisma.mailOutbox.findMany({
    where: {
      accountId: account.id,
      // Pending queue only — SENT lives in the Sent mailbox
      status: { in: ["QUEUED", "SCHEDULED", "FAILED"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return rows.map((r) => {
    let to: string[] = [];
    try {
      to = JSON.parse(r.toAddresses) as string[];
    } catch {
      to = [];
    }
    return {
      id: `outbox-item:${r.id}`,
      outboxId: r.id,
      subject: r.subject || "(no subject)",
      snippet: `${r.status}${to[0] ? ` · ${to[0]}` : ""}${r.error ? ` · ${r.error}` : ""}`,
      lastMessageAt: r.updatedAt,
      unreadCount: r.status === "FAILED" || r.status === "QUEUED" ? 1 : 0,
      priority: r.status === "FAILED" ? "P1" : "P4",
      labelsJson: JSON.stringify([r.status]),
      fromName: "You",
      fromAddress: account.address,
      hasAttachments: false,
      answered: false,
      outboxStatus: r.status,
      toAddresses: to,
      bodyHtml: r.bodyHtml,
    };
  });
}

export async function getMailThread(
  threadId: string,
  opts?: { folderId?: string; folderRole?: string },
) {
  const { account } = await requireAccount();
  let folderId = opts?.folderId;
  let folderRole = opts?.folderRole || null;
  if (folderId && !folderRole) {
    const folder = await prisma.mailFolder.findFirst({
      where: { id: folderId, accountId: account.id },
      select: { role: true },
    });
    folderRole = folder?.role || null;
  }
  if (!folderId && folderRole) {
    const folder = await resolveSystemFolder(account.id, folderRole);
    folderId = folder?.id;
  }

  // Drafts/Trash: show that mailbox's copies only.
  // Inbox/Sent/labels/search: full conversation (exclude Drafts/Trash clutter).
  const mailboxScoped = folderRole === "DRAFTS" || folderRole === "TRASH";

  return prisma.mailThread.findFirst({
    where: { id: threadId, accountId: account.id },
    include: {
      messages: {
        where: mailboxScoped
          ? folderId
            ? { folderId }
            : { folder: { role: folderRole! } }
          : { folder: { role: { notIn: ["DRAFTS", "TRASH"] } } },
        orderBy: { date: "asc" },
        include: { attachments: true, folder: true },
      },
    },
  });
}

export async function markThreadRead(threadId: string) {
  const { account } = await requireAccount();
  assertAutonomy("mark_read");
  // Unread is Inbox-scoped — don't touch Sent/Drafts/Trash copies
  await prisma.mailMessage.updateMany({
    where: {
      threadId,
      accountId: account.id,
      folder: { role: "INBOX" },
      seen: false,
    },
    data: { seen: true },
  });
  await recomputeThreadDenorm(threadId);
  void markInboxMessagesSeen({
    accountId: account.id,
    threadId,
  }).catch(() => undefined);
  revalidateMail();
}

export async function snoozeThread(threadId: string, untilIso: string) {
  await requireAccount();
  assertAutonomy("snooze");
  await prisma.mailThread.update({
    where: { id: threadId },
    data: { snoozedUntil: new Date(untilIso) },
  });
  revalidateMail();
}

export async function setThreadPriority(threadId: string, priority: string) {
  await requireAccount();
  await prisma.mailThread.update({
    where: { id: threadId },
    data: { priority },
  });
  revalidateMail();
}

export async function listSignatures() {
  const { account } = await requireAccount();
  return prisma.mailSignature.findMany({
    where: { accountId: account.id },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
}

export async function upsertSignature(input: {
  id?: string;
  name: string;
  htmlBody: string;
  isDefault?: boolean;
}) {
  const { account } = await requireAccount();
  if (input.isDefault) {
    await prisma.mailSignature.updateMany({
      where: { accountId: account.id },
      data: { isDefault: false },
    });
  }
  if (input.id) {
    const owned = await prisma.mailSignature.findFirst({
      where: { id: input.id, accountId: account.id },
    });
    if (!owned) throw new Error("Signature not found");
    const row = await prisma.mailSignature.update({
      where: { id: input.id },
      data: {
        name: input.name,
        htmlBody: input.htmlBody,
        isDefault: input.isDefault ?? false,
      },
    });
    revalidateMail();
    return row;
  }
  const row = await prisma.mailSignature.create({
    data: {
      accountId: account.id,
      name: input.name,
      htmlBody: input.htmlBody,
      isDefault: input.isDefault ?? false,
    },
  });
  revalidateMail();
  return row;
}

export async function deleteSignature(id: string) {
  const { account } = await requireAccount();
  const sig = await prisma.mailSignature.findFirst({
    where: { id, accountId: account.id },
  });
  if (!sig) throw new Error("Signature not found");
  await prisma.mailSignature.delete({ where: { id } });
  if (sig.isDefault) {
    const next = await prisma.mailSignature.findFirst({
      where: { accountId: account.id },
      orderBy: { sortOrder: "asc" },
    });
    if (next) {
      await prisma.mailSignature.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }
  revalidateMail();
  return { ok: true };
}

export async function getVacationSettingsAction() {
  const { account } = await requireAccount();
  const row = await prisma.mailVacationResponder.findUnique({
    where: { accountId: account.id },
  });
  if (!row) return null;
  return {
    enabled: row.enabled,
    subject: row.subject,
    message: row.message,
    startDate: row.startDate,
    endDate: row.endDate,
    excludedSenders: JSON.parse(row.excludedSendersJson || "[]") as string[],
  };
}

/**
 * Saves vacation-responder settings and pushes/activates (or deactivates) the
 * corresponding Sieve script via ManageSieve. See src/lib/mail/vacation.ts
 * for the safeguards this enforces (mandatory expiry, exclusion list) —
 * this is a destructive/irreversible-adjacent action per the mail feature
 * plan's sign-off section, so every save requires explicit confirmation.
 */
export async function saveVacationSettingsAction(input: {
  enabled: boolean;
  subject: string;
  message: string;
  startDate: string;
  endDate: string;
  excludedSenders: string[];
  confirmed: boolean;
}) {
  const { account } = await requireAccount();
  if (!input.confirmed) {
    throw new Error("Vacation responder changes require confirmation");
  }
  assertAutonomy("vacation_responder", { confirmed: true });

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);

  const { buildVacationSieveScript, VACATION_SCRIPT_NAME } = await import(
    "@/lib/mail/vacation"
  );
  const { withManageSieve } = await import("@/lib/mail/managesieve");

  if (input.enabled) {
    // Throws (before touching the mail server) if the window is missing,
    // backwards, or longer than the max — never "on indefinitely".
    const script = buildVacationSieveScript({
      subject: input.subject.trim() || "Out of office",
      message: input.message.trim(),
      startDate,
      endDate,
      excludedSenders: input.excludedSenders,
      fromAddress: account.address,
    });
    await withManageSieve(async (client) => {
      await client.putScript(VACATION_SCRIPT_NAME, script);
      await client.setActive(VACATION_SCRIPT_NAME);
    });
  } else {
    await withManageSieve(async (client) => {
      await client.deactivateAll();
    });
  }

  const row = await prisma.mailVacationResponder.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      enabled: input.enabled,
      subject: input.subject.trim() || "Out of office",
      message: input.message.trim(),
      startDate,
      endDate,
      excludedSendersJson: JSON.stringify(input.excludedSenders),
    },
    update: {
      enabled: input.enabled,
      subject: input.subject.trim() || "Out of office",
      message: input.message.trim(),
      startDate,
      endDate,
      excludedSendersJson: JSON.stringify(input.excludedSenders),
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "MailVacationResponder",
      entityId: row.id,
      action: input.enabled ? "VACATION_ENABLED" : "VACATION_DISABLED",
      afterJson: JSON.stringify({
        enabled: input.enabled,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
    },
  });

  revalidateMail();
  return { ok: true as const };
}

export type ComposeAttachment = {
  /** Server-side storage path (never a client-supplied path). */
  path: string;
  filename: string;
  size: number;
  contentType: string | null;
};

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per mail (Gmail-like)

/**
 * Upload compose attachments (FormData "files"). Stored under
 * storage/mail/outgoing/<uuid>/ and referenced at send time.
 */
export async function uploadComposeAttachmentAction(
  formData: FormData,
): Promise<ComposeAttachment[]> {
  const { account } = await requireAccount();
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (!files.length) return [];

  const { default: path } = await import("path");
  const { promises: fs } = await import("fs");

  const storageRoot = process.env.STORAGE_ROOT || "./storage";
  const dir = path.join(storageRoot, "mail", "outgoing", account.id, randomUUID());
  await fs.mkdir(dir, { recursive: true });

  const out: ComposeAttachment[] = [];
  let total = 0;
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is over the 15 MB per-file limit`);
    }
    total += file.size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Attachments exceed the 25 MB total limit");
    }
    const safeName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "attachment";
    const filePath = path.join(dir, safeName);
    await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    out.push({
      path: filePath,
      filename: safeName,
      size: file.size,
      contentType: file.type || null,
    });
  }
  return out;
}

/**
 * Copy a received message's attachments into the compose/outgoing area so a
 * Forward can carry them along. Best-effort per file — a missing/unreadable
 * original attachment is skipped rather than failing the whole forward.
 */
export async function forwardMessageAttachmentsAction(
  messageId: string,
): Promise<ComposeAttachment[]> {
  const { account } = await requireAccount();
  const atts = await prisma.mailAttachment.findMany({
    where: { messageId, message: { accountId: account.id } },
  });
  if (!atts.length) return [];

  const { default: path } = await import("path");
  const { promises: fs } = await import("fs");

  const storageRoot = path.resolve(process.env.STORAGE_ROOT || "./storage");
  const dir = path.join(storageRoot, "mail", "outgoing", account.id, randomUUID());

  const out: ComposeAttachment[] = [];
  for (const att of atts) {
    if (!att.storagePath) continue;
    const abs = path.resolve(att.storagePath);
    if (!abs.startsWith(storageRoot) && !abs.includes(`${path.sep}mail${path.sep}`)) {
      continue;
    }
    try {
      const buf = await fs.readFile(abs);
      await fs.mkdir(dir, { recursive: true });
      const safeName =
        att.filename.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "attachment";
      const destPath = path.join(dir, safeName);
      await fs.writeFile(destPath, buf);
      out.push({
        path: destPath,
        filename: safeName,
        size: att.size || buf.length,
        contentType: att.contentType || null,
      });
    } catch {
      // Original file missing on disk — skip, don't fail the whole forward.
    }
  }
  return out;
}

export async function sendMailAction(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  referencesHdr?: string;
  confirmed: boolean;
  sendAt?: string | null;
  /** If sending a previously saved draft, remove it from Drafts */
  draftId?: string;
  /** Uploaded attachments (from uploadComposeAttachmentAction) */
  attachments?: ComposeAttachment[];
  /** Undo-Send window, in seconds — clamped to a sane range. Default 10. */
  undoWindowSeconds?: number;
}) {
  const { account } = await requireAccount();
  if (!input.confirmed) throw new Error("Send requires confirmation");

  // Attachment paths must live inside THIS account's upload dir — client-echoed
  // paths must never be able to reference arbitrary server files.
  if (input.attachments?.length) {
    const { default: path } = await import("path");
    const storageRoot = process.env.STORAGE_ROOT || "./storage";
    const allowedRoot = path.resolve(
      path.join(storageRoot, "mail", "outgoing", account.id),
    );
    for (const att of input.attachments) {
      const resolved = path.resolve(att.path);
      if (!resolved.startsWith(allowedRoot + path.sep)) {
        throw new Error("Invalid attachment reference");
      }
      att.path = resolved;
    }
  }

  const status = input.sendAt ? "SCHEDULED" : "QUEUED";
  if (input.sendAt) {
    assertAutonomy("schedule_send", { confirmed: true });
  } else {
    assertAutonomy("send", { confirmed: true });
  }

  // Immediate sends get a real Undo window: held QUEUED here, actually
  // dispatched later by flushQueuedSendAction once the client-side undo
  // countdown elapses (or dropped by cancelScheduledSend if the user undoes).
  const undoWindowMs =
    Math.max(3, Math.min(60, input.undoWindowSeconds ?? 10)) * 1000;
  const row = await prisma.mailOutbox.create({
    data: {
      accountId: account.id,
      toAddresses: JSON.stringify(input.to),
      ccAddresses: JSON.stringify(input.cc || []),
      bccAddresses: JSON.stringify(input.bcc || []),
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: htmlToText(input.bodyHtml),
      inReplyTo: input.inReplyTo || null,
      referencesHdr: input.referencesHdr || null,
      attachmentsJson: JSON.stringify(input.attachments || []),
      status,
      sendAt: input.sendAt ? new Date(input.sendAt) : new Date(),
      undoUntil: input.sendAt ? null : new Date(Date.now() + undoWindowMs),
      idempotencyKey: randomUUID(),
    },
  });

  if (input.draftId) {
    void deleteLocalDraft(account.id, input.draftId).catch(() => undefined);
  }

  if (input.sendAt) {
    await prisma.auditLog.create({
      data: {
        entityType: "MailOutbox",
        entityId: row.id,
        action: "MAIL_SCHEDULE",
        afterJson: JSON.stringify({
          subject: input.subject,
          to: input.to,
          status: row.status,
        }),
      },
    });
  }

  revalidateMail();
  return row;
}

/**
 * Actually dispatch a QUEUED immediate send once its client-side Undo
 * countdown has elapsed without being cancelled. Race-safe: a no-op if the
 * item was already sent or cancelled by the time this fires.
 */
export async function flushQueuedSendAction(outboxId: string) {
  const { account, userId } = await requireAccount();
  const row = await prisma.mailOutbox.findFirst({
    where: { id: outboxId, accountId: account.id },
  });
  if (!row) throw new Error("Outbox item not found");
  if (row.status === "CANCELLED" || row.status === "SENT") return row;

  const flushed = await flushOutboxItem(outboxId, { confirmed: true });
  void syncCeoMail({ userId, maxPerFolder: 40, maxTriageNew: 0 }).catch(() => undefined);

  await prisma.auditLog.create({
    data: {
      entityType: "MailOutbox",
      entityId: row.id,
      action: "MAIL_SEND",
      afterJson: JSON.stringify({
        subject: row.subject,
        to: JSON.parse(row.toAddresses || "[]"),
        status: flushed.status,
      }),
    },
  });

  revalidateMail();
  return flushed;
}

export async function saveDraftAction(input: {
  draftId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  referencesHdr?: string;
}) {
  const { account } = await requireAccount();
  assertAutonomy("draft");
  const row = await saveMailDraft({
    accountId: account.id,
    draftId: input.draftId,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    inReplyTo: input.inReplyTo,
    referencesHdr: input.referencesHdr,
  });

  // Local Drafts list is authoritative; light IMAP sync in background
  void syncCeoMail({
    userId: account.userId,
    maxPerFolder: 25,
    maxTriageNew: 0,
  }).catch(() => undefined);

  await prisma.auditLog.create({
    data: {
      entityType: "MailOutbox",
      entityId: row.id,
      action: "MAIL_DRAFT_SAVE",
      afterJson: JSON.stringify({ subject: row.subject }),
    },
  });

  revalidateMail();
  return {
    id: row.id,
    subject: row.subject,
    updatedAt: row.updatedAt,
  };
}

export async function listDraftsAction() {
  const { account } = await requireAccount();
  const rows = await listLocalDrafts(account.id);
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    toAddresses: r.toAddresses,
    ccAddresses: r.ccAddresses,
    bodyHtml: r.bodyHtml,
    bodyText: r.bodyText,
    inReplyTo: r.inReplyTo,
    updatedAt: r.updatedAt,
    snippet: (r.bodyText || "").replace(/\s+/g, " ").slice(0, 140),
  }));
}

/**
 * Drafts mailbox list: local outbox drafts + IMAP drafts, de-duplicated by IMAP UID.
 */
export async function listDraftsFolderAction(folderId: string) {
  const { account } = await requireAccount();
  const [local, { rows: imapRows }] = await Promise.all([
    listLocalDrafts(account.id),
    queryThreadsForView({
      accountId: account.id,
      folderId,
      take: 150,
    }),
  ]);

  const claimedUids = new Set<number>();
  for (const d of local) {
    const ref = d.smtpMessageId;
    if (!ref?.startsWith("imap:")) continue;
    const uid = Number(ref.slice(ref.lastIndexOf(":") + 1));
    if (Number.isFinite(uid)) claimedUids.add(uid);
  }

  let filtered = imapRows;
  if (claimedUids.size) {
    const claimedMsgs = await prisma.mailMessage.findMany({
      where: {
        accountId: account.id,
        folderId,
        imapUid: { in: [...claimedUids] },
      },
      select: { threadId: true },
    });
    const hideThreads = new Set(claimedMsgs.map((m) => m.threadId));
    filtered = imapRows.filter((t) => !hideThreads.has(t.id));
  }

  const synth = local.map((d) => {
    let to: string[] = [];
    try {
      to = JSON.parse(d.toAddresses || "[]") as string[];
    } catch {
      to = [];
    }
    const snippet = (d.bodyText || "").replace(/\s+/g, " ").slice(0, 140);
    return {
      id: `outbox:${d.id}`,
      subject: d.subject || "(no subject)",
      snippet: snippet || null,
      lastMessageAt: d.updatedAt,
      unreadCount: 0,
      priority: "P4",
      labelsJson: JSON.stringify(["Draft"]),
      fromName: null as string | null,
      fromAddress: to[0] || account.address,
      hasAttachments: false,
      answered: false,
    };
  });

  return [...synth, ...filtered].sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );
}

export async function getDraftAction(draftId: string) {
  const { account } = await requireAccount();
  const row = await getLocalDraft(account.id, draftId);
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    to: JSON.parse(row.toAddresses || "[]") as string[],
    cc: JSON.parse(row.ccAddresses || "[]") as string[],
    bcc: JSON.parse(row.bccAddresses || "[]") as string[],
    bodyHtml: row.bodyHtml,
    inReplyTo: row.inReplyTo,
    referencesHdr: row.referencesHdr,
    updatedAt: row.updatedAt,
  };
}

export async function deleteDraftAction(draftId: string) {
  const { account } = await requireAccount();
  const result = await deleteLocalDraft(account.id, draftId);
  revalidateMail();
  return result;
}

export async function cancelScheduledSend(outboxId: string) {
  await requireAccount();
  await cancelScheduled(outboxId);
  revalidateMail();
}

export async function flushScheduledMailAction() {
  await requireAccount();
  const rows = await flushDueScheduled();
  revalidateMail();
  return { flushed: rows.length };
}

export async function triageThreadAction(
  threadId: string,
  opts?: { force?: boolean },
) {
  await requireAccount();
  // Manual Triage always re-runs so the user can refresh categorization
  return triageThread(threadId, { force: opts?.force ?? true });
}

export async function summarizeThreadAction(threadId: string) {
  const { account } = await requireAccount();
  return summarizeThread(account.id, threadId);
}

export async function digestAction() {
  const { account } = await requireAccount();
  const digest = await buildInboxDigest(account.id);
  await prisma.mailAccount.update({
    where: { id: account.id },
    data: { lastVisitAt: new Date() },
  });
  return digest;
}

export async function searchMailAction(query: string) {
  const { account } = await requireAccount();
  return searchMail(account.id, query);
}

export async function askMailAction(question: string) {
  const { account } = await requireAccount();
  return askMailbox(account.id, question);
}

export async function recallPersonAction(person: string) {
  const { account } = await requireAccount();
  return recallPerson(account.id, person);
}

/** Lightweight recipient suggestions for the To/Cc/Bcc autocomplete dropdown. */
export async function findContactsAction(query: string) {
  const { account } = await requireAccount();
  const rows = await findContacts(account.id, query, 6);
  return rows.map((r) => ({ address: r.address, displayName: r.displayName }));
}

export async function draftReplyAction(input: {
  threadId: string;
  intent?: string;
  tone?: string;
}) {
  const { account } = await requireAccount();
  return draftReply({
    accountId: account.id,
    threadId: input.threadId,
    intent: input.intent,
    tone: input.tone || DEFAULT_DRAFT_TONE,
  });
}

/** AI draft for a brand-new email (Compose), not a reply. */
export async function draftNewMailAction(input: {
  to: string[];
  intent: string;
  subject?: string;
  tone?: string;
}) {
  const { account } = await requireAccount();
  return draftNewMail({
    accountId: account.id,
    to: input.to,
    intent: input.intent,
    subject: input.subject,
    tone: input.tone || DEFAULT_DRAFT_TONE,
  });
}

export async function rewriteDraftAction(input: {
  html: string;
  mode: RewriteMode;
  targetLang?: string;
  instruction?: string;
}) {
  await requireCeo();
  return rewriteDraft(input);
}

export async function refineDraftAction(input: {
  html: string;
  presetId?: DraftRefinePresetId;
  instruction?: string;
}) {
  await requireCeo();
  const fromPreset = input.presetId
    ? DRAFT_REFINE_PRESETS.find((p) => p.id === input.presetId)?.instruction
    : undefined;
  const custom = input.instruction?.trim();
  const instruction = [fromPreset, custom].filter(Boolean).join(" Also: ");
  if (!instruction) throw new Error("Choose a preset or describe the change");
  return refineDraftWithInstruction({ html: input.html, instruction });
}

export async function listDraftRefinePresetsAction() {
  await requireCeo();
  return DRAFT_REFINE_PRESETS.map(({ id, label }) => ({ id, label }));
}

export async function autocompleteAction(prefix: string, threadSnippet?: string) {
  await requireCeo();
  return autocompleteDraft({ prefix, threadSnippet });
}

export async function multilingualDraftAction(input: {
  threadId: string;
  language: string;
  intent?: string;
}) {
  const { account } = await requireAccount();
  return multilingualDraft({
    accountId: account.id,
    threadId: input.threadId,
    language: input.language,
    intent: input.intent,
  });
}

export async function extractCommitmentsAction(threadId: string) {
  const { account } = await requireAccount();
  return extractCommitments(account.id, threadId);
}

export async function acceptCommitmentAction(input: {
  threadId: string;
  messageId?: string;
  title: string;
  dueAt?: string | null;
  priority?: string;
  confirmed: boolean;
}) {
  const { userId } = await requireAccount();
  const task = await acceptCommitmentAsTask({ ...input, userId });
  revalidateMail();
  return task;
}

export async function followUpsAction() {
  const { account } = await requireAccount();
  return detectAwaitingReply(account.id);
}

export async function createFollowUpRemindersAction() {
  const { account } = await requireAccount();
  const rows = await createFollowUpReminders(account.id);
  revalidateMail();
  return rows;
}

export async function extractAttachmentAction(attachmentId: string) {
  await requireCeo();
  return extractAttachmentText(attachmentId);
}

export async function summarizeAttachmentAction(attachmentId: string) {
  await requireCeo();
  return summarizeAttachment(attachmentId);
}

export async function buildMeetingInviteAction(input: {
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  confirmed: boolean;
}) {
  const { account } = await requireAccount();
  return buildIcsInvite({
    ...input,
    organizerEmail: account.address,
    attendeeEmails: input.attendees,
  });
}

export async function bulkCleanupSuggestionsAction() {
  const { account } = await requireAccount();
  return suggestBulkCleanup(account.id);
}

export async function unsubscribeCandidateAction(
  messageId: string,
  opts?: { confirmed?: boolean },
) {
  await requireCeo();
  // AI-21: irreversible — caller must pass confirmed: true after UI prompt
  return confirmUnsubscribeAction({
    messageId,
    confirmed: Boolean(opts?.confirmed),
  });
}

export async function refreshStyleAction() {
  const { account } = await requireAccount();
  return refreshStyleFromSent(account.id);
}

export async function listRemindersAction() {
  const { account } = await requireAccount();
  return prisma.mailReminder.findMany({
    where: { accountId: account.id, dismissed: false },
    orderBy: { dueAt: "asc" },
    take: 50,
  });
}

export async function dismissReminderAction(reminderId: string) {
  const { account } = await requireAccount();
  await prisma.mailReminder.updateMany({
    where: { id: reminderId, accountId: account.id },
    data: { dismissed: true },
  });
  revalidateMail();
  return { ok: true as const };
}

export async function listLabelRulesAction() {
  const { account } = await requireAccount();
  return prisma.mailLabelRule.findMany({
    where: { accountId: account.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function upsertLabelRuleAction(input: {
  name: string;
  label: string;
  fromContains?: string;
  subjectContains?: string;
  enabled?: boolean;
}) {
  const { account } = await requireAccount();
  return prisma.mailLabelRule.create({
    data: {
      accountId: account.id,
      name: input.name,
      label: input.label,
      enabled: input.enabled ?? true,
      matchJson: JSON.stringify({
        fromContains: input.fromContains,
        subjectContains: input.subjectContains,
      }),
    },
  });
}

export async function deleteLabelRuleAction(ruleId: string) {
  const { account } = await requireAccount();
  await prisma.mailLabelRule.deleteMany({
    where: { id: ruleId, accountId: account.id },
  });
  revalidateMail();
  return { ok: true as const };
}

export async function getMailBootstrap() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Session expired — please refresh the page and log in again.");
  }
  const configured = ceoMailConfigured();
  if (!configured) {
    return { configured: false as const };
  }
  const account = await ensureCeoMailAccount(session.user.id);
  if (!account) {
    return { configured: false as const };
  }
  const inbox = await resolveSystemFolder(account.id, "INBOX");
  const [foldersRaw, { rows: threads }, signatures, reminders] = await Promise.all([
    prisma.mailFolder.findMany({
      where: { accountId: account.id },
      orderBy: { path: "asc" },
      include: { _count: { select: { messages: true } } },
    }),
    queryThreadsForView({
      accountId: account.id,
      smartInbox: true,
      take: 150,
    }),
    prisma.mailSignature.findMany({
      where: { accountId: account.id },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    }),
    prisma.mailReminder.findMany({
      where: { accountId: account.id, dismissed: false },
      orderBy: { dueAt: "asc" },
      take: 20,
    }),
  ]);
  const folders = foldersRaw.map((f) => ({
    id: f.id,
    path: f.path,
    name: f.name,
    role: f.role,
    messageCount: f._count.messages,
  }));
  return {
    configured: true as const,
    account: {
      id: account.id,
      address: account.address,
      lastSyncedAt: account.lastSyncedAt,
    },
    folders,
    threads,
    inboxFolderId: inbox?.id ?? null,
    signatures,
    reminders,
  };
}
