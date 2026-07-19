import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";
import { htmlToText } from "@/lib/mail/normalize";
import { assertAutonomy } from "@/lib/mail/ai/policy";
import { appendSentMessage } from "@/lib/mail/imap-mailbox";

export async function flushOutboxItem(
  outboxId: string,
  opts?: { confirmed?: boolean },
) {
  assertAutonomy("send", { confirmed: opts?.confirmed ?? true });

  const row = await prisma.mailOutbox.findUnique({ where: { id: outboxId } });
  if (!row) throw new Error("Outbox item not found");
  if (row.status === "SENT") return row;
  if (row.status === "CANCELLED") throw new Error("Outbox item cancelled");
  if (row.status === "SCHEDULED" && row.sendAt && row.sendAt > new Date()) {
    throw new Error("Scheduled send not due yet");
  }

  const cfg = getCeoMailConfig();
  if (!cfg) throw new Error("CEO mail not configured (CEO_MAIL_USER / CEO_MAIL_PASS)");

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const to = JSON.parse(row.toAddresses) as string[];
  const cc = JSON.parse(row.ccAddresses || "[]") as string[];
  const bcc = JSON.parse(row.bccAddresses || "[]") as string[];
  const text = row.bodyText || htmlToText(row.bodyHtml);

  try {
    const info = await transport.sendMail({
      from: cfg.from,
      to: to.join(", "),
      cc: cc.length ? cc.join(", ") : undefined,
      bcc: bcc.length ? bcc.join(", ") : undefined,
      subject: row.subject,
      html: row.bodyHtml,
      text,
      inReplyTo: row.inReplyTo || undefined,
      references: row.referencesHdr || undefined,
    });

    // Keep Sent mailbox in sync even if SMTP server doesn't auto-copy
    await appendSentMessage({
      accountId: row.accountId,
      to,
      cc,
      bcc,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      inReplyTo: row.inReplyTo,
      referencesHdr: row.referencesHdr,
      messageId: info.messageId || null,
    }).catch(() => undefined);

    return prisma.mailOutbox.update({
      where: { id: outboxId },
      data: {
        status: "SENT",
        smtpMessageId: info.messageId || null,
        error: null,
        sendAt: new Date(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return prisma.mailOutbox.update({
      where: { id: outboxId },
      data: { status: "FAILED", error: msg },
    });
  }
}

/** Flush due SCHEDULED items (idempotent). */
export async function flushDueScheduled(limit = 20) {
  const due = await prisma.mailOutbox.findMany({
    where: {
      status: "SCHEDULED",
      sendAt: { lte: new Date() },
    },
    take: limit,
    orderBy: { sendAt: "asc" },
  });
  const results = [];
  for (const row of due) {
    results.push(await flushOutboxItem(row.id, { confirmed: true }));
  }
  return results;
}

export async function cancelScheduled(outboxId: string) {
  const row = await prisma.mailOutbox.findUnique({ where: { id: outboxId } });
  if (!row) throw new Error("Not found");
  if (row.status !== "SCHEDULED" && row.status !== "QUEUED") {
    throw new Error("Cannot cancel this status");
  }
  return prisma.mailOutbox.update({
    where: { id: outboxId },
    data: { status: "CANCELLED" },
  });
}
