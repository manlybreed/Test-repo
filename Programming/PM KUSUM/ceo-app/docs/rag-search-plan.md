# RAG Search & AI Support — Plan (CEO Mail Client)

Companion to `ai-email-client-plan.md`. Scope: how retrieval-augmented generation powers search and every AI feature in `/ceo/mail`, what is already built, and the v2 roadmap.

## 1. How RAG is used in this client

Every AI feature is the same pipeline with a different prompt. The model never sees the whole mailbox — it sees only the top-N retrieved excerpts, fenced and cited.

```
User intent (search / ask / draft / recall / digest)
   │
   ▼
expandSearchQuery (Haiku) ──► SearchPlan {mustGroups, should, fromHints}
   │                            (10-min cache; lexical fallback if AI down)
   ▼
retrieveMail — Postgres FTS (websearch_to_tsquery + ts_rank)
   │            ILIKE token-AND fallback; person/thread filters
   ▼
scoreSearchHit re-rank ──► top-N RetrievedChunk
   │                        (subject, from, date, 1200-char body,
   │                         800-char attachment excerpt)
   ▼
packChunks (12k-char budget) ──► fenceMailData (injection-safe fence)
   │
   ▼
Claude — Haiku (triage/labels/autocomplete/rerank)
         Sonnet (ask/summarize/draft/people/attachments)
   │
   ▼
JSON answer + citations: messageId[] ──► clickable citationRefs in UI
   │
   ▼
Autonomy policy (AI-21): reversible → auto; irreversible → confirm
```

Feature → RAG mapping:

| Feature | Retrieval scope | Model | Grounding contract |
|---|---|---|---|
| NL search (AI-05) | FTS + expand + rerank | Haiku | ranked thread list, no generation |
| Ask / Q&A (AI-06) | top-15 mailbox-wide | Sonnet | answer only from `mail_data`, else `notFound` |
| Reply draft (AI-07/09) | thread + style from SENT | Sonnet | quote facts only from retrieved thread |
| Summarize / digest (AI-03/04) | threadId-scoped (up to 40 msgs) | Sonnet | summary cites messageIds |
| People recall (AI-16) | `personEmail` filter + query | Sonnet | recent-thread summary with citations |
| Commitments / follow-ups (AI-10/11) | thread-scoped | Sonnet | extracted task must quote source msg |
| Attachment Q&A (AI-13) | `extractedText` in searchText + excerpts | Sonnet | cites carrying message |

Grounding invariants (already enforced, keep them):

1. **Fenced context** — mail content enters prompts only via `fenceMailData`; instructions inside emails are data, not commands.
2. **Citation whitelist** — model citations are filtered against the packed-chunk id list (`ask.ts`), so it cannot cite what it wasn't shown.
3. **Honest misses** — empty retrieval short-circuits to "I don't find that in your mail" without calling the model.
4. **AI-optional** — every path degrades to plain FTS results when `getAnthropic()` is null.

## 2. Current status (v1 — done)

- `ensureMailFtsIndex()` — expression GIN index over searchText + subject + from/to (`retrieve.ts`)
- `retrieveMail` — FTS with AI mustGroups → OR-group websearch query; ILIKE AND fallback; `scoreSearchHit` final ordering
- `expandSearchQuery` — Haiku query rewrite tuned for India business mail (bank codes, POS/EDC, e-statement), merged with lexical synonyms, cached 10 min
- `rerankSearchHits` — Haiku listwise rerank of thread candidates
- `packChunks` → `fenceMailData` → Claude JSON with citation filtering
- Attachment text extracted post-sync feeds `searchText` and per-chunk excerpts
- No pgvector in v1 (deliberate)

## 3. Known gaps

| # | Gap | Effect |
|---|---|---|
| G1 | `'english'` tsvector config only; no `unaccent` | Hindi / Hinglish / transliterated names get poor FTS recall — only ILIKE fallback catches them |
| G2 | No real chunking: body truncated at 1200 chars, attachments at 800 | Answers buried deep in long threads/PDFs are invisible to the model |
| G3 | Expression index recomputed in every query's WHERE/rank | Works, but a stored generated `tsv` column is faster and lets us add weights (`setweight`: subject A, body C) |
| G4 | `rerankSearchHits` not wired into `retrieveMail` | Ask/draft consume FTS-rank order; rerank only helps thread search |
| G5 | No recency prior in ranking | ts_rank ties break on date, but a 2-year-old strong lexical match can beat last week's relevant mail |
| G6 | No retrieval eval harness | Recall regressions (e.g. after prompt or synonym edits) are invisible until the CEO notices |
| G7 | No semantic recall | "the vendor who kept delaying the transformer delivery" fails unless words overlap |

## 4. Roadmap

### Phase R1 — FTS hardening (no new infra)

1. **Stored `tsv` column** (generated, GIN-indexed) replacing the expression index; `setweight` A=subject, B=from/participants, C=body, D=attachment text. Migration + drop old index.
2. **`unaccent` + `simple` config union** — index `to_tsvector('english', …) || to_tsvector('simple', unaccent(…))` so names, Hindi transliterations, and codes (PM-KUSUM, IREDA) match exactly.
3. **Recency prior** — final score = `scoreSearchHit * exp(-ageDays/180)` cap-floored so strong old matches still surface.
4. **Wire rerank into ask/draft** — after FTS top-48, run `rerankSearchHits` before `packChunks` when candidate count > limit.

### Phase R2 — chunking & packing

1. Chunk long bodies/attachment text at sync time (~1000 chars, 150 overlap) into a `MailChunk` table carrying `messageId`; FTS index chunks, retrieve chunks, cite parent message.
2. Pack budget by model: keep 12k for Haiku paths, raise to ~30k for Sonnet ask/summarize.
3. Dedupe near-identical quoted-reply chunks before packing (thread tail explosion).

### Phase R3 — retrieval evals (before any pgvector work)

1. Golden set: 30–50 real queries (from actual Ask usage logs) → expected messageIds.
2. `npm run eval:rag` — recall@10 / MRR against the golden set, runs with mocked Claude.
3. Gate: only proceed to R4 if measured recall shows FTS is the bottleneck (per plan: "pgvector only if FTS recall insufficient").

### Phase R4 — hybrid semantic retrieval (only if R3 says so)

1. `pgvector` column on `MailChunk`; embed at sync (batched, off the request path).
2. Hybrid query: FTS top-40 ∪ vector top-40 → Reciprocal Rank Fusion → rerank → pack. Keep FTS-only as automatic fallback.
3. Embedding model via same env-gated pattern as `getAnthropic()` (e.g. Voyage); zero embeddings ⇒ pure-FTS behavior unchanged.

### Phase R5 — support-side polish

1. Ask dock: show "searched for: …" (the SearchPlan intent + groups) so misses are debuggable by the user.
2. People recall: pre-aggregate per-contact digest (last subjects, open commitments) refreshed on sync, so `recall Name` is instant.
3. Multi-turn Ask: carry prior citations as pinned context for follow-up questions ("what did he say about the price?" keeps the thread).

## 5. Non-goals

- No external search service (Elastic/Meilisearch) — Postgres stays the single store.
- No fine-tuning; grounding + citations over parametric memory.
- No auto-send from RAG answers — AI-21 confirm gates stay as-is.

## 6. Tests

- Extend `retrieve.test.ts` for tsv-column path, unaccent matches, recency decay.
- New `chunking.test.ts` (R2) and `eval/rag-golden.test.ts` (R3).
- All mocked-Anthropic; live check stays behind `CEO_MAIL_LIVE_TEST=1`.
