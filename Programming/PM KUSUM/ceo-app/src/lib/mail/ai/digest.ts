import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";

const DigestSchema = z.object({
  groups: z.array(
    z.object({
      priority: z.string(),
      items: z.array(
        z.object({
          threadId: z.string(),
          subject: z.string(),
          blurb: z.string(),
        }),
      ),
    }),
  ),
});

export type InboxDigest = z.infer<typeof DigestSchema>;

/** AI-04 */
export async function buildInboxDigest(accountId: string): Promise<InboxDigest> {
  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId },
  });
  const since = account?.lastVisitAt || new Date(Date.now() - 7 * 864e5);

  const threads = await prisma.mailThread.findMany({
    where: {
      accountId,
      lastMessageAt: { gte: since },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    },
    orderBy: [{ priority: "asc" }, { lastMessageAt: "desc" }],
    take: 40,
  });

  if (!threads.length) {
    return { groups: [] };
  }

  if (!getAnthropic()) {
    const byPri = new Map<string, InboxDigest["groups"][0]["items"]>();
    for (const t of threads) {
      const p = t.priority || "NONE";
      if (!byPri.has(p)) byPri.set(p, []);
      byPri.get(p)!.push({
        threadId: t.id,
        subject: t.subject,
        blurb: t.snippet || "",
      });
    }
    return {
      groups: [...byPri.entries()].map(([priority, items]) => ({
        priority,
        items,
      })),
    };
  }

  const raw = await claudeJson<InboxDigest>({
    model: "sonnet",
    system: `Create an inbox digest grouped by priority. Return JSON {groups:[{priority, items:[{threadId, subject, blurb}]}]}. Only use provided threads; never invent threadIds.`,
    user: fenceMailData(
      threads.map((t) => ({
        threadId: t.id,
        subject: t.subject,
        priority: t.priority,
        snippet: t.snippet,
        labels: t.labelsJson,
      })),
    ),
  });

  const parsed = DigestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      groups: [
        {
          priority: "ALL",
          items: threads.map((t) => ({
            threadId: t.id,
            subject: t.subject,
            blurb: t.snippet || "",
          })),
        },
      ],
    };
  }

  const allowed = new Set(threads.map((t) => t.id));
  return {
    groups: parsed.data.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => allowed.has(i.threadId)),
    })),
  };
}
