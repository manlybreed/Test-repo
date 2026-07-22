import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";
import { ensureCeoMailAccount } from "@/lib/mail/account";
import {
  htmlToText,
  normalizeSubject,
  parseAddressList,
  snippetFromBody,
  threadKey,
} from "@/lib/mail/normalize";
import { applyStandingLabelRules } from "@/lib/mail/ai/label-rules";
import {
  repairSmartLabels,
  triageNewThreads,
} from "@/lib/mail/ai/triage";
import {
  FLAG_LABELS,
  recomputeThreadDenorm,
  reconcileThreadFlagLabels,
} from "@/lib/mail/threads-query";
import { publishMailLive } from "@/lib/mail/live-bus";
import path from "path";
import fs from "fs/promises";

function roleFromSpecialUse(specialUse?: string | null): string | null {
  const u = (specialUse || "").toLowerCase();
  if (!u) return null;
  if (u.includes("inbox")) return "INBOX";
  if (u.includes("sent")) return "SENT";
  if (u.includes("draft")) return "DRAFTS";
  if (u.includes("trash") || u.includes("deleted")) return "TRASH";
  if (u.includes("junk") || u.includes("spam")) return "JUNK";
  if (u.includes("archive") || u.includes("all")) return "ARCHIVE";
  return null;
}

function roleForPath(p: string): string {
  const base = (p.split(/[/.]/).pop() || p).toLowerCase();
  if (base === "inbox") return "INBOX";
  if (base === "sent" || base === "sent items" || base === "sent messages")
    return "SENT";
  if (base === "drafts" || base === "draft") return "DRAFTS";
  if (base === "trash" || base === "deleted" || base === "deleted items")
    return "TRASH";
  if (base === "junk" || base === "spam" || base === "junk e-mail") return "JUNK";
  if (base === "archive") return "ARCHIVE";
  // Avoid substring false positives like "resent" / "undrafted"
  if (base.includes("sent") && !base.includes("resent")) return "SENT";
  if (base.includes("draft")) return "DRAFTS";
  if (base.includes("trash") || base.includes("deleted")) return "TRASH";
  if (base.includes("junk") || base.includes("spam")) return "JUNK";
  if (base.includes("archive")) return "ARCHIVE";
  return "OTHER";
}

/** Custom keywords / folder-as-label only — never IMAP flags on shared threads. */
function labelsFromImapFlags(
  flags: Set<string> | Iterable<string> | undefined,
  folderName: string,
  role: string,
): string[] {
  const labels: string[] = [];
  const set = flags instanceof Set ? flags : new Set(flags || []);
  for (const f of set) {
    if (typeof f !== "string") continue;
    if (f.startsWith("\\") || f.startsWith("$")) continue;
    const clean = f.trim();
    if (!clean || FLAG_LABELS.has(clean)) continue;
    labels.push(clean);
  }
  if (role === "OTHER") {
    const name = (folderName.split(/[/.]/).pop() || folderName).trim();
    if (name && !FLAG_LABELS.has(name)) labels.push(name);
  }
  return labels;
}

async function mergeThreadLabels(threadId: string, add: string[]) {
  const cleaned = add
    .map((l) => l.trim())
    .filter((l) => l && !FLAG_LABELS.has(l));
  if (!cleaned.length) return;
  const thread = await prisma.mailThread.findUnique({ where: { id: threadId } });
  if (!thread) return;
  let existing: string[] = [];
  try {
    existing = JSON.parse(thread.labelsJson || "[]") as string[];
  } catch {
    existing = [];
  }
  existing = existing.filter((l) => !FLAG_LABELS.has(l));
  const next = Array.from(new Set([...existing, ...cleaned]));
  if (next.length === existing.length && next.every((l, i) => l === existing[i])) {
    return;
  }
  await prisma.mailThread.update({
    where: { id: threadId },
    data: { labelsJson: JSON.stringify(next) },
  });
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
  return client;
}

/** Only primary mailboxes bump shared thread timeline / unread. */
function roleBumpsThread(role: string) {
  return role === "INBOX" || role === "SENT";
}

export async function syncCeoMail(opts?: {
  userId?: string | null;
  maxPerFolder?: number;
  /** Cap AI triage for newly imported threads (0 = skip). Default 8. */
  maxTriageNew?: number;
  /** Limit to these folder roles (e.g. IDLE delta for INBOX/SENT). */
  roles?: string[];
  /**
   * Only fetch UIDs newer than lastUid; skip full-window flag refresh / tombstones.
   * Used by IMAP IDLE near-real-time pulls.
   */
  incremental?: boolean;
}) {
  const account = await ensureCeoMailAccount(opts?.userId);
  if (!account) throw new Error("CEO mail not configured");

  const max = opts?.maxPerFolder ?? 60;
  const maxTriageNew = opts?.maxTriageNew ?? 8;
  const incremental = Boolean(opts?.incremental);
  const roleFilter = opts?.roles?.length
    ? new Set(opts.roles.map((r) => r.toUpperCase()))
    : null;

  if (!incremental) {
    // One-shot cleanup of flag chips that used to pollute Inbox/Sent lists
    await reconcileThreadFlagLabels(account.id).catch(() => 0);
    // Fix absurd smart labels (e.g. test mail → RECEIPT) without calling Claude
    await repairSmartLabels({ accountId: account.id, limit: 80 }).catch(
      () => undefined,
    );
  }

  const client = await connectImap();
  let imported = 0;
  const newInboxThreadIds: string[] = [];
  const touchedThreads = new Set<string>();

  try {
    const list = await client.list();
    for (const box of list) {
      const pathName = box.path;
      if (box.flags?.has("\\Noselect") || box.flags?.has("\\NonExistent")) {
        continue;
      }
      const role =
        roleFromSpecialUse(box.specialUse) || roleForPath(pathName);

      if (roleFilter && !roleFilter.has(role)) continue;

      const folder = await prisma.mailFolder.upsert({
        where: {
          accountId_path: { accountId: account.id, path: pathName },
        },
        create: {
          accountId: account.id,
          path: pathName,
          name: box.name || pathName,
          role,
        },
        update: { name: box.name || pathName, role },
      });

      let lock;
      try {
        lock = await client.getMailboxLock(pathName);
      } catch {
        continue;
      }

      try {
        const syncState = await prisma.mailSyncState.upsert({
          where: { folderId: folder.id },
          create: { accountId: account.id, folderId: folder.id, lastUid: 0 },
          update: {},
        });

        const exists = await client.search({ all: true }, { uid: true });
        const uids = (exists === false ? [] : exists) as number[];
        const sorted = [...uids].sort((a, b) => a - b);

        let windowUids: number[];
        let newUids: number[];
        let refreshUids: number[] = [];

        if (incremental) {
          // Only messages the server has assigned after our watermark
          newUids = sorted.filter((u) => u > syncState.lastUid);
          if (newUids.length > max) {
            newUids = newUids.slice(-max);
          }
          windowUids = newUids;
        } else {
          const folderMax =
            role === "INBOX"
              ? Math.max(max, 300)
              : role === "SENT"
                ? Math.max(max, 150)
                : max;
          windowUids = sorted.slice(-folderMax);

          const already = windowUids.length
            ? await prisma.mailMessage.findMany({
                where: { folderId: folder.id, imapUid: { in: windowUids } },
                select: { imapUid: true },
              })
            : [];
          const haveUid = new Set(already.map((m) => m.imapUid));
          newUids = windowUids.filter((u) => !haveUid.has(u));
          refreshUids = windowUids.filter((u) => haveUid.has(u));

          // Tombstone: local UIDs in this window that vanished from IMAP (moved/deleted)
          if (windowUids.length) {
            const minWindow = windowUids[0]!;
            const stale = await prisma.mailMessage.findMany({
              where: {
                folderId: folder.id,
                imapUid: { gte: minWindow, notIn: windowUids },
              },
              select: { id: true, threadId: true },
            });
            if (stale.length) {
              await prisma.mailMessage.deleteMany({
                where: { id: { in: stale.map((s) => s.id) } },
              });
              for (const s of stale) touchedThreads.add(s.threadId);
            }
          }
        }

        let lastUid = syncState.lastUid;

        if (refreshUids.length) {
          for await (const msg of client.fetch(
            refreshUids,
            { uid: true, flags: true },
            { uid: true },
          )) {
            const existingMsg = await prisma.mailMessage.findUnique({
              where: {
                folderId_imapUid: { folderId: folder.id, imapUid: msg.uid },
              },
            });
            if (!existingMsg) continue;
            const seen = msg.flags?.has("\\Seen") ?? existingMsg.seen;
            const flagged = msg.flags?.has("\\Flagged") ?? existingMsg.flagged;
            const answered =
              msg.flags?.has("\\Answered") ?? existingMsg.answered;
            await prisma.mailMessage.update({
              where: { id: existingMsg.id },
              data: { seen, flagged, answered },
            });
            await mergeThreadLabels(
              existingMsg.threadId,
              labelsFromImapFlags(msg.flags, folder.name, role),
            );
            touchedThreads.add(existingMsg.threadId);
            lastUid = Math.max(lastUid, msg.uid);
          }
        }

        if (newUids.length) {
          for await (const msg of client.fetch(
            newUids,
            { uid: true, source: true, flags: true, envelope: true },
            { uid: true },
          )) {
            const uid = msg.uid;
            const existingMsg = await prisma.mailMessage.findUnique({
              where: {
                folderId_imapUid: { folderId: folder.id, imapUid: uid },
              },
            });
            if (existingMsg) {
              lastUid = Math.max(lastUid, uid);
              continue;
            }

            const raw = msg.source;
            if (!raw) {
              lastUid = Math.max(lastUid, uid);
              continue;
            }

            const parsed = await simpleParser(raw);
            const fromAddr =
              parsed.from?.value?.[0]?.address ||
              msg.envelope?.from?.[0]?.address ||
              "unknown@unknown";
            const fromName =
              parsed.from?.value?.[0]?.name ||
              msg.envelope?.from?.[0]?.name ||
              null;
            const toList = parseAddressList(
              Array.isArray(parsed.to)
                ? parsed.to.flatMap((t) => t.value)
                : parsed.to?.value || parsed.to,
            );
            const ccList = parseAddressList(
              Array.isArray(parsed.cc)
                ? parsed.cc.flatMap((t) => t.value)
                : parsed.cc?.value || parsed.cc,
            );
            const subject =
              parsed.subject || msg.envelope?.subject || "(no subject)";
            const date = parsed.date || msg.envelope?.date || new Date();
            const rfcId = parsed.messageId || null;
            const inReplyTo = Array.isArray(parsed.inReplyTo)
              ? parsed.inReplyTo[0]
              : parsed.inReplyTo || null;
            const references = Array.isArray(parsed.references)
              ? parsed.references.join(" ")
              : typeof parsed.references === "string"
                ? parsed.references
                : null;

            const bodyHtml =
              typeof parsed.html === "string" ? parsed.html : null;
            const bodyText =
              parsed.text || (bodyHtml ? htmlToText(bodyHtml) : null);
            const tKey = threadKey({
              references,
              inReplyTo,
              rfcMessageId: rfcId,
              subject,
            });

            // Prefer Message-ID / References threading; subject match is last resort
            let thread = await prisma.mailThread.findFirst({
              where: {
                accountId: account.id,
                messages: {
                  some: {
                    OR: [
                      ...(rfcId ? [{ rfcMessageId: rfcId }] : []),
                      ...(inReplyTo ? [{ rfcMessageId: inReplyTo }] : []),
                      ...(rfcId ? [{ inReplyTo: rfcId }] : []),
                      ...(tKey && tKey !== rfcId
                        ? [{ rfcMessageId: tKey }]
                        : []),
                    ],
                  },
                },
              },
            });

            if (!thread && !rfcId && !inReplyTo && !references) {
              thread = await prisma.mailThread.findFirst({
                where: {
                  accountId: account.id,
                  subject: normalizeSubject(subject),
                  participantsJson: { contains: fromAddr.toLowerCase() },
                },
              });
            }

            if (!thread) {
              thread = await prisma.mailThread.create({
                data: {
                  accountId: account.id,
                  subject: normalizeSubject(subject),
                  snippet: snippetFromBody(bodyText),
                  participantsJson: JSON.stringify(
                    Array.from(
                      new Set([
                        fromAddr.toLowerCase(),
                        ...toList.map((t) => t.toLowerCase()),
                      ]),
                    ).slice(0, 20),
                  ),
                  lastMessageAt: date,
                  unreadCount: 0,
                },
              });
            }

            const storageRoot = process.env.STORAGE_ROOT || "./storage";
            const rawDir = path.join(
              storageRoot,
              "mail",
              account.id,
              folder.id,
            );
            await fs.mkdir(rawDir, { recursive: true });
            const rawPath = path.join(rawDir, `${uid}.eml`);
            await fs.writeFile(rawPath, raw);

            const seen = msg.flags?.has("\\Seen") ?? false;
            const flagged = msg.flags?.has("\\Flagged") ?? false;
            const answered = msg.flags?.has("\\Answered") ?? false;
            const listUnsub =
              (parsed.headers?.get("list-unsubscribe") as string) || null;
            const imapLabels = labelsFromImapFlags(
              msg.flags,
              folder.name,
              role,
            );

            const created = await prisma.mailMessage.create({
              data: {
                accountId: account.id,
                folderId: folder.id,
                threadId: thread.id,
                rfcMessageId: rfcId,
                imapUid: uid,
                inReplyTo: inReplyTo || null,
                referencesHdr: references,
                fromAddress: fromAddr.toLowerCase(),
                fromName,
                toAddresses: JSON.stringify(toList),
                ccAddresses: JSON.stringify(ccList),
                subject,
                date,
                seen,
                flagged,
                answered,
                bodyText,
                bodyHtml,
                snippet: snippetFromBody(bodyText),
                hasAttachments: (parsed.attachments?.length || 0) > 0,
                listUnsubscribe: listUnsub,
                rawPath,
                searchText: [subject, bodyText, fromAddr, ...toList]
                  .filter(Boolean)
                  .join("\n"),
              },
            });

            if (parsed.attachments?.length) {
              for (const att of parsed.attachments) {
                const attDir = path.join(rawDir, "att", String(uid));
                await fs.mkdir(attDir, { recursive: true });
                const fname = att.filename || `attach-${Date.now()}`;
                const attPath = path.join(attDir, fname);
                await fs.writeFile(attPath, att.content);
                await prisma.mailAttachment.create({
                  data: {
                    messageId: created.id,
                    filename: fname,
                    contentType: att.contentType || null,
                    size: att.size || att.content?.length || 0,
                    storagePath: attPath,
                    extractStatus: "PENDING",
                  },
                });
              }
            }

            if (roleBumpsThread(role) && date >= thread.lastMessageAt) {
              await prisma.mailThread.update({
                where: { id: thread.id },
                data: {
                  lastMessageAt: date,
                  snippet: snippetFromBody(bodyText) || thread.snippet,
                },
              });
            }

            if (role === "INBOX" && !seen) {
              await prisma.mailThread.update({
                where: { id: thread.id },
                data: { unreadCount: { increment: 1 } },
              });
            }

            await mergeThreadLabels(thread.id, imapLabels);
            if (role === "INBOX") {
              await applyStandingLabelRules(account.id, thread.id, {
                from: fromAddr,
                subject,
              });
              newInboxThreadIds.push(thread.id);
            }

            touchedThreads.add(thread.id);
            imported += 1;
            lastUid = Math.max(lastUid, uid);
          }
        }

        await prisma.mailSyncState.update({
          where: { folderId: folder.id },
          data: { lastUid },
        });
      } finally {
        lock.release();
      }
    }

    await prisma.mailAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() },
    });
  } finally {
    await client.logout().catch(() => undefined);
  }

  for (const id of touchedThreads) {
    await recomputeThreadDenorm(id).catch(() => undefined);
  }

  let triaged = 0;
  if (maxTriageNew > 0 && newInboxThreadIds.length) {
    const t = await triageNewThreads(newInboxThreadIds, {
      max: maxTriageNew,
    }).catch(() => ({ attempted: 0, labeled: 0 }));
    triaged = t.labeled;
  }

  if (!incremental) {
    const { processPendingAttachments } = await import(
      "@/lib/mail/ai/attachments"
    );
    await processPendingAttachments(account.id, 12).catch(() => 0);
  }

  if (imported > 0 || !incremental) {
    publishMailLive({
      type: "mail:updated",
      accountId: account.id,
      imported,
    });
  }

  return { accountId: account.id, imported, triaged };
}

export async function verifyCeoImap(): Promise<boolean> {
  const client = await connectImap();
  await client.logout().catch(() => undefined);
  return true;
}
