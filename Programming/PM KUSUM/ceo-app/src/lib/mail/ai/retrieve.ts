import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  messageFieldMatchOr,
  requiredSearchTokens,
  scoreSearchHit,
  synonymVariants,
  tokenizeSearchQuery,
} from "@/lib/mail/mail-search";
import { expandSearchQuery, lexicalSearchPlan, rerankSearchHits } from "@/lib/mail/ai/search-expand";
import { getAnthropic } from "@/lib/mail/ai/claude";
import { bestChunkByMessage } from "@/lib/mail/chunking";

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

/**
 * Weighted, accent-insensitive tsvector expression (Phase R1).
 * MUST be byte-compatible between the GIN index and the query so the planner
 * uses the index. `prefix` is "" for the CREATE INDEX (bare columns) or "m."
 * for the aliased query.
 *
 * Weights: subject A, from/to B, body C, searchText (incl. attachment text) D.
 * `english` gives stemming (delay↔delayed); `simple` preserves codes/names;
 * `f_unaccent` folds José→jose, Café→cafe.
 */
function tsvExpr(prefix: string): string {
  const p = prefix;
  return `(
    setweight(to_tsvector('english', f_unaccent(coalesce(${p}subject,''))), 'A') ||
    setweight(to_tsvector('simple',  f_unaccent(coalesce(${p}subject,''))), 'A') ||
    setweight(to_tsvector('english', f_unaccent(coalesce(${p}"fromName",'') || ' ' || coalesce(${p}"fromAddress",'') || ' ' || coalesce(${p}"toAddresses",''))), 'B') ||
    setweight(to_tsvector('simple',  f_unaccent(coalesce(${p}"fromName",'') || ' ' || coalesce(${p}"fromAddress",'') || ' ' || coalesce(${p}"toAddresses",''))), 'B') ||
    setweight(to_tsvector('english', f_unaccent(coalesce(${p}"bodyText",''))), 'C') ||
    setweight(to_tsvector('english', f_unaccent(coalesce(${p}"searchText",''))), 'D')
  )`;
}

/**
 * Ensure the FTS extension, immutable unaccent wrapper, and weighted GIN
 * expression index exist (idempotent). Phase R1 §2 RAG.
 *
 * These are non-schema DB objects (a `db push` leaves expression indexes in
 * place). If anything here fails — e.g. no permission to CREATE EXTENSION —
 * the caller catches and falls back to the ILIKE path.
 */
export async function ensureMailFtsIndex(): Promise<void> {
  if (!ftsReady) {
    ftsReady = (async () => {
      await prisma.$executeRawUnsafe(
        `CREATE EXTENSION IF NOT EXISTS unaccent;`,
      );
      // Immutable wrapper so unaccent() can be used in an index expression.
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
          LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
        $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS mail_message_tsv_idx ON "MailMessage"
        USING GIN (${tsvExpr("")});
      `);
      // Retire the older unweighted expression index if present.
      await prisma
        .$executeRawUnsafe(`DROP INDEX IF EXISTS mail_message_fts_idx;`)
        .catch(() => undefined);
    })().catch((e) => {
      ftsReady = null;
      throw e;
    });
  }
  await ftsReady;
}

type FtsRow = { id: string; rank: number };

/** Turn mustGroups into a websearch query: (a OR b) (c OR d) → AND of OR-groups. */
export function searchPlanToFtsQuery(
  mustGroups: string[][] | undefined | null,
): string {
  if (!mustGroups?.length) return "";
  return mustGroups
    .map((g) => {
      const parts = g
        .map((t) => t.replace(/[()|&!:*]/g, " ").trim())
        .filter(Boolean);
      if (!parts.length) return "";
      if (parts.length === 1) return parts[0]!;
      return `(${parts.join(" OR ")})`;
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Postgres FTS retrieve (weighted tsvector, websearch_to_tsquery). Falls back
 * to ILIKE token AND. Optionally expands the query with AI concept groups
 * (AI-05) and reranks the shortlist with Haiku before returning (Phase R1).
 */
export async function retrieveMail(opts: {
  accountId: string;
  query: string;
  limit?: number;
  personEmail?: string;
  threadId?: string;
  /**
   * Expand mode for the FTS query:
   * - `ai` (default): Haiku expand when available (Ask / NL search)
   * - `lexical`: synonym groups only — no Claude (keyword Threads search)
   * - `none`: raw query string (tests / tight loops)
   *
   * `skipExpand: true` is treated as `lexical` so keyword search still gets
   * SBI→state bank / POS→e-statement coverage without an LLM round-trip.
   */
  expand?: "ai" | "lexical" | "none";
  /** @deprecated Prefer `expand`. `true` ⇒ lexical (not none). */
  skipExpand?: boolean;
  /** Run a Haiku listwise rerank over the shortlist before returning. */
  rerank?: boolean;
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

  const expandMode: "ai" | "lexical" | "none" =
    opts.expand ?? (opts.skipExpand ? "lexical" : "ai");

  // AI-05 / lexical: rewrite into richer FTS terms when useful
  let ftsQuery = q;
  let plan = null as Awaited<ReturnType<typeof expandSearchQuery>> | null;
  if (q && expandMode === "ai" && q.length >= 4) {
    plan = await expandSearchQuery(q).catch(() => null);
    const fromPlan = searchPlanToFtsQuery(plan?.mustGroups);
    if (fromPlan) ftsQuery = fromPlan;
  } else if (q && expandMode === "lexical") {
    plan = lexicalSearchPlan(q);
    const fromPlan = searchPlanToFtsQuery(plan.mustGroups);
    if (fromPlan) ftsQuery = fromPlan;
  }

  let ids: string[] = [];
  if (ftsQuery) {
    try {
      await ensureMailFtsIndex();
      const expr = Prisma.raw(tsvExpr("m."));
      const rows = await prisma.$queryRaw<FtsRow[]>`
        SELECT m.id,
          ts_rank_cd(
            ${expr},
            websearch_to_tsquery('english', f_unaccent(${ftsQuery}))
          ) AS rank
        FROM "MailMessage" m
        WHERE m."accountId" = ${opts.accountId}
          ${
            opts.personEmail
              ? Prisma.sql`AND m."fromAddress" ILIKE ${"%" + opts.personEmail.toLowerCase() + "%"}`
              : Prisma.empty
          }
          AND ${expr} @@ websearch_to_tsquery('english', f_unaccent(${ftsQuery}))
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

  // Phase R3: pull the best-matching chunk per candidate so the packed excerpt
  // is the relevant passage, not just the first 1200 chars of the body.
  const chunkQuery = ftsQuery || q;
  const bestChunks = chunkQuery
    ? await bestChunkByMessage(opts.accountId, ids, chunkQuery).catch(
        () => new Map<string, string>(),
      )
    : new Map<string, string>();

  const scored = ids
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => ({
      message: m,
      chunk: withBestExcerpt(toChunk(m), bestChunks.get(m.id)),
      score: scoreSearchHit({
        query: q || ftsQuery,
        subject: m.subject,
        snippet: m.snippet,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        searchBlob: m.searchText || m.bodyText,
        date: m.date,
        plan,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  // Phase R1: optional Haiku rerank of the shortlist before we trim to `limit`.
  if (opts.rerank && scored.length > limit && getAnthropic()) {
    const candidates = scored
      .slice(0, Math.min(scored.length, Math.max(limit * 2, 20)))
      .map((s) => ({
        id: s.chunk.messageId,
        subject: s.chunk.subject,
        fromAddress: s.chunk.fromAddress,
        fromName: s.message.fromName,
        snippet: s.chunk.snippet,
      }));
    const ordered = await rerankSearchHits({
      query: q || ftsQuery,
      intent: plan?.intent,
      candidates,
    }).catch(() => null);
    if (ordered?.length) {
      const rank = new Map(ordered.map((id, i) => [id, i]));
      scored.sort((a, b) => {
        const ra = rank.get(a.chunk.messageId);
        const rb = rank.get(b.chunk.messageId);
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return b.score - a.score;
      });
    }
  }

  return scored.slice(0, limit).map((x) => x.chunk);
}

/**
 * Prefer the query-relevant chunk (R3) as the packed excerpt when we found one,
 * otherwise keep the naive head-of-body excerpt from toChunk.
 */
function withBestExcerpt(
  chunk: RetrievedChunk,
  best: string | undefined,
): RetrievedChunk {
  if (!best) return chunk;
  return { ...chunk, bodyExcerpt: best.slice(0, 1200) };
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
