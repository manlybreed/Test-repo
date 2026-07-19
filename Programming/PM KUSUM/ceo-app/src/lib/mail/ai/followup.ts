import { prisma } from "@/lib/prisma";

/** AI-11: SENT messages without a later reply in thread. */
export async function detectAwaitingReply(
  accountId: string,
  olderThanDays = 3,
) {
  const cutoff = new Date(Date.now() - olderThanDays * 864e5);
  const sentFolder = await prisma.mailFolder.findFirst({
    where: { accountId, role: "SENT" },
  });
  if (!sentFolder) return [];

  const sent = await prisma.mailMessage.findMany({
    where: {
      accountId,
      folderId: sentFolder.id,
      date: { lte: cutoff },
    },
    orderBy: { date: "desc" },
    take: 50,
  });

  const candidates = [];
  for (const msg of sent) {
    const later = await prisma.mailMessage.findFirst({
      where: {
        threadId: msg.threadId,
        date: { gt: msg.date },
        NOT: { folderId: sentFolder.id },
      },
    });
    if (!later) {
      candidates.push({
        messageId: msg.id,
        threadId: msg.threadId,
        subject: msg.subject,
        sentAt: msg.date,
      });
    }
  }
  return candidates;
}

export async function createFollowUpReminders(
  accountId: string,
  olderThanDays = 3,
) {
  const candidates = await detectAwaitingReply(accountId, olderThanDays);
  const created = [];
  for (const c of candidates) {
    const existing = await prisma.mailReminder.findFirst({
      where: {
        accountId,
        threadId: c.threadId,
        kind: "FOLLOW_UP",
        dismissed: false,
      },
    });
    if (existing) continue;
    created.push(
      await prisma.mailReminder.create({
        data: {
          accountId,
          threadId: c.threadId,
          kind: "FOLLOW_UP",
          dueAt: new Date(),
          tone: "NORMAL",
          note: `Awaiting reply: ${c.subject}`,
        },
      }),
    );
  }
  return created;
}
