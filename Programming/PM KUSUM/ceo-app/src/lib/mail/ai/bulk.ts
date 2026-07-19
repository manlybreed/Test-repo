import { prisma } from "@/lib/prisma";
import { assertAutonomy } from "@/lib/mail/ai/policy";

/** AI-18: suggest newsletter/FYI clusters for archive. */
export async function suggestBulkCleanup(accountId: string) {
  const threads = await prisma.mailThread.findMany({
    where: {
      accountId,
      OR: [
        { labelsJson: { contains: "NEWSLETTER" } },
        { labelsJson: { contains: "FYI" } },
        { priority: "P4" },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });
  return threads.map((t) => ({
    threadId: t.id,
    subject: t.subject,
    priority: t.priority,
    labels: JSON.parse(t.labelsJson || "[]") as string[],
  }));
}

export async function getUnsubscribeCandidate(messageId: string) {
  const msg = await prisma.mailMessage.findUnique({ where: { id: messageId } });
  if (!msg?.listUnsubscribe) return null;
  return {
    messageId: msg.id,
    listUnsubscribe: msg.listUnsubscribe,
  };
}

export async function confirmUnsubscribeAction(opts: {
  messageId: string;
  confirmed: boolean;
}) {
  assertAutonomy("unsubscribe", { confirmed: opts.confirmed });
  const cand = await getUnsubscribeCandidate(opts.messageId);
  if (!cand) throw new Error("No List-Unsubscribe header on message");
  // Return mailto/http target for UI to open — do not silently HTTP GET.
  return cand;
}
