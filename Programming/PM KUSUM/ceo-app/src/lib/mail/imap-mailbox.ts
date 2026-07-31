import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { getMailConfig } from "@/lib/mail/ceo-config";
import { buildRawMime } from "@/lib/mail/mime";

export type MailboxRole =
  | "INBOX"
  | "SENT"
  | "DRAFTS"
  | "TRASH"
  | "JUNK"
  | "ARCHIVE";

async function connectImap(accountId: string) {
  const account = await prisma.mailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Mail account not found");
  const cfg = await getMailConfig(account);
  if (!cfg) throw new Error("Mail account not configured");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  return { client, cfg };
}

const SPECIAL_USE: Record<MailboxRole, string[]> = {
  INBOX: ["\\inbox"],
  SENT: ["\\sent"],
  DRAFTS: ["\\drafts"],
  TRASH: ["\\trash"],
  JUNK: ["\\junk", "\\spam"],
  ARCHIVE: ["\\archive", "\\all"],
};

const NAME_CANDIDATES: Record<MailboxRole, string[]> = {
  INBOX: ["INBOX"],
  SENT: ["Sent", "Sent Messages", "Sent Items", "INBOX.Sent", "INBOX/Sent"],
  DRAFTS: ["Drafts", "Draft", "INBOX.Drafts", "INBOX/Drafts"],
  TRASH: ["Trash", "Deleted", "Deleted Items", "INBOX.Trash", "INBOX/Trash"],
  JUNK: ["Junk", "Spam", "Junk E-mail", "INBOX.Junk", "INBOX/Spam"],
  ARCHIVE: ["Archive", "INBOX.Archive", "INBOX/Archive"],
};

export async function resolveMailboxPath(
  client: ImapFlow,
  accountId: string,
  role: MailboxRole,
): Promise<string> {
  const list = await client.list();
  const wanted = SPECIAL_USE[role];
  const special = list.find((m) =>
    wanted.includes((m.specialUse || "").toLowerCase()),
  );
  if (special) return special.path;

  const byRole = await prisma.mailFolder.findFirst({
    where: { accountId, role },
    orderBy: { path: "asc" },
  });
  if (byRole) return byRole.path;

  for (const c of NAME_CANDIDATES[role]) {
    const hit = list.find((m) => m.path === c || m.name === c);
    if (hit) return hit.path;
  }

  if (role === "INBOX") return "INBOX";

  const createName = NAME_CANDIDATES[role][0]!;
  try {
    await client.mailboxCreate(createName);
  } catch {
    /* may already exist */
  }
  return createName;
}

export async function appendSentMessage(input: {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  referencesHdr?: string | null;
  messageId?: string | null;
}) {
  const { client, cfg } = await connectImap(input.accountId);
  try {
    const sentPath = await resolveMailboxPath(client, input.accountId, "SENT");
    const raw = buildRawMime({
      from: cfg.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      inReplyTo: input.inReplyTo,
      referencesHdr: input.referencesHdr,
      messageId: input.messageId,
    });
    await client.append(sentPath, raw, ["\\Seen"]);
    await prisma.mailFolder.upsert({
      where: {
        accountId_path: { accountId: input.accountId, path: sentPath },
      },
      create: {
        accountId: input.accountId,
        path: sentPath,
        name: sentPath.split(/[/.]/).pop() || "Sent",
        role: "SENT",
      },
      update: { role: "SENT" },
    });
    return { path: sentPath };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Mark Inbox messages Seen on IMAP (best-effort). */
export async function markInboxMessagesSeen(input: {
  accountId: string;
  threadId: string;
}) {
  const msgs = await prisma.mailMessage.findMany({
    where: {
      accountId: input.accountId,
      threadId: input.threadId,
      folder: { role: "INBOX" },
      seen: true,
    },
    include: { folder: true },
  });
  if (!msgs.length) return;

  const { client } = await connectImap(input.accountId);
  try {
    const byFolder = new Map<string, number[]>();
    for (const m of msgs) {
      const list = byFolder.get(m.folder.path) || [];
      list.push(m.imapUid);
      byFolder.set(m.folder.path, list);
    }
    for (const [path, uids] of byFolder) {
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/**
 * Move every IMAP message across one or more threads into a target mailbox
 * path (server-side) over a SINGLE IMAP connection, then repoint the local
 * rows at the new folder/UID in place so the target view (e.g. Trash) is
 * correct immediately — no dependency on a later background resync.
 *
 * Dovecot supports UIDPLUS, so `messageMove` reliably returns a uidMap of
 * old-UID -> new-UID; that's the normal path. If a server ever lacks
 * UIDPLUS (no uidMap in the response), we fall back to the old
 * delete-and-let-the-next-sync-reimport behavior for just that batch,
 * rather than silently mis-recording a UID we don't actually have.
 *
 * Shared by trash/archive/move-to-folder, single or bulk.
 */
async function moveThreadsMessagesToPath(input: {
  accountId: string;
  threadIds: string[];
  targetPath: string;
  targetRole: string;
}) {
  if (!input.threadIds.length) {
    return { ok: true as const, targetPath: input.targetPath, moved: 0 };
  }
  const msgs = await prisma.mailMessage.findMany({
    where: { accountId: input.accountId, threadId: { in: input.threadIds } },
    include: { folder: true },
  });
  if (!msgs.length) throw new Error("No messages to move");

  const { client } = await connectImap(input.accountId);
  try {
    const targetFolder = await prisma.mailFolder.upsert({
      where: {
        accountId_path: { accountId: input.accountId, path: input.targetPath },
      },
      create: {
        accountId: input.accountId,
        path: input.targetPath,
        name: input.targetPath.split(/[/.]/).pop() || input.targetPath,
        role: input.targetRole,
      },
      update: { role: input.targetRole },
    });

    const byFolder = new Map<string, typeof msgs>();
    for (const m of msgs) {
      if (m.folder.path === input.targetPath) continue;
      const list = byFolder.get(m.folder.path) || [];
      list.push(m);
      byFolder.set(m.folder.path, list);
    }

    const staleIds: string[] = [];
    for (const [path, folderMsgs] of byFolder) {
      if (!folderMsgs.length) continue;
      const uids = folderMsgs.map((m) => m.imapUid);
      const lock = await client.getMailboxLock(path);
      let result: Awaited<ReturnType<typeof client.messageMove>>;
      try {
        result = await client.messageMove(uids.join(","), input.targetPath, {
          uid: true,
        });
      } finally {
        lock.release();
      }

      const uidMap = result ? result.uidMap : undefined;
      for (const m of folderMsgs) {
        const newUid = uidMap?.get(m.imapUid);
        if (newUid == null) {
          // No UIDPLUS mapping for this message — can't safely repoint it
          // in place. Drop it locally; the next full sync re-imports it
          // into the target mailbox.
          staleIds.push(m.id);
          continue;
        }
        await prisma.mailMessage.update({
          where: { id: m.id },
          data: { folderId: targetFolder.id, imapUid: newUid },
        });
      }
    }

    if (staleIds.length) {
      await prisma.mailMessage.deleteMany({ where: { id: { in: staleIds } } });
    }

    if (input.targetRole === "TRASH") {
      await prisma.mailThread.updateMany({
        where: { id: { in: input.threadIds } },
        data: { trashedAt: new Date() },
      });
    }

    const { recomputeThreadDenorm } = await import("@/lib/mail/threads-query");
    for (const threadId of input.threadIds) {
      await recomputeThreadDenorm(threadId).catch(() => undefined);
    }

    return { ok: true as const, targetPath: input.targetPath, moved: msgs.length };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Move all IMAP messages in one or more threads into Trash (server-side). */
export async function trashMailThreads(input: {
  accountId: string;
  threadIds: string[];
}) {
  const { client } = await connectImap(input.accountId);
  const trashPath = await resolveMailboxPath(client, input.accountId, "TRASH");
  await client.logout().catch(() => undefined);
  const result = await moveThreadsMessagesToPath({
    ...input,
    targetPath: trashPath,
    targetRole: "TRASH",
  });
  return { ok: result.ok, trashPath: result.targetPath };
}

/** Move all IMAP messages in one or more threads into Archive (server-side). */
export async function archiveMailThreads(input: {
  accountId: string;
  threadIds: string[];
}) {
  const { client } = await connectImap(input.accountId);
  const archivePath = await resolveMailboxPath(
    client,
    input.accountId,
    "ARCHIVE",
  );
  await client.logout().catch(() => undefined);
  const result = await moveThreadsMessagesToPath({
    ...input,
    targetPath: archivePath,
    targetRole: "ARCHIVE",
  });
  return { ok: result.ok, archivePath: result.targetPath };
}

/** Move all IMAP messages in one or more threads into an arbitrary existing folder (label or system mailbox). */
export async function moveMailThreadsToFolder(input: {
  accountId: string;
  threadIds: string[];
  folderId: string;
}) {
  const folder = await prisma.mailFolder.findFirst({
    where: { id: input.folderId, accountId: input.accountId },
  });
  if (!folder) throw new Error("Target folder not found");
  const result = await moveThreadsMessagesToPath({
    accountId: input.accountId,
    threadIds: input.threadIds,
    targetPath: folder.path,
    targetRole: folder.role,
  });
  return { ok: result.ok, path: result.targetPath };
}

/** Move all IMAP messages in a single thread into Trash (server-side). */
export async function trashMailThread(input: {
  accountId: string;
  threadId: string;
}) {
  return trashMailThreads({
    accountId: input.accountId,
    threadIds: [input.threadId],
  });
}

/** Move all IMAP messages in a single thread into Archive (server-side). */
export async function archiveMailThread(input: {
  accountId: string;
  threadId: string;
}) {
  return archiveMailThreads({
    accountId: input.accountId,
    threadIds: [input.threadId],
  });
}

/** Move all IMAP messages in a single thread into an arbitrary existing folder. */
export async function moveMailThreadToFolder(input: {
  accountId: string;
  threadId: string;
  folderId: string;
}) {
  const result = await moveMailThreadsToFolder({
    accountId: input.accountId,
    threadIds: [input.threadId],
    folderId: input.folderId,
  });
  return { ok: result.ok, path: result.path };
}

/** Move all IMAP messages in one or more threads into Junk/Spam (server-side). */
export async function markMailThreadsAsSpam(input: {
  accountId: string;
  threadIds: string[];
}) {
  const { client } = await connectImap(input.accountId);
  const junkPath = await resolveMailboxPath(client, input.accountId, "JUNK");
  await client.logout().catch(() => undefined);
  const result = await moveThreadsMessagesToPath({
    ...input,
    targetPath: junkPath,
    targetRole: "JUNK",
  });
  return { ok: result.ok, junkPath: result.targetPath };
}

/** Move all IMAP messages in a single thread into Junk/Spam. */
export async function markMailThreadAsSpam(input: {
  accountId: string;
  threadId: string;
}) {
  return markMailThreadsAsSpam({
    accountId: input.accountId,
    threadIds: [input.threadId],
  });
}

/** Move one or more threads out of Junk/Spam back into the Inbox ("Not spam"). */
export async function markMailThreadsNotSpam(input: {
  accountId: string;
  threadIds: string[];
}) {
  const { client } = await connectImap(input.accountId);
  const inboxPath = await resolveMailboxPath(client, input.accountId, "INBOX");
  await client.logout().catch(() => undefined);
  const result = await moveThreadsMessagesToPath({
    ...input,
    targetPath: inboxPath,
    targetRole: "INBOX",
  });
  return { ok: result.ok, path: result.targetPath };
}

/** Move a single thread out of Junk/Spam back into the Inbox ("Not spam"). */
export async function markMailThreadNotSpam(input: {
  accountId: string;
  threadId: string;
}) {
  return markMailThreadsNotSpam({
    accountId: input.accountId,
    threadIds: [input.threadId],
  });
}
