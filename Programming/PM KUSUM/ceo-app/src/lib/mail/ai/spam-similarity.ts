import { prisma } from "@/lib/prisma";
import type { MatchingThreadPreview } from "@/lib/mail/ai/label-rules";

/**
 * AI-22 cross-sender spam-campaign clustering. A pure sender/domain
 * reputation table (spam-feedback.ts) can't catch a phishing campaign
 * that deliberately rotates through different, never-seen-before sender
 * addresses — a well-documented spam tactic. This casts a content-based
 * net over what's still sitting in the inbox (no sender/subject
 * pre-filter, unlike findBroadCandidateThreads's label-correction
 * criteria, which would be the wrong shape here: "same sender" is
 * exactly what a rotating campaign doesn't have) and lets
 * classifySimilarThreads (label-correction.ts, already generic) judge
 * genuine similarity by content/purpose.
 */

export const SPAM_CANDIDATE_POOL_SIZE = 40;

export async function findRecentSpamCandidatePool(opts: {
  accountId: string;
  excludeThreadId: string;
  limit?: number;
}): Promise<MatchingThreadPreview[]> {
  const limit = Math.min(
    Math.max(opts.limit ?? SPAM_CANDIDATE_POOL_SIZE, 1),
    SPAM_CANDIDATE_POOL_SIZE,
  );

  const threads = await prisma.mailThread.findMany({
    where: {
      accountId: opts.accountId,
      id: { not: opts.excludeThreadId },
      trashedAt: null,
      messages: { some: { folder: { role: "INBOX" } } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      snippet: true,
      messages: {
        orderBy: { date: "desc" },
        take: 1,
        select: { fromAddress: true, fromName: true },
      },
    },
  });

  return threads.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    fromAddress: t.messages[0]?.fromAddress ?? null,
    fromName: t.messages[0]?.fromName ?? null,
  }));
}
