import { prisma } from "@/lib/prisma";

/** AI-09: derive compact style features from SENT samples. */
export async function refreshStyleFromSent(accountId: string) {
  const sent = await prisma.mailFolder.findFirst({
    where: { accountId, role: "SENT" },
  });
  if (!sent) return null;

  const messages = await prisma.mailMessage.findMany({
    where: { accountId, folderId: sent.id, bodyText: { not: null } },
    orderBy: { date: "desc" },
    take: 30,
  });

  const greetings: string[] = [];
  const signoffs: string[] = [];
  let totalLen = 0;

  for (const m of messages) {
    const text = (m.bodyText || "").trim();
    totalLen += text.length;
    const first = text.split("\n").find((l) => l.trim());
    const last = [...text.split("\n")].reverse().find((l) => l.trim());
    if (first && /^(hi|hello|dear|namaste)/i.test(first)) greetings.push(first.trim());
    if (last && /^(best|regards|thanks|thank you|yours)/i.test(last)) {
      signoffs.push(last.trim());
    }
  }

  const style = {
    avgLength: messages.length ? Math.round(totalLen / messages.length) : 0,
    commonGreeting: mode(greetings) || "Hi",
    commonSignoff: mode(signoffs) || "Best regards",
    sampleCount: messages.length,
  };

  await prisma.mailAccount.update({
    where: { id: accountId },
    data: { styleJson: JSON.stringify(style) },
  });
  return style;
}

function mode(arr: string[]): string | null {
  if (!arr.length) return null;
  const counts = new Map<string, number>();
  for (const a of arr) counts.set(a, (counts.get(a) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function styleInPrompt(styleJson: string | null | undefined): string {
  if (!styleJson) return "";
  try {
    const s = JSON.parse(styleJson) as {
      commonGreeting?: string;
      commonSignoff?: string;
      avgLength?: number;
    };
    return `Prefer greeting "${s.commonGreeting}", sign-off "${s.commonSignoff}", ~${s.avgLength} chars.`;
  } catch {
    return "";
  }
}
