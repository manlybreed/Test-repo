import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";
import { buildRawMime } from "@/lib/mail/mime";

export type MailboxRole =
  | "INBOX"
  | "SENT"
  | "DRAFTS"
  | "TRASH"
  | "JUNK"
  | "ARCHIVE";

async function connectImap() {
  const cfg = getCeoMailConfig();
  if (!cfg) throw new Error("CEO mail not configured");
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
  const { client, cfg } = await connectImap();
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

  const { client } = await connectImap();
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
 * Move every IMAP message in a thread into a target mailbox path (server-side),
 * dropping the local rows so the source view clears immediately — next sync
 * re-imports into the target mailbox. Shared by trash/archive/move-to-folder.
 */
async function moveThreadMessagesToPath(input: {
  accountId: string;
  threadId: string;
  targetPath: string;
  targetRole: string;
}) {
  const msgs = await prisma.mailMessage.findMany({
    where: { accountId: input.accountId, threadId: input.threadId },
    include: { folder: true },
  });
  if (!msgs.length) throw new Error("No messages to move");

  const { client } = await connectImap();
  try {
    await prisma.mailFolder.upsert({
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

    const byFolder = new Map<string, number[]>();
    for (const m of msgs) {
      if (m.folder.path === input.targetPath) continue;
      const list = byFolder.get(m.folder.path) || [];
      list.push(m.imapUid);
      byFolder.set(m.folder.path, list);
    }

    for (const [path, uids] of byFolder) {
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageMove(uids.join(","), input.targetPath, {
          uid: true,
        });
      } finally {
        lock.release();
      }
    }

    await prisma.mailMessage.deleteMany({
      where: { threadId: input.threadId, accountId: input.accountId },
    });
    await prisma.mailThread.delete({ where: { id: input.threadId } }).catch(
      () => undefined,
    );

    return { ok: true as const, targetPath: input.targetPath };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Move all IMAP messages in a thread into Trash (server-side). */
export async function trashMailThread(input: {
  accountId: string;
  threadId: string;
}) {
  const { client } = await connectImap();
  const trashPath = await resolveMailboxPath(client, input.accountId, "TRASH");
  await client.logout().catch(() => undefined);
  const result = await moveThreadMessagesToPath({
    ...input,
    targetPath: trashPath,
    targetRole: "TRASH",
  });
  return { ok: result.ok, trashPath: result.targetPath };
}

/** Move all IMAP messages in a thread into Archive (server-side). */
export async function archiveMailThread(input: {
  accountId: string;
  threadId: string;
}) {
  const { client } = await connectImap();
  const archivePath = await resolveMailboxPath(
    client,
    input.accountId,
    "ARCHIVE",
  );
  await client.logout().catch(() => undefined);
  const result = await moveThreadMessagesToPath({
    ...input,
    targetPath: archivePath,
    targetRole: "ARCHIVE",
  });
  return { ok: result.ok, archivePath: result.targetPath };
}

/** Move all IMAP messages in a thread into an arbitrary existing folder (label or system mailbox). */
export async function moveMailThreadToFolder(input: {
  accountId: string;
  threadId: string;
  folderId: string;
}) {
  const folder = await prisma.mailFolder.findFirst({
    where: { id: input.folderId, accountId: input.accountId },
  });
  if (!folder) throw new Error("Target folder not found");
  const result = await moveThreadMessagesToPath({
    accountId: input.accountId,
    threadId: input.threadId,
    targetPath: folder.path,
    targetRole: folder.role,
  });
  return { ok: result.ok, path: result.targetPath };
}
