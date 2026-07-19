import { prisma } from "@/lib/prisma";

/** AI-20: apply standing MailLabelRule rows on ingest. */
export async function applyStandingLabelRules(
  accountId: string,
  threadId: string,
  ctx: { from: string; subject: string },
) {
  const rules = await prisma.mailLabelRule.findMany({
    where: { accountId, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!rules.length) return;

  const thread = await prisma.mailThread.findUnique({ where: { id: threadId } });
  if (!thread) return;

  const labels = new Set(
    JSON.parse(thread.labelsJson || "[]") as string[],
  );

  for (const rule of rules) {
    let match: { fromContains?: string; subjectContains?: string } = {};
    try {
      match = JSON.parse(rule.matchJson) as typeof match;
    } catch {
      continue;
    }
    const fromOk =
      !match.fromContains ||
      ctx.from.toLowerCase().includes(match.fromContains.toLowerCase());
    const subOk =
      !match.subjectContains ||
      ctx.subject.toLowerCase().includes(match.subjectContains.toLowerCase());
    if (fromOk && subOk) labels.add(rule.label);
  }

  await prisma.mailThread.update({
    where: { id: threadId },
    data: { labelsJson: JSON.stringify([...labels]) },
  });
}
