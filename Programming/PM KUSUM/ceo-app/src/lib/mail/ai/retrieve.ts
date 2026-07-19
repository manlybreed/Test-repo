import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  messageFieldMatchOr,
  requiredSearchTokens,
  scoreSearchHit,
  synonymVariants,
  tokenizeSearchQuery,
} from "@/lib/mail/mail-search";
import { expandSearchQuery } from "@/lib/mail/ai/search-expand";

export type RetrievedChunk = {
  messageId: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  date: string;
  snippet: string;
  bodyExcerpt: string;
  attachmentExcerpt?: string;
};

let ftsReady: Promise<void> | null = null;

/** Ensure GIN FTS index exists (idempotent). Plan §2 RAG. */
export async function ensureMailFtsIndex(): Promise<void> {
  if (!ftsReady) {
    ftsReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS mail_message_fts_idx ON "MailMessage"
        USING GIN (
          to_tsvector(
            'english',
            coalesce("searchText", '') || ' ' ||
            coalesce(subject, '') || ' ' ||
            coalesce("fromAddress", '') || ' ' ||
            coalesce("fromName", '') || ' ' ||
            coalesce("toAddresses", '')
          )
        );
      `);
    })().catch((e) => {
      ftsReady = null;
      throw e;
    });
  }
  await ftsReady;
}

type FtsRow = { id: string; rank: number };

/**
 * Postgres FTS retrieve (websearch_to_tsquery). Falls back to ILIKE token AND.
 * Optionally expands the query with AI concept groups (AI-05).
 */
export async function retrieveMail(opts: {
  accountId: string;
  query: string;
  limit?: number;
  personEmail?: string;
  threadId?: string;
  /** Skip AI expand (faster path for autocomplete / tight loops). */
  skipExpand?: boolean;
}): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 12;
  const q = opts.query.trim();

  if (opts.threadId) {
    const messages = await prisma.mailMessage.findMany({
      where: { accountId: opts.accountId, threadId: opts.threadId },
      orderBy: { date: "asc" },
      take: 40,
      include: { attachments: true },
    });
    return messages.map((m) => toChunk(m));
  }

  if (!q && !opts.personEmail) return [];

  // AI-05: rewrite NL query into richer FTS terms when useful
  let ftsQuery = q;
  let plan = null as Awaited<ReturnType<typeof expandSearchQuery>> | null;
  if (q && !opts.skipExpand && q.length >= 4) {
    plan = await expandSearchQuery(q).catch(() => null);
    if (plan?.mustGroups?.length) {
      // websearch: (a OR b) (c OR d)  → AND of OR-groups
      ftsQuery = plan.mustGroups
        .map((g) => {
          const parts = g.map((t) => t.replace(/[()|&!:*]/g, " ").trim()).filter(Boolean);
          if (!parts.length) return "";
          if (parts.length === 1) return parts[0]!;
          return `(${parts.join(" OR ")})`;
        })
        .filter(Boolean)
        .join(" ");
    }
  }

  let ids: string[] = [];
  if (ftsQuery) {
    try {
      await ensureMailFtsIndex();
      const rows = await prisma.$queryRaw<FtsRow[]>`
        SELECT m.id,
          ts_rank(
            to_tsvector(
              'english',
              coalesce(m."searchText", '') || ' ' ||
              coalesce(m.subject, '') || ' ' ||
              coalesce(m."fromAddress", '') || ' ' ||
              coalesce(m."fromName", '') || ' ' ||
              coalesce(m."toAddresses", '')
            ),
            websearch_to_tsquery('english', ${ftsQuery})
          ) AS rank
        FROM "MailMessage" m
        WHERE m."accountId" = ${opts.accountId}
          ${
            opts.personEmail
              ? Prisma.sql`AND m."fromAddress" ILIKE ${"%" + opts.personEmail.toLowerCase() + "%"}`
              : Prisma.empty
          }
          AND to_tsvector(
            'english',
            coalesce(m."searchText", '') || ' ' ||
            coalesce(m.subject, '') || ' ' ||
            coalesce(m."fromAddress", '') || ' ' ||
            coalesce(m."fromName", '') || ' ' ||
            coalesce(m."toAddresses", '')
          ) @@ websearch_to_tsquery('english', ${ftsQuery})
        ORDER BY rank DESC, m.date DESC
        LIMIT ${Math.min(limit * 4, 48)}
      `;
      ids = rows.map((r) => r.id);
    } catch {
      ids = [];
    }
  }

  // ILIKE fallback / merge when FTS empty or unavailable
  if (!ids.length) {
    const tokens = requiredSearchTokens(tokenizeSearchQuery(q || ftsQuery));
    const andTerms =
      tokens.length > 1
        ? tokens.map((t) => messageFieldMatchOr(synonymVariants(t)))
        : tokens.length === 1
          ? [messageFieldMatchOr(synonymVariants(tokens[0]!))]
          : q
            ? [messageFieldMatchOr([q])]
            : [];

    const messages = await prisma.mailMessage.findMany({
      where: {
        accountId: opts.accountId,
        ...(opts.personEmail
          ? {
              fromAddress: {
                contains: opts.personEmail.toLowerCase(),
                mode: "insensitive" as const,
              },
            }
          : {}),
        ...(andTerms.length ? { AND: andTerms } : {}),
      },
      orderBy: { date: "desc" },
      take: Math.min(limit * 4, 48),
      select: { id: true },
    });
    ids = messages.map((m) => m.id);
  }

  if (!ids.length) return [];

  const full = await prisma.mailMessage.findMany({
    where: { id: { in: ids } },
    include: { attachments: true },
  });
  const byId = new Map(full.map((m) => [m.id, m]));

  return ids
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => ({
      chunk: toChunk(m),
      score: scoreSearchHit({
        query: q || ftsQuery,
        subject: m.subject,
        snippet: m.snippet,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        searchBlob: m.searchText || m.bodyText,
        plan,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.chunk);
}

function toChunk(m: {
  id: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  date: Date;
  snippet: string | null;
  bodyText: string | null;
  attachments?: { extractedText: string | null }[];
}): RetrievedChunk {
  const att = (m.attachments || [])
    .map((a) => a.extractedText)
    .filter(Boolean)
    .join("\n")
    .slice(0, 800);
  return {
    messageId: m.id,
    threadId: m.threadId,
    subject: m.subject,
    fromAddress: m.fromAddress,
    date: m.date.toISOString(),
    snippet: m.snippet || "",
    bodyExcerpt: (m.bodyText || "").slice(0, 1200),
    attachmentExcerpt: att || undefined,
  };
}

export function packChunks(
  chunks: RetrievedChunk[],
  maxChars = 12000,
): { packed: string; citations: string[] } {
  const citations: string[] = [];
  let used = 0;
  const parts: string[] = [];
  for (const c of chunks) {
    const block = `[${c.messageId}] ${c.date} From:${c.fromAddress} Subj:${c.subject}\n${c.bodyExcerpt}${c.attachmentExcerpt ? `\n[attachment] ${c.attachmentExcerpt}` : ""}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    citations.push(c.messageId);
    used += block.length;
  }
  return { packed: parts.join("\n\n---\n\n"), citations };
}
