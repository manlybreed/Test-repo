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
| G7 | No semantic recall | "the vendor who kept delaying the transformer delivery" fails unless words overlap — status: conditional, see §4.7 |
| G8 | No person/contact index | `expandSearchQuery`'s `fromHints` is a static heuristic list, not a real aggregate of who's actually in this mailbox — "who sent…" on an unlisted sender falls through to plain ILIKE |

## 4. Roadmap

Locked order (see §4.7 Decision log for why): **R1 FTS harden → R2 people index → R3 chunking → R4 golden-set eval → R5 hybrid pgvector (conditional) → R6 support polish + regression watch.**

```
R1 FTS harden ──► R2 People index ──► R3 Chunking ──► R4 Golden-set eval
                                                             │
                                              paraphrase slice still misses?
                                                     │              │
                                                    yes             no
                                                     │              │
                                                     ▼              ▼
                                         R5 Hybrid pgvector    skip R5, re-run
                                          + remeasure           R4 weekly
```

### Phase R1 — FTS hardening (no new infra)

1. **Stored `tsv` column** (generated, GIN-indexed) replacing the expression index; `setweight` A=subject, B=from/participants, C=body, D=attachment text. Migration + drop old index.
2. **`unaccent` + `simple` config union** — index `to_tsvector('english', …) || to_tsvector('simple', unaccent(…))` so names, Hindi transliterations, and codes (PM-KUSUM, IREDA) match exactly.
3. **Recency prior** — final score = `scoreSearchHit * exp(-ageDays/180)` cap-floored so strong old matches still surface.
4. **Wire rerank into ask/draft** — after FTS top-48, run `rerankSearchHits` before `packChunks` when candidate count > limit.

### Phase R2 — people/contact index

*Moved before chunking — cheap, no new infra, and directly targets "who sent…" recall, which R1 alone under-serves.*

1. Sync-time contact aggregation: `email`, display-name variants seen in From/To/Cc, `lastMessageAt`, sample recent subjects. Small table, updated incrementally per sync/IDLE pull — not a per-query cost.
2. `expandSearchQuery` gains a person-hint lookup: fuzzy-match name tokens in the query against the contact table (not just the existing `fromHints` heuristic list) before falling back to ILIKE on `fromAddress`.
3. Feeds `recallPerson` too — turns "recall Name" from a live retrieve into a lookup against a warm, pre-aggregated row.

### Phase R3 — chunking & packing

1. Chunk long bodies/attachment text at sync time (~1000 chars, 150 overlap) into a `MailChunk` table carrying `messageId`; FTS index chunks, retrieve chunks, cite parent message.
2. Pack budget by model: keep 12k for Haiku paths, raise to ~30k for Sonnet ask/summarize.
3. Dedupe near-identical quoted-reply chunks before packing (thread tail explosion).
4. **Load-bearing for R5 too**: if hybrid ships later, chunks (not truncated full bodies) are the embedding unit — do this before vectors regardless of the R4 verdict.

### Phase R4 — golden-set eval (decision point, not a formality)

1. **Four-bucket golden set**, not a flat query list: production sample (real past Ask queries/searches), adversarial (near-duplicate senders/subjects), edge cases (empty results, very short queries, attachment-only hits), failure replays (anything a user flagged as wrong). Each entry: query → expected `messageId`s.
2. **Tag one bucket explicitly "paraphrase"** — queries with deliberately weak lexical overlap with the target email (e.g. asking about "the delivery holdup" when the mail says "pushed back the shipment"). This is the slice that actually decides R5, not the aggregate score.
3. `npm run eval:rag` — recall@10 / MRR overall **and per-bucket**, mocked Claude.
4. Re-run weekly once it exists — gate on the trend, not a one-time snapshot (catches regressions from prompt/synonym edits, not just the initial hybrid decision).

### Phase R5 — hybrid semantic retrieval (conditional on R4's paraphrase slice)

Ship only if the paraphrase bucket in R4 still misses after R1–R3 are in. If it clears the bar, skip this phase — re-run R4 weekly instead of building it speculatively.

1. `pgvector` column on `MailChunk`; embed at sync (batched, off the request path) — zero query-time embedding cost except the one query embedding per Ask.
2. Hybrid query: FTS top-20 ∪ vector top-20 → Reciprocal Rank Fusion → rerank → pack. Over-fetch each side before fusing (RRF needs the extra candidates to have signal); keep FTS-only as automatic fallback if the embedding call fails.
3. Embedding model via same env-gated pattern as `getAnthropic()` (e.g. Voyage); zero embeddings ⇒ pure-FTS behavior unchanged.
4. **Remeasure against the same R4 golden set** immediately after shipping — the eval isn't just a gate, it's the acceptance test.

### Phase R6 — support-side polish

1. Ask dock: show "searched for: …" (the SearchPlan intent + groups) so misses are debuggable by the user.
2. Multi-turn Ask: carry prior citations as pinned context for follow-up questions ("what did he say about the price?" keeps the thread).
3. Keep the R4 golden set running weekly indefinitely — cheapest regression detector for prompt/index changes in R1–R5.

### 4.7 Decision log — why gated, not skipped

An earlier draft of this plan (external review) argued for skipping R4 and building R5 unconditionally, on the premise that `expandSearchQuery` "cannot fix" paraphrase-style queries and that this was already a known, proven failure mode. Two things changed that:

- **No observed failure existed** — the paraphrase examples motivating that argument were hypothetical ("a mail that says something about so-and-so"), never a logged real miss. Skipping measurement to fix an unmeasured problem is the thing R4 exists to prevent.
- **Retrieval literature doesn't support "structurally impossible"** — LLM-expanded BM25 "frequently approaches or matches the retrieval effectiveness of dense retrievers operating on unexpanded queries" (see sources below). It's not proof this mailbox's setup will succeed, but it means the premise was overstated, not settled.
- **Scale cuts the same way** — for a single mailbox at low query volume (nowhere near the ~10M-document range where FTS starts to strain), the added infra/cost of pgvector is disproportionate to skip measuring first.
- **Conceded from that review, and kept**: people-index timing (moved to R2, ahead of chunking) and "must remeasure to know if hybrid helped" — both incorporated above.

Net: R4's paraphrase-labeled slice is the actual test of the disputed claim, not a generic recall number that could hide the exact failure mode in question. If R5 is needed, R4 will show it — cheaply, in about an eval-build afternoon, not weeks.

Sources: [Building Hybrid Search for RAG (pgvector + FTS + RRF)](https://dev.to/lpossamai/building-hybrid-search-for-rag-combining-pgvector-and-full-text-search-with-reciprocal-rank-fusion-6nk) · [Hybrid search with PostgreSQL and pgvector — Jonathan Katz](https://jkatz05.com/post/postgres/hybrid-search-postgres-pgvector/) · [A Reproducibility Study of LLM-Based Query Reformulation](https://arxiv.org/pdf/2604.27421) · [Vector Database Recall Evaluation (2026)](https://futureagi.com/blog/evaluating-vector-database-recall-quality-2026/)

## 4.8 Target latency budget (Ask path)

| Step | Typical cost |
|---|---|
| `expandSearchQuery` (Haiku, 10-min cache) | 0–1.5s (0 if cache hit) |
| FTS query + `packChunks` | 50–300ms |
| `rerankSearchHits` (Haiku, R1) | ~0.5–1s |
| Final answer (Sonnet) | 1–3s |
| **Total (cache miss, no hybrid)** | **typically < 5s** |
| + hybrid (R5, if shipped) | + query embedding (~100–300ms) + ANN search (tens of ms) — stays under budget since it replaces, not adds to, the FTS step |

## 4.9 Success criteria

- "There's a mail about X — who sent it?" resolves to correct sender + subject + an openable citation, in < 5s on a warm server.
- R4 recall@10 clears the target on the overall set **and** the paraphrase-tagged bucket specifically (a passing aggregate with a failing paraphrase bucket does not count as done).
- Empty retrieval still returns an honest "not found," never an invented answer.
- Weekly golden-set re-run stays flat or improves — a regression here blocks unrelated prompt/index changes from shipping silently.

## 5. Non-goals

- No external search service (Elastic/Meilisearch) — Postgres stays the single store.
- No fine-tuning; grounding + citations over parametric memory.
- No auto-send from RAG answers — AI-21 confirm gates stay as-is.

## 6. Tests

- Extend `retrieve.test.ts` for tsv-column path, unaccent matches, recency decay (R1).
- New `contacts.test.ts` (R2), `chunking.test.ts` (R3), and `eval/rag-golden.test.ts` (R4, includes the paraphrase bucket).
- If R5 ships: `hybrid-retrieve.test.ts` asserting FTS-only fallback when embeddings are unset, plus a rerun of `eval/rag-golden.test.ts` against the same set.
- All mocked-Anthropic; live check stays behind `CEO_MAIL_LIVE_TEST=1`.
