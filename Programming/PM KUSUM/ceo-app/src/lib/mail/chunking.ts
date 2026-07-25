import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Phase R3 — retrieval chunking.
 *
 * Long bodies and attachment text are split into overlapping ~1000-char chunks
 * (quoted-reply tails stripped to avoid thread-tail duplication) and FTS-indexed
 * so a fact buried past the first screenful is still findable. Chunks cite their
 * parent messageId.
 */

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_MESSAGE = 40;

let chunkFtsReady: Promise<void> | null = null;

/**
 * Drop an obvious trailing quoted-reply block so the same quoted text isn't
 * re-chunked on every message in a thread. Conservative: only cuts at the first
 * recognized reply-header line, never mid-content. Pure.
 */
export function stripQuotedTail(text: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const markers: RegExp[] = [
    /^\s*-{2,}\s*original message\s*-{2,}/i,
    /^\s*-{2,}\s*forwarded message\s*-{2,}/i,
    /^\s*On .+ wrote:\s*$/i,
    /^\s*On .+,.+<.+@.+>\s*wrote:\s*$/i,
    /^\s*From:\s.+\s+Sent:\s/i,
    /^\s*_{5,}\s*$/,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (markers.some((m) => m.test(line))) {
      const head = lines.slice(0, i).join("\n").trim();
      // Only strip if there's meaningful content before the quote.
      if (head.length >= 40) return head;
    }
  }
  return text;
}

/** Normalize whitespace so chunk boundaries and FTS are stable. Pure. */
function normalizeForChunking(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split text into overlapping chunks, preferring to break on whitespace near
 * the boundary rather than mid-word. Pure and deterministic. Exported for tests.
 */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const clean = normalizeForChunking(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const out: string[] = [];
  let start = 0;

  while (start < clean.length && out.length < MAX_CHUNKS_PER_MESSAGE) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Nudge the cut back to the last whitespace within a small window.
      const window = clean.slice(end - 120, end);
      const ws = window.lastIndexOf(" ");
      if (ws > 0) end = end - 120 + ws;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return out;
}

/**
 * Rebuild the chunk rows for one message from its current body + attachment
 * text. Idempotent (delete-then-insert). Safe to call at message create and
 * again after attachment extraction.
 */
export async function rechunkMessage(messageId: string): Promise<number> {
  const message = await prisma.mailMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      accountId: true,
      threadId: true,
      bodyText: true,
      attachments: { select: { extractedText: true } },
    },
  });
  if (!message) return 0;

  const bodyChunks = chunkText(stripQuotedTail(message.bodyText || ""));
  const attachChunks = (message.attachments || [])
    .map((a) => a.extractedText || "")
    .filter(Boolean)
    .flatMap((t) => chunkText(t));

  const rows = [
    ...bodyChunks.map((content, i) => ({
      source: "body" as const,
      ord: i,
      content,
    })),
    ...attachChunks.map((content, i) => ({
      source: "attachment" as const,
      ord: bodyChunks.length + i,
      content,
    })),
  ].slice(0, MAX_CHUNKS_PER_MESSAGE);

  await prisma.mailChunk.deleteMany({ where: { messageId } });
  if (!rows.length) return 0;

  await prisma.mailChunk.createMany({
    data: rows.map((r) => ({
      accountId: message.accountId,
      messageId: message.id,
      threadId: message.threadId,
      ord: r.ord,
      source: r.source,
      content: r.content,
    })),
  });
  return rows.length;
}

/** Ensure the chunk FTS GIN index exists (idempotent). Depends on f_unaccent. */
export async function ensureMailChunkFtsIndex(): Promise<void> {
  if (!chunkFtsReady) {
    chunkFtsReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
          LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
        $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS mail_chunk_tsv_idx ON "MailChunk"
        USING GIN ((
          to_tsvector('english', f_unaccent(content)) ||
          to_tsvector('simple',  f_unaccent(content))
        ));
      `);
    })().catch((e) => {
      chunkFtsReady = null;
      throw e;
    });
  }
  await chunkFtsReady;
}

type ChunkHit = { messageId: string; content: string };

/**
 * For a set of candidate messages, return the single best-matching chunk per
 * message for the query (the passage actually worth packing). Falls back to
 * nothing on error — callers use the naive body excerpt then.
 */
export async function bestChunkByMessage(
  accountId: string,
  messageIds: string[],
  ftsQuery: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!messageIds.length || !ftsQuery.trim()) return out;
  try {
    await ensureMailChunkFtsIndex();
    const rows = await prisma.$queryRaw<ChunkHit[]>`
      SELECT DISTINCT ON (c."messageId") c."messageId", c.content
      FROM "MailChunk" c
      WHERE c."accountId" = ${accountId}
        AND c."messageId" IN (${Prisma.join(messageIds)})
        AND (
          to_tsvector('english', f_unaccent(c.content)) ||
          to_tsvector('simple',  f_unaccent(c.content))
        ) @@ websearch_to_tsquery('english', f_unaccent(${ftsQuery}))
      ORDER BY c."messageId",
        ts_rank_cd(
          to_tsvector('english', f_unaccent(c.content)),
          websearch_to_tsquery('english', f_unaccent(${ftsQuery}))
        ) DESC
    `;
    for (const r of rows) out.set(r.messageId, r.content);
  } catch {
    return out;
  }
  return out;
}

/** One-time (idempotent) backfill of chunks for messages that have none. */
export async function backfillChunks(
  accountId: string,
  limit = 500,
): Promise<number> {
  const messages = await prisma.mailMessage.findMany({
    where: { accountId, chunks: { none: {} } },
    orderBy: { date: "desc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const m of messages) {
    await rechunkMessage(m.id).catch(() => 0);
    done += 1;
  }
  return done;
}
