# AI-Enabled Email Client — Implementation Plan (CEO App)

Living doc for BluRidge CEO Command Center. Spec source: `AI-Enabled Email Client — Design Specification.docx` in PM KUSUM. Do not treat this as legal advice.

## Product thesis

Mail server is a dependency; AI is additive; retrieval-grounded; human confirms irreversible actions. If AI is removed, a usable email client remains at `/ceo/mail`.

## Mail server (verified)

| Item | Value |
|------|--------|
| Host | `mail.thebluridge.com` (docker-mailserver 15.1.0 + LDAP + Roundcube) |
| SMTP | **587** STARTTLS (also 465, 25) |
| IMAP | **993** IMAPS (also 143) |
| ManageSieve | 4190 in-container only — not used by app |
| CEO mailbox | **`akshay@thebluridge.com`** via `CEO_MAIL_*` |
| Invoice mailbox | `invoices@thebluridge.com` via existing `SMTP_*` (unchanged) |

## RAG (Section 2) — status

**Yes — FTS-RAG (implemented):**

1. `ensureMailFtsIndex()` — GIN on `to_tsvector(searchText + subject + from/to)`
2. `retrieveMail` — `websearch_to_tsquery` + `ts_rank`, with AI `expandSearchQuery` mustGroups → FTS OR-groups
3. ILIKE token-AND fallback when FTS empty/unavailable
4. `packChunks` → `fenceMailData` → Claude (Haiku/Sonnet)
5. Attachment text extracted post-sync (`processPendingAttachments`) feeds `searchText` / RAG excerpts

No pgvector in v1.

## Spec coverage (AI-01 … AI-21)

| ID | Feature | Phase | Status |
|----|---------|-------|--------|
| AI-01 | Smart triage & priority | B | Done — triage + Categorize UI |
| AI-02 | Auto-categorization / labels | B | Done — smart labels + Smart Inbox |
| AI-03 | Thread summarization | B | Done — Summarize action/UI |
| AI-04 | Inbox digest | B | Done — Digest UI + `digest_inbox` tool |
| AI-05 | Semantic / NL search (FTS RAG) | B/C | Done — FTS retrieve + expand + thread search |
| AI-06 | Mailbox Q&A with citations | C | Done — Ask dock + clickable citationRefs |
| AI-07 | Grounded reply draft (TipTap) | C | Done — AI Draft + style hints |
| AI-08 | Rewrite & tone (+ translate) | C | Done — Shorten/Soften/Formalize/Hindi |
| AI-09 | On-voice style from SENT | C | Done — Style button + `styleInPrompt` in drafts |
| AI-10 | Commitment → Task | D | Done — Tasks extract/accept UI |
| AI-11 | Follow-up / awaiting-reply | D | Done — Follow-ups + dismissible reminders |
| AI-12 | Assistant mail tools | C/D | Done — search/ask/digest/summarize/draft/tasks/recall |
| AI-13 | Attachment understanding | B | Done — extract on sync + AI summary UI |
| AI-14 | Smart autocomplete | C | Done — Autocomplete in compose |
| AI-15 | Multilingual compose | C | Done — Hindi draft / translate rewrite |
| AI-16 | People & relationship recall | C | Done — `recall Name` in Ask + tool |
| AI-17 | Meeting scheduling (ICS draft) | D | Done — Meeting ICS download (confirm) |
| AI-18 | Bulk cleanup & unsubscribe | D | Done — Cleanup panel + unsubscribe confirm |
| AI-19 | Schedule-send | A/D | Done — datetime-local → `sendAt` |
| AI-20 | Standing auto-label rules | B/D | Done — Rules manager UI + sync apply |
| AI-21 | Autonomy policy engine | A/D | Done — assertAutonomy on send/delete/unsub/ICS/tasks |

## Autonomy policy (AI-21)

Reversible (may auto): label, snooze, mark-read, draft, priority.  
Irreversible (always confirm): send, delete, schedule-send fire, calendar invite, unsubscribe HTTP, create Task.

## Env

```
CEO_MAIL_USER=akshay@thebluridge.com
CEO_MAIL_PASS=...
CEO_MAIL_FROM="Akshay <akshay@thebluridge.com>"
CEO_MAIL_HOST=mail.thebluridge.com
CEO_MAIL_SMTP_PORT=587
CEO_MAIL_IMAP_PORT=993
# CEO_MAIL_LIVE_TEST=1
```

Invoice `SMTP_*` remains separate.

## Tests

`npm test -- --run src/lib/mail` — mocked Anthropic; optional live IMAP/SMTP via `CEO_MAIL_LIVE_TEST=1`.
