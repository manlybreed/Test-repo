# RAG Search & AI Support — Plan (CEO Mail Client)

Companion to `ai-email-client-plan.md`. Scope: how retrieval-augmented generation powers search and every AI feature in `/ceo/mail`, what is already built, and the v2 roadmap.

## 1. How RAG is used in this client

Every AI feature is the same pipeline with a different prompt. The model never sees the whole mailbox — it sees only the top-N retrieved excerpts, fenced and cited.

**Ask / draft / recall** (healthy path):

```
User intent
   │
   ▼
expandSearchQuery (Haiku) ──► SearchPlan {mustGroups, should, fromHints}
   │                            (10-min cache; lexical fallback if AI down)
   ▼
retrieveMail — Postgres FTS (websearch_to_tsquery + ts_rank_cd)
   │            MailContact person filters; ILIKE token-AND fallback
   ▼
scoreSearchHit / optional rerank ──► top-N chunks (MailChunk when available)
   │
   ▼
packChunks → fenceMailData → Claude → citations
```

**Threads search box** (tiered — see §3.2):

```
classifySearchTier(freeText)
   │
   ├─ person  → findContacts → participant filter (no Claude)
   ├─ keyword → retrieveMail(skipExpand) FTS → thread list
   └─ nl      → retrieveMail(expand) → optional rerank
```

Feature → RAG mapping:

| Feature | Retrieval scope | Model | Grounding contract |
|---|---|---|---|
| **Threads search box** | Tiered: contacts → FTS → AI-NL (`classifySearchTier`) | Haiku only on NL tier | ranked thread list |
| Ask / Q&A (AI-06) | FTS + expand + rerank via `retrieveMail` | Sonnet | answer only from `mail_data`, else `notFound` |
| Reply draft (AI-07/09) | thread + style from SENT | Sonnet | quote facts only from retrieved thread |
| Summarize / digest (AI-03/04) | threadId-scoped (up to 40 msgs) | Sonnet | summary cites messageIds |
| People recall (AI-16) | `MailContact` resolve + retrieve | Sonnet | recent-thread summary with citations |
| Commitments / follow-ups (AI-10/11) | thread-scoped | Sonnet | extracted task must quote source msg |
| Attachment Q&A (AI-13) | chunk / extractedText in FTS | Sonnet | cites carrying message |

Grounding invariants (already enforced, keep them):

1. **Fenced context** — mail content enters prompts only via `fenceMailData`; instructions inside emails are data, not commands.
2. **Citation whitelist** — model citations are filtered against the packed-chunk id list (`ask.ts`), so it cannot cite what it wasn't shown.
3. **Honest misses** — empty retrieval short-circuits to "I don't find that in your mail" without calling the model.
4. **AI-optional** — every path degrades to plain FTS / lexical results when `getAnthropic()` is null.
5. **Tiered search** — name/contact lookups must not call Claude; AI is reserved for natural-language / paraphrase queries (see §3.2).

## 2. Current status (R1–R4 infrastructure — done for Ask; search box still lagging)

**Shipped and used by Ask / recall / draft retrieval:**

- R1: weighted `unaccent` expression GIN (`mail_message_tsv_idx`); `retrieveMail` + recency + Ask rerank
- R2: `MailContact` + sync upsert; `findContacts` / `resolvePersonAddress`; wired to recall + compose autocomplete
- R3: `MailChunk` + FTS on chunks; Ask packs best chunk
- R4: `scripts/rag-golden.json` + `npm run eval:rag` (scaffolded; weekly automation pending)
- No pgvector yet (R5 gated; paraphrase slice currently clears with AI-expand)

**Threads search box** (`searchThreadsAction`) — **fixed (R6 / §3.2):**

- Tier router: person → `MailContact`; keyword → FTS (`retrieveMail` skipExpand); NL → expand + FTS + rerank
- Status line shows mode: `(contacts)` / `(fts)` / `(ai)` / `(operators)`
- Bare names like `prachi` no longer call Claude or scan bodies via ILIKE first

## 3. Known gaps

| # | Gap | Status |
|---|-----|--------|
| G1–G5 | FTS unaccent / weights / recency / Ask rerank | **Done** for `retrieveMail` (R1); history only |
| G6 | Retrieval eval harness | **Scaffolded** (R4); weekly cron still open |
| G7 | Semantic / paraphrase | **Conditional** — R4 paraphrase clears with expand; R5 pgvector deferred |
| G8 | People index missing | **Done** as `MailContact` (R2); also wired to Threads search (R6) |
| **G9** | **UI search ≠ Ask retrieval (split brain)** | **Fixed** — tiered Threads search (§3.2 / R6 P0) |

### 3.1 Issue: Threads search box was slow (observed Jul 2026) — fixed

**Symptom (before fix):** Simple name query `prachi` → `Search · 3 results · ~6500ms`.

**Root cause:** `searchThreadsAction` always ran Haiku expand + unindexed body ILIKE + Haiku rerank, bypassing `MailContact` and FTS.

**Fix:** §3.2 tiered router (shipped).

### 3.2 Solution: tiered Threads search (R6 / P0) ✅

| Tier | Detect | Path | AI? | Target latency |
|------|--------|------|-----|----------------|
| **Person** | 1–3 tokens, looks like a name (`classifySearchTier`) | `findContacts` → participant filter | **No** | **&lt;200ms** |
| **Keyword / operators** | short tokens, `from:` / `is:` etc. | `lexicalSearchPlan` synonym groups (no Claude) + thread match; optional FTS via `expand: "lexical"` | No | **&lt;500ms–1s** |
| **NL / paraphrase** | questions, “about…”, “who sent…”, long free text | expand + FTS (+ rerank) | **Yes** | keep under ~5s |

Also:

- Skip `rerankSearchHits` outside NL tier (or when &lt;2 hits)
- Status line shows mode: `Search · 3 · 42ms (contacts)` vs `(fts)` vs `(ai)`
- Keep ILIKE only as last-resort fallback if FTS returns empty
- Contact typeahead while typing remains available via compose/`findContactsAction` (Outlook-style people suggestions in the search box still optional polish)

**Success:** `prachi` no longer multi-second; no Anthropic call on bare name queries.

## 4. Roadmap

**Implementation status:** R1 ✅ · R2 ✅ · R3 ✅ · R4 ✅ scaffolded · R5 ⛔ gated · **R6 P0 (tiered Threads search) ✅** · remaining R6 polish ⏳

Locked order: **R1 → R2 → R3 → R4 → R5 (conditional) → R6 (polish + Threads search fix).**

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
                                                             │
                                                             ▼
                              R6 polish + tiered Threads search (contacts → FTS → AI)
```

### Phase R1 — FTS hardening (no new infra) ✅

1. **Weighted `unaccent` expression GIN index** (`mail_message_tsv_idx`, `ensureMailFtsIndex()`): `setweight` A=subject, B=from/to, C=body, D=searchText (incl. attachment text), each as `english ∥ simple` over an immutable `f_unaccent()` wrapper. `retrieveMail` ranks with `ts_rank_cd` on the same expression.
   *Decision:* used an **expression index, not a stored generated column** — a generated `tsvector` column breaks `prisma db push` (it errors trying to manage a default on it, and requires `--accept-data-loss`), whereas a non-schema expression index survives every `db push`. At mailbox scale the per-query recompute over ~48 candidates is negligible. Validated with `EXPLAIN` (Bitmap Index Scan) and a from-scratch `ensure()` recreate.
2. **`unaccent` + `simple` config union** — done as part of (1); José→jose, Café→cafe, PM-KUSUM verified.
3. **Recency prior** — `scoreSearchHit` multiplies by `max(0.4, exp(-ageDays/180))` when a `date` is supplied (opt-in; no-date path undecayed). Unit-tested.
4. **Wire rerank into ask** — `retrieveMail({rerank:true})` runs `rerankSearchHits` (Haiku, 3s timeout) over the top ~2×limit shortlist before trimming; enabled on the Ask path.

### Phase R2 — people/contact index ✅

*Moved before chunking — cheap, no new infra, and directly targets "who sent…" recall, which R1 alone under-serves.*

1. `MailContact` model + `upsertContactsFromMessage` (called per new message in sync): address, display-name variants, `messageCount` (sender-only), `lastMessageAt`, recent subjects. Idempotent SQL `backfillContacts` seeds history (130 contacts from 740 messages, verified).
2. `findContacts` / `resolvePersonAddress`: fuzzy name/domain lookup with pure `rankContacts` scoring (token hits → frequency → recency), unit-tested. Lazy-backfills on first empty lookup.
3. Wired into `recallPerson`, compose autocomplete, **and** Threads search person tier (R6).

### Phase R3 — chunking & packing ✅

1. `MailChunk` model + `rechunkMessage` (~1000 chars, 150 overlap) over body + attachment text, FTS-indexed (`mail_chunk_tsv_idx`). Built at message create and again after attachment extraction (`extractAttachmentText`). Backfilled 4,944 chunks from 740 messages, verified. `bestChunkByMessage` returns the query-relevant passage per candidate; `retrieveMail` packs that instead of the naive first-1200-chars.
2. Pack budget by model: Ask (Sonnet) raised to 24k; Haiku paths keep 12k.
3. `stripQuotedTail` removes trailing quoted-reply blocks before chunking (dedupes thread tails); unit-tested alongside `chunkText`.
4. **Load-bearing for R5 too**: chunks are the embedding unit if hybrid ever ships — done regardless of the R4 verdict.

### Phase R4 — golden-set eval (decision point, not a formality) ✅ scaffolded

1. **Four-bucket golden set** in `scripts/rag-golden.json`: production, adversarial, edge, **paraphrase**. Expectations are resync-stable sender/subject substrings (not `messageId`s, which regenerate on resync). Seeded with a starter set — grow from real Ask/search logs and flagged misses.
2. The **paraphrase** bucket is tagged as the R5 decision slice, exactly as designed.
3. `npm run eval:rag` (`scripts/eval-rag.ts`) — recall@10 / MRR overall **and per-bucket**, runs the real `retrieveMail`; prints whether it ran in AI-expand or FTS-only mode and whether the paraphrase slice clears the target.
4. Re-run periodically once the set grows — gate on the trend. *(Weekly automation not yet wired.)*

### Phase R5 — hybrid semantic retrieval (conditional on R4's paraphrase slice)

Ship only if the paraphrase bucket in R4 still misses after R1–R3 are in. If it clears the bar, skip this phase — re-run R4 weekly instead of building it speculatively.

1. `pgvector` column on `MailChunk`; embed at sync (batched, off the request path) — zero query-time embedding cost except the one query embedding per Ask.
2. Hybrid query: FTS top-20 ∪ vector top-20 → Reciprocal Rank Fusion → rerank → pack. Over-fetch each side before fusing (RRF needs the extra candidates to have signal); keep FTS-only as automatic fallback if the embedding call fails.
3. Embedding model via same env-gated pattern as `getAnthropic()` (e.g. Voyage); zero embeddings ⇒ pure-FTS behavior unchanged.
4. **Remeasure against the same R4 golden set** immediately after shipping — the eval isn't just a gate, it's the acceptance test.

### Phase R6 — support-side polish + Threads search fix

1. **P0 — Tiered Threads search** ✅ — `classifySearchTier` + contacts / FTS / AI paths in `searchThreadsAction`; status shows `(contacts)` / `(fts)` / `(ai)`.
2. Ask dock: show "searched for: …" (SearchPlan intent + groups) so misses are debuggable.
3. Multi-turn Ask: carry prior citations as pinned context for follow-ups.
4. Contact typeahead in the search box (people suggestions while typing) — optional UX polish.
5. Keep the R4 golden set running weekly — cheapest regression detector. Extend eval coverage to `searchThreadsAction` tiers (name queries must not invoke Anthropic).

### 4.7 Decision log — why gated, not skipped

An earlier draft of this plan (external review) argued for skipping R4 and building R5 unconditionally, on the premise that `expandSearchQuery` "cannot fix" paraphrase-style queries and that this was already a known, proven failure mode. Two things changed that:

- **No observed failure existed** — the paraphrase examples motivating that argument were hypothetical ("a mail that says something about so-and-so"), never a logged real miss. Skipping measurement to fix an unmeasured problem is the thing R4 exists to prevent.
- **Retrieval literature doesn't support "structurally impossible"** — LLM-expanded BM25 "frequently approaches or matches the retrieval effectiveness of dense retrievers operating on unexpanded queries" (see sources below). It's not proof this mailbox's setup will succeed, but it means the premise was overstated, not settled.
- **Scale cuts the same way** — for a single mailbox at low query volume (nowhere near the ~10M-document range where FTS starts to strain), the added infra/cost of pgvector is disproportionate to skip measuring first.
- **Conceded from that review, and kept**: people-index timing (moved to R2, ahead of chunking) and "must remeasure to know if hybrid helped" — both incorporated above.

Net: R4's paraphrase-labeled slice is the actual test of the disputed claim, not a generic recall number that could hide the exact failure mode in question. If R5 is needed, R4 will show it — cheaply, in about an eval-build afternoon, not weeks.

Sources: [Building Hybrid Search for RAG (pgvector + FTS + RRF)](https://dev.to/lpossamai/building-hybrid-search-for-rag-combining-pgvector-and-full-text-search-with-reciprocal-rank-fusion-6nk) · [Hybrid search with PostgreSQL and pgvector — Jonathan Katz](https://jkatz05.com/post/postgres/hybrid-search-postgres-pgvector/) · [A Reproducibility Study of LLM-Based Query Reformulation](https://arxiv.org/pdf/2604.27421) · [Vector Database Recall Evaluation (2026)](https://futureagi.com/blog/evaluating-vector-database-recall-quality-2026/)

## 4.8 Target latency budgets

### Ask path

| Step | Typical cost |
|---|---|
| `expandSearchQuery` (Haiku, 10-min cache) | 0–1.5s (0 if cache hit) |
| FTS query + `packChunks` | 50–300ms |
| `rerankSearchHits` (Haiku) | ~0.5–1s |
| Final answer (Sonnet) | 1–3s |
| **Total (cache miss, no hybrid)** | **typically &lt; 5s** |

### Threads search box (target after R6 / §3.2)

| Tier | Target |
|---|---|
| Person / name (`prachi`) via `MailContact` | **&lt; 200ms**, **zero** Claude calls |
| Keyword / operators via FTS | **&lt; 500ms**, expand skipped unless needed |
| NL / paraphrase | AI allowed; prefer FTS over ILIKE; keep under ~5s |

**Anti-goal:** bare name queries must never take multi-second expand + ILIKE + rerank (the Jul 2026 `6535ms` failure mode).

## 4.9 Success criteria

- "There's a mail about X — who sent it?" (Ask) resolves to correct sender + subject + citation in &lt; 5s on a warm server.
- Threads search for a known sender name (e.g. `prachi`) returns in **&lt; 200ms** via contacts, with no Anthropic round-trip.
- R4 recall@10 clears the target on the overall set **and** the paraphrase-tagged bucket specifically.
- Empty retrieval still returns an honest "not found," never an invented answer.
- Weekly golden-set re-run stays flat or improves.

## 5. Non-goals

- No external search service (Elastic/Meilisearch) — Postgres stays the single store.
- No fine-tuning; grounding + citations over parametric memory.
- No auto-send from RAG answers — AI-21 confirm gates stay as-is.

## 6. Tests

- `retrieve.test.ts` — FTS / unaccent / recency (R1).
- `contacts.test.ts` (R2), `chunking.test.ts` (R3), `eval/rag-golden` via `npm run eval:rag` (R4).
- **R6 / search box:** unit tests that person-tier queries call `findContacts` and **do not** call `expandSearchQuery` / `rerankSearchHits`; keyword tier uses FTS path; NL tier may expand.
- If R5 ships: `hybrid-retrieve.test.ts` + rerun golden set.
- Mocked Anthropic in CI; live behind `CEO_MAIL_LIVE_TEST=1`.
