import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";
import { htmlToText } from "@/lib/mail/normalize";
import { buildRawMime } from "@/lib/mail/mime";
import { randomUUID } from "crypto";

function parseImapDraftRef(raw: string | null | undefined): {
  path: string;
  uid: number;
} | null {
  if (!raw?.startsWith("imap:")) return null;
  const rest = raw.slice("imap:".length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0) return null;
  const path = rest.slice(0, idx);
  const uid = Number(rest.slice(idx + 1));
  if (!path || !Number.isFinite(uid)) return null;
  return { path, uid };
}

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

async function resolveDraftsPath(
  client: ImapFlow,
  accountId: string,
): Promise<string> {
  const list = await client.list();
  const special = list.find(
    (m) => (m.specialUse || "").toLowerCase() === "\\drafts",
  );
  if (special) return special.path;

  const byRole = await prisma.mailFolder.findFirst({
    where: { accountId, role: "DRAFTS" },
    orderBy: { path: "asc" },
  });
  if (byRole) return byRole.path;

  const candidates = ["Drafts", "INBOX.Drafts", "INBOX/Drafts", "Draft"];
  for (const c of candidates) {
    const hit = list.find((m) => m.path === c || m.name === c);
    if (hit) return hit.path;
  }

  try {
    await client.mailboxCreate("Drafts");
  } catch {
    /* may already exist */
  }
  return "Drafts";
}

export async function saveMailDraft(input: {
  accountId: string;
  draftId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  referencesHdr?: string | null;
}) {
  const { client, cfg } = await connectImap();
  const to = input.to;
  const cc = input.cc || [];
  const bcc = input.bcc || [];

  try {
    const draftsPath = await resolveDraftsPath(client, input.accountId);
    const raw = buildRawMime({
      from: cfg.from,
      to,
      cc,
      bcc,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      inReplyTo: input.inReplyTo,
      referencesHdr: input.referencesHdr,
    });

    let existing = input.draftId
      ? await prisma.mailOutbox.findFirst({
          where: {
            id: input.draftId,
            accountId: input.accountId,
            status: "DRAFT",
          },
        })
      : null;

    const prevRef = parseImapDraftRef(existing?.smtpMessageId);
    if (prevRef) {
      try {
        const lock = await client.getMailboxLock(prevRef.path);
        try {
          await client.messageDelete(String(prevRef.uid), { uid: true });
        } finally {
          lock.release();
        }
      } catch {
        /* old draft may already be gone */
      }
    }

    const appended = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
    if (!appended) {
      throw new Error("IMAP rejected draft APPEND");
    }
    const uid = appended.uid != null ? Number(appended.uid) : null;
    const imapRef =
      uid != null && Number.isFinite(uid) ? `imap:${draftsPath}:${uid}` : null;

    if (existing) {
      existing = await prisma.mailOutbox.update({
        where: { id: existing.id },
        data: {
          toAddresses: JSON.stringify(to),
          ccAddresses: JSON.stringify(cc),
          bccAddresses: JSON.stringify(bcc),
          subject: input.subject || "(no subject)",
          bodyHtml: input.bodyHtml,
          bodyText: htmlToText(input.bodyHtml),
          inReplyTo: input.inReplyTo || null,
          referencesHdr: input.referencesHdr || null,
          status: "DRAFT",
          smtpMessageId: imapRef,
          error: null,
        },
      });
    } else {
      existing = await prisma.mailOutbox.create({
        data: {
          accountId: input.accountId,
          toAddresses: JSON.stringify(to),
          ccAddresses: JSON.stringify(cc),
          bccAddresses: JSON.stringify(bcc),
          subject: input.subject || "(no subject)",
          bodyHtml: input.bodyHtml,
          bodyText: htmlToText(input.bodyHtml),
          inReplyTo: input.inReplyTo || null,
          referencesHdr: input.referencesHdr || null,
          status: "DRAFT",
          smtpMessageId: imapRef,
          idempotencyKey: `draft-${randomUUID()}`,
        },
      });
    }

    await prisma.mailFolder.upsert({
      where: {
        accountId_path: { accountId: input.accountId, path: draftsPath },
      },
      create: {
        accountId: input.accountId,
        path: draftsPath,
        name: draftsPath.split(/[/.]/).pop() || "Drafts",
        role: "DRAFTS",
      },
      update: { role: "DRAFTS" },
    });

    return existing;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function listLocalDrafts(accountId: string) {
  return prisma.mailOutbox.findMany({
    where: { accountId, status: "DRAFT" },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}

export async function getLocalDraft(accountId: string, draftId: string) {
  return prisma.mailOutbox.findFirst({
    where: { id: draftId, accountId, status: "DRAFT" },
  });
}

export async function deleteLocalDraft(accountId: string, draftId: string) {
  const row = await prisma.mailOutbox.findFirst({
    where: { id: draftId, accountId, status: "DRAFT" },
  });
  if (!row) return { ok: false as const };

  const ref = parseImapDraftRef(row.smtpMessageId);
  if (ref) {
    try {
      const { client } = await connectImap();
      try {
        const lock = await client.getMailboxLock(ref.path);
        try {
          await client.messageDelete(String(ref.uid), { uid: true });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch {
      /* best-effort */
    }
  }

  await prisma.mailOutbox.delete({ where: { id: draftId } });
  return { ok: true as const };
}
