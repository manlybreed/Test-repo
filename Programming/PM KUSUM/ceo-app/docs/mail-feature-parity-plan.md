# Mail Client Feature Parity Plan

Companion to `ai-email-client-plan.md` (AI feature coverage) and `rag-search-plan.md` (retrieval roadmap). This doc is scoped to **client UX/feature parity** — the conventional mail-client flows a CEO using this as a daily driver would expect from years of Gmail/Outlook/Thunderbird muscle memory — compared against what `/ceo/mail` actually has today.

Grounded in: (1) direct reading of `src/components/mail/mail-client.tsx`, `composer.tsx`, `message-reader.tsx`, `signatures-panel.tsx`, `src/actions/mail.ts`, `src/lib/mail/*.ts`, `src/lib/mail/ai/*.ts`, and `prisma/schema.prisma` on `main` (commit `620ae99`); (2) live web research on current Gmail, Thunderbird, Outlook (web + desktop), and Roundcube behavior (sources listed at the end). Nothing below is guessed from training data alone — every "Missing" verdict was confirmed by grep/read against the actual code, not inferred from the feature's absence in this document's outline.

**Status legend:** **Done** — matches or reasonably approximates the reference convention. **Partial** — exists but with a gap a daily user would hit. **Missing** — no code path does this today. **N/A** — deliberately out of scope for a single-CEO, single-mailbox product.

---

## 1. Composing (new / reply / reply-all / forward / quoting)

| Feature / flow | Gmail / Thunderbird / Outlook / Roundcube convention | This app | Note |
|---|---|---|---|
| New mail | Compose button opens blank editor, default identity + signature pre-filled | Done | `composeNew()` (`mail-client.tsx:1454`) opens fullscreen composer, inserts default signature via `data-mail-sig` div |
| Reply | Pre-fill To = sender, Subject = `Re: …`, thread headers (`In-Reply-To`/`References`) set, **original message quoted inline** below/above an attribution line | Partial | `replyContext()` (`mail-client.tsx:233-272`) gets To/Cc/Subject/threading headers right, but the compose body starts empty (`<p></p>` + signature only, `mail-client.tsx:1368`) — **no quoted original text is inserted**. A manual (non-AI) reply carries zero visible thread context to the recipient unless the user runs AI Draft, which writes new grounded prose rather than a literal quote block |
| Reply-All | One click populates To = original sender, Cc = every other original To/Cc recipient (minus self) | Missing | `replyContext()` only preserves the original Cc list when replying to your **own** sent message (`fromMe` branch); for a normal received-message reply, Cc is always cleared and To is only the sender. There is no separate Reply-All action, button, or shortcut anywhere in `mail-client.tsx` |
| Forward | Subject `Fwd: …`, original body quoted/embedded, original attachments carried forward, To left blank for the user | Missing | Confirmed via full-repo grep — no `forward`/`Fwd:` logic exists in `mail-client.tsx` or `src/actions/mail.ts`. The only "forward" text in the codebase is an ICS-download hint ("forward as needed") with no actual forward flow behind it |
| Quoting / attribution convention | Gmail: `On <date>, <name> <<email>> wrote:` + blockquote. Thunderbird: configurable via `mailnews.reply_header_*` prefs, similar default. Outlook: header block (From/Sent/To/Subject) above original. Roundcube: localized "On date, name wrote" + blockquote | Missing | No attribution-line generation exists (follows from the Reply gap above) |
| Reading a message's own quoted history | Collapse/expand older quoted content within a long thread's HTML body | Done | `message-reader.tsx` has a "Show quoted history" / "Hide quoted history" toggle for received messages |

---

## 2. Delete / Trash / permanent delete / recover / retention

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Move to Trash | One-click delete moves message to Trash/Deleted Items; not removed from server yet | Done | `trashThreadAction` (`src/actions/mail.ts:163`) |
| Recover from Trash | Move/drag back to Inbox (or Outlook's explicit "Recover Deleted Items" for purged Exchange items) | Done (implicit) | The "Move to…" menu is available while viewing Trash and lists all non-Trash folders as destinations — functions as restore, though there's no dedicated "Restore" button/label distinct from generic Move-to |
| Permanent delete ("Delete forever" / Empty Trash / Shift+Del) | All four clients offer an explicit, irreversible delete-forever action, usually with a confirm dialog | **Missing entirely** | Confirmed via grep for `expunge`, `\Deleted`, `hardDelete`, `deleteForever` — none exist outside an IMAP IDLE event-listener name. The app currently has **no way to permanently delete mail** — everything only moves between folders. (This is conservative-safe today, but means there's also no "empty trash" for a CEO who wants to actually reclaim mailbox space) |
| Trash retention metadata | Gmail/Outlook/Thunderbird show "will be deleted in N days" | Done (display only) | `trashedAt` field (`prisma/schema.prisma:815`) — set once on move-to-trash, never bumped by resync; Trash view still sorts/displays by original `lastMessageAt` with a "Deleted Xh/d ago" secondary hint (`mail-client.tsx:3588-3594`) |
| Auto-purge after N days | **Gmail**: default 30-day auto-purge from Trash (server-side, scheduled). **Outlook**: Deleted Items often auto-cleaned on account policy. **Thunderbird**: opt-in "Empty Trash on Exit." **Roundcube**: server/admin-configured retention | **Missing** (no job exists) | No cron/scheduled job of any kind purges Trash. See §5 destructive-action callout — do not silently add this |

---

## 3. Mailbox organization (folders, labels, nesting, multi-account)

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| System folders (Inbox/Sent/Drafts/Trash/Junk) | All four | Done | `pickSystemFolders()` (`mail-client.tsx:170`) maps real IMAP folders to canonical roles |
| Custom folders vs. labels | Gmail: labels (multi-tag, one Inbox). Outlook/Thunderbird/Roundcube: real hierarchical folders (single location per message) | Partial / hybrid | Real IMAP folders exist and can be created (`createMailLabelAction`), but the UI flattens them into a single-level "labels" list (`pickLabelFolders()`, `mail-client.tsx:185`) — closer to Gmail's flat-label mental model than to a true folder tree |
| Nested folder tree browsing | Thunderbird/Outlook/Roundcube show expandable folder hierarchies (`Parent/Child`) | Missing | Folder `path` values with `/` or `.` delimiters are detected for scoring but never rendered as an expandable tree — sidebar is a flat list |
| "All Mail" view | Gmail's All Mail (every non-Trash/Spam message, one place) | N/A-ish / Partial | No explicit "All Mail" folder; closest equivalent is browsing individual folders or Search (which spans everything) |
| Multiple accounts / identities | Thunderbird/Outlook/Roundcube all support several mailboxes or From-identities in one client | N/A by design | Single CEO, single mailbox (`akshay@thebluridge.com`) hard-wired via `CEO_MAIL_*` env (`src/lib/mail/ceo-config.ts`, `account.ts`) — this is the explicit product thesis, not an oversight |
| AI Smart Inbox / smart labels | Not a native concept in any of the four (closest: Gmail's Categories tabs, Outlook's Focused Inbox) | Done (this app exceeds parity here) | Curated Smart Inbox + AI smart labels already implemented (`ai/smart-labels.ts`, `ai/triage.ts`) — out of scope for gap-finding, noted for completeness |

---

## 4. Signatures

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Multiple signatures, create/edit/delete | All four | Done | `signatures-panel.tsx` full CRUD + `upsertSignature`/`deleteSignature` actions |
| One marked default | All four | Done | `isDefault` boolean on `MailSignature`, single-select checkbox in the panel |
| Per-account default signature | Thunderbird/Outlook/Roundcube (each identity/account has its own default) | N/A | Single-account app — doesn't apply |
| Different default for new mail vs. reply/forward | Gmail explicitly separates these two settings; Outlook/Thunderbird support similar per-context defaults | Partial | Both `composeNew()` and the reply-open path insert the *same* `defaultSig` (`mail-client.tsx:1018-1021`, used at both `:1368` and `:1465`) — no distinct "no signature on reply" or "different sig on reply" option |
| Manual signature swap mid-compose | All four (signature picker in the compose toolbar) | Done | `applySignature()` (`mail-client.tsx:1847`) swaps the signature block without disturbing the rest of the draft |

---

## 5. Attachments

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Attach via file picker | All four | Done | Hidden `<input type="file" multiple>` + `onPickAttachments()` → `uploadComposeAttachmentAction` (`mail-client.tsx:1678`, `2733`) |
| Drag-and-drop attach | All four support dragging files onto the compose window | **Missing** | Confirmed — zero `dataTransfer`/`onDrop`/`onDragOver` handlers anywhere in `mail-client.tsx` or `composer.tsx` |
| Inline images (paste/embed in body, not just as file chips) | Gmail/Outlook/Thunderbird all support pasting an image directly into the HTML body | Missing | TipTap config in `composer.tsx` has no `Image` extension; all attachments — including images — become generic filename chips, never inline `<img>` |
| Large-file / cloud-link fallback (e.g. Gmail auto-offers Drive link over ~25MB) | Gmail/Outlook (OneDrive) | Missing | No file-size threshold logic found; uploads go straight to local/SMTP attachment path regardless of size |
| Download a received attachment | All four | Done | Per-attachment `<a href="/api/mail/attachments/{id}" download>` (`message-reader.tsx:422-444`) |
| "Download all" bulk action for a multi-attachment message | Gmail (zip download for 2+ files), Outlook | Missing | Each attachment is an individual download link only; no zip/bulk action |
| Inline image thumbnail preview before download | Gmail/Outlook show image thumbnails, not just filename+size | Missing | All attachments render as identical generic filename chips regardless of MIME type |
| AI attachment summary | Not a native feature in any of the four | Done (exceeds parity) | "AI summary" button per attachment (`message-reader.tsx:445-461`, `summarizeAttachmentAction`) |

---

## 6. Composer / rich-text / HTML

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Formatting toolbar (bold/italic/underline/strike) | All four | Done | `composer.tsx` TipTap `StarterKit` + `Underline` |
| Headings, lists, blockquote | All four | Done | H1-H3, bullet/ordered list, blockquote all wired |
| Code block | Gmail: no. Outlook: no. Thunderbird/Roundcube: no native code block either — this is actually **beyond** all four references | Done (exceeds parity) | `toggleCodeBlock()` present; nice-to-have for a technically literate CEO, not a gap to close |
| Tables | Outlook (desktop) yes; Gmail/Thunderbird/Roundcube largely no native table insert | Done (exceeds parity for 3 of 4) | `TableKit` with insert/add-row/add-col/delete-table |
| Undo/redo | All four (native OS-level + editor-level) | Done | TipTap `undo()`/`redo()` bound to explicit toolbar buttons |
| Font family / size controls | Gmail yes (Sans Serif/Serif/Fixed-width, sizes); Outlook yes; Thunderbird/Roundcube more limited | Done | Font-family + font-size `<select>`s (`composer.tsx:316-361`), text-color picker |
| Text alignment | Gmail/Outlook yes | Done | Left/center/right via `TextAlign` |
| Link insert/edit | All four | Done | `Link` extension + `window.prompt` for URL |
| Clear formatting | Gmail/Outlook yes | Done | `unsetAllMarks().clearNodes()` |
| Plain-text compose mode | Gmail/Outlook/Thunderbird all offer a "Plain text mode" toggle (strips all HTML, useful for terse/compatible mail) | **Missing** | No plain-text toggle anywhere — composer is HTML-only, always |
| Horizontal rule | Outlook/Thunderbird yes | Done | `setHorizontalRule()` |

---

## 7. Priority / importance / flags / stars

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Star / flag a message | Gmail: single star toggle. Outlook: color-coded follow-up flags + reminders. Thunderbird/Roundcube: flag column | Done (different model) | Single "Mark important" boolean (`setThreadImportant`, `mail-client.tsx` "important" toggle) — functionally a star, not a multi-color flag system |
| Priority levels | Outlook "High/Normal/Low" importance marker (sender-set, cosmetic only — doesn't reorder mail); Gmail/Thunderbird/Roundcube have no native equivalent | Done (exceeds parity) | AI-assigned P1-P4 priority tiers (`setThreadPriority`, `mail-client.tsx:3785`) drive actual triage/Smart Inbox filtering, not just a cosmetic tag — stronger than any of the four references |
| Follow-up flag + reminder date | Outlook's flag-for-follow-up with a due date/reminder popup | Done (different mechanism) | Snooze-until date/time picker (`snoozeThread`, `mail-client.tsx:3938-4008`) achieves the same outcome via resurfacing rather than a flag badge |

---

## 8. Tasks, reminders, follow-up nudges, snooze

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Snooze a thread | Gmail native "Snooze"; Outlook/Thunderbird only via add-ins/extensions | Done (matches Gmail, ahead of Outlook/TB/RC) | "Tomorrow" quick option + custom datetime picker |
| Manual to-do/task from an email | Outlook (flag → Tasks pane); Gmail (Google Tasks side panel) | Done (AI-driven, stronger) | Commitment/task extraction (`ai/commitments.ts`, `extractCommitmentsAction`) turns detected commitments into acceptable tasks — no native equivalent in Thunderbird/Roundcube at all |
| Awaiting-reply / follow-up nudge | Not native to any of the four (closest: Boomerang/Superhuman-style add-ons for Gmail) | Done (exceeds parity) | `ai/followup.ts` + dismissible reminder UI |

---

## 9. Move/archive/bulk actions/shortcuts/search/autocomplete

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Archive | Gmail/Outlook/Roundcube one-click archive | Done | `archiveThreadAction`, bound to `e` shortcut |
| Move to folder | All four | Done | `moveThreadToFolderAction` + Move-to menu, single thread only (`mail-client.tsx:3886-3937`) |
| **Multi-select bulk actions** (checkbox per row → archive/delete/label/move many at once) | All four — this is one of the most-used power features in every mature client | **Missing** | No checkbox, no `selectedIds`/multi-select state anywhere in `mail-client.tsx` (confirmed by grep). The only "bulk" feature is an AI-generated cleanup-suggestions panel (`bulkCleanupSuggestionsAction`) that surfaces candidates one at a time for individual confirm — not manual multi-select-then-batch-act |
| Keyboard shortcuts | Gmail: `c` compose, `r`/`a`/`f` reply/reply-all/forward, `e` archive, `#` delete, `j`/`k` navigate, `/` search, `z` undo, `?` shows full shortcut sheet | Partial | Implemented: `Cmd/Ctrl+Enter` send, `Escape` close/blur, `r` reply, `c` compose, `j`/`k` navigate, `e` archive, `/` search (`mail-client.tsx:1074-1151`). **Missing**: reply-all/forward shortcuts (don't exist to bind), delete shortcut, undo shortcut, and critically **no `?` shortcut-help overlay** — shortcuts are undiscoverable to a new user |
| Search operators (`from:`, `to:`, `has:attachment`, `before:`/`after:`, `is:unread`, `is:starred`, `label:`) | Gmail's operator grammar is the de facto standard; Outlook/Thunderbird/Roundcube all support a reduced overlapping set | **Missing** | Search is AI-expanded natural-language + keyword/synonym matching (`mail-search.ts`, `ai/search-expand.ts`) with no operator grammar at all — typing `from:vendor@x.com` is just treated as literal search text, not parsed as a sender filter. This is a deliberate different approach (NL search vs. operator search), but a Gmail-trained user's muscle-memory queries will silently degrade to a plain keyword search rather than erroring or being reinterpreted |
| Contact / people autocomplete in To/Cc | All four show a live dropdown of matching contacts as you type | **Missing** | To/Cc/Bcc are plain `<input>` text fields (`mail-client.tsx:4260-4261`, `4636-4637`) with only the browser's native `autoComplete="email"` attribute — no app-level suggestion dropdown. Notably, a `MailContact` index with fuzzy name/domain ranking already exists (`contacts.ts`, `findContacts`/`resolvePersonAddress`) but is wired only into the Ask/recall AI path, never into compose recipient fields |
| Pagination / list navigation | Gmail's "1-50 of 1,234" + Older/Newer arrows | Done | Real skip/take pagination with the same convention (`mail-client.tsx:3652-3672`); search results remain top-N ranked (unaffected by design) |

---

## 10. Undo Send, read receipts, out-of-office, filters, print, spam reporting

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Undo Send | Gmail: 5/10/20/30s configurable delay before actual SMTP dispatch, with an "Undo" toast. Outlook web: 5-30s slider (10s default); desktop up to 120s. Recall (cross-account) is unreliable/unsupported on both | **Missing (partially scaffolded, but dead)** | `MailOutbox.undoUntil` field exists in the schema and `sendMailAction` sets it to `now + 30s` (`src/actions/mail.ts:680`), but for an immediate (non-scheduled) send the code calls `flushOutboxItem()` **synchronously right after**, dispatching over SMTP immediately regardless of `undoUntil` — there is no delay, no toast, no cancel button. The field is currently unused dead data, not a working feature |
| Read receipts | Gmail: Workspace-only, admin-gated, recipient can decline. Outlook: native "Request a read receipt." Thunderbird/Roundcube: `Disposition-Notification-To` header support | Missing | No `Disposition-Notification-To`/return-receipt logic anywhere in `transport.ts` or `send-receive.ts` |
| Out-of-office / vacation responder | Gmail: native Vacation Responder. Outlook: Automatic Replies (Exchange) or a client-side rule. Thunderbird: no native support (add-on only). Roundcube: `managesieve` Vacation module (server-side Sieve script) | Missing | No vacation-responder UI, action, or Sieve integration anywhere in the codebase |
| Filters / rules | Gmail: filters can archive/delete/star/label/forward/never-spam based on criteria. Outlook: full Rules Wizard (move/forward/flag/delete/notify) + Sweep. Thunderbird: Message Filters (move/copy/delete/mark/tag/forward). Roundcube: `managesieve` Filters (equally broad) | **Partial** | `MailLabelRule` + `applyStandingLabelRules()` (`ai/label-rules.ts`) only **adds a label** based on from-contains/subject-contains match at ingest — no archive, delete, move, forward, or mark-read actions like every reference client supports |
| Print a message/thread | All four have a native print view | **Missing** | Zero `print`/`window.print`/`@media print` anywhere in `src/components/mail/` |
| Report spam / phishing | Gmail: one-click "Report spam"/"Report phishing," moves to Spam + reports to Google. Outlook: "Report" button (junk/phishing). Thunderbird: "Mark as Junk" (Bayesian filter). Roundcube: move-to-Junk + optional plugins | **Missing (as a distinct action)** | A Junk/Spam folder role is recognized by the sync/folder logic (`imap-mailbox.ts`, `sync.ts`), and `blockSenderAction` exists to permanently block a sender going forward, but there is no one-click "Report spam"/"Mark as junk" button that moves the current message there — a CEO has to use the generic Move-to menu and pick Junk manually, if a Junk folder even exists on this server |

---

## 11. Notifications, offline/PWA, conversation view

| Feature / flow | Reference convention | This app | Note |
|---|---|---|---|
| Desktop/browser notifications for new mail | All four (native OS notification on new-mail event) | **Missing** | No `Notification` API usage anywhere, despite the app already having a real-time push mechanism (`idle-watcher.ts` → SSE at `/api/mail/live`) that could trivially drive a browser notification — the plumbing exists, the notification call does not |
| Offline support / installable app | Gmail: offline mode via Chrome (deprecated standalone app, now a web-offline mode caching ~30 days of mail); not a true installable PWA. Outlook web: limited offline via cache. Thunderbird: full offline (desktop, local mail store). Roundcube: none (thin webmail) | **Missing** | No `manifest.json`, no service worker, found anywhere in `public/` — the app is fully online-only, closer to Roundcube's model than Gmail's |
| Conversation view expand/collapse-all | Gmail: collapsed-by-default thread with "N older messages" expander + explicit "Expand all" control. Outlook/Thunderbird/Roundcube: similar collapse/expand per message | Partial | `message-reader.tsx` supports show/hide of an individual message's *quoted history*, but there's no thread-level "expand all / collapse all" control across multiple messages in a thread |
| Live/real-time sync | Not native to any of the four in this form (all four poll or use push-via-server, not exposed as a build detail to the end user) | Done (exceeds parity) | IMAP IDLE watcher + SSE live updates (`idle-watcher.ts`, `/api/mail/live`) — genuinely ahead of typical webmail polling intervals |

---

## Prioritized Gap List

Ordered by how quickly a CEO using this daily would notice/be blocked by the gap, folding in rough build effort.

| # | Gap | User impact if unaddressed | Rough effort |
|---|---|---|---|
| 1 | **No Forward** | A CEO cannot forward a vendor/client email to a colleague, lawyer, or accountant without leaving the app to retype it — this is a core, daily-use action in any mail client | Medium |
| 2 | **No Reply-All** | Multi-recipient business threads (e.g. CC'd counterparties, internal + external on one thread) silently drop everyone but the original sender on reply — recipients get dropped from a conversation without anyone noticing | Small-Medium (headers already computed; just needs a second entry point + the accumulate-all-recipients branch) |
| 3 | **No multi-select bulk actions on the thread list** | Clearing 30 newsletters or archiving a week of resolved threads must be done one row at a time — the single highest-friction gap vs. Gmail/Outlook muscle memory | Medium-Large (needs selection state, a bulk toolbar, and batched server actions) |
| 4 | **Manual replies carry no quoted context** | Anyone who skips AI Draft and just types a quick reply sends the recipient a message with zero visible history of what they're replying to — looks broken to an external recipient reading it outside a threaded view | Small-Medium (quote-block templating off the already-fetched message HTML) |
| 5 | **No contact/people autocomplete in To/Cc** | Every recipient must be typed out in full from memory; the `MailContact` index already exists and is unused for this | Small (index exists; needs a dropdown UI + wiring into the existing `findContacts`) |
| 6 | **Undo Send is dead code, not a feature** | `undoUntil` gives a false sense that this is handled; a fat-fingered send goes out immediately with no recall window at all | Small-Medium (delay the flush, add a toast + cancel action reusing the existing outbox/cancel plumbing) |
| 7 | **No drag-and-drop attachments** | Minor daily friction — every attach requires the file-picker dialog | Small |
| 8 | **No keyboard-shortcut help overlay (`?`)** | The 6 shortcuts that do exist are undiscoverable to a new user of the app | Small |
| 9 | **No print** | Occasionally needed for compliance/record-keeping (e.g. printing an agreement email for signature/filing) | Small |
| 10 | **Search operators not supported** | Gmail-trained muscle memory (`from:`, `has:attachment`, `is:unread`) silently degrades to plain-text search instead of filtering — no error, just wrong results | Medium (parser + mapping onto existing Prisma filters, ideally layered under the existing AI-expand path) |
| 11 | **No out-of-office / vacation responder** | If the CEO travels, incoming senders get no autoreply — this is a standard expectation for any real inbox | Medium (needs either SMTP-side auto-reply logic or `managesieve` Sieve integration on the mail server) |
| 12 | **Filters are label-only** | Standing rules can't archive, move, delete, or forward — only tag; a CEO wanting "auto-archive all mail from noreply@" cannot do it | Medium (extend `MailLabelRule` action model + apply at ingest and possibly retroactively) |
| 13 | **No "download all" / inline image preview for attachments** | Multi-attachment messages must be downloaded one file at a time; images never preview before download | Small-Medium |
| 14 | **No desktop/browser push notifications** | The IMAP IDLE + SSE plumbing already delivers real-time events to the open tab, but nothing surfaces a notification if the tab isn't focused | Small (the hard part — real-time delivery — is already built) |
| 15 | **No plain-text compose mode** | Rare need, but occasionally useful for terse or copy-paste-sensitive replies | Small |
| 16 | **No permanent delete / empty Trash** | Currently everything is reversible (arguably a feature, not a bug) — but a CEO who expects "Trash" to eventually mean gone has no way to actually reclaim space or truly delete something | See destructive-action callout below — do not build without explicit sign-off |
| 17 | **No nested folder tree UI** | Real IMAP folder hierarchy exists but renders flat — minor, since this app's Smart Inbox/labels model is arguably a better fit for a single power user anyway | Small, low priority |

---

## Phased Implementation Roadmap

Only real gaps are scoped here — items already "Done" or "N/A" above are excluded. Ordered by value/effort, not strictly by the numbering above (a few small wins are grouped together even if their gap-list rank differs).

### Phase 1 — Core compose parity (highest daily-use value)
Closes gaps #1, #2, #4.

- **Forward**: new `forwardThreadAction` mirroring `trashThreadAction`'s account/thread-lookup pattern in `src/actions/mail.ts`; client-side `composeForward()` in `mail-client.tsx` alongside `composeNew()`/reply-open, pre-filling `Fwd: <subject>`, blank To, and an embedded quote block (see next bullet) plus re-attaching the original message's `MailAttachment` rows (need a copy-to-outbox-attachment step, since compose attachments currently only come from fresh uploads via `uploadComposeAttachmentAction`).
- **Reply-All**: extend `replyContext()` (`mail-client.tsx:233-272`) with a `mode: "reply" | "reply-all"` param that, for `reply-all`, unions the original `to`+`cc` minus self into the new Cc; add a second button/shortcut (`a`) next to the existing reply entry points (the `r` case in the shortcut switch, `mail-client.tsx:1112`, and the reply button(s) around `4042`/`4053`/`4142`/`4151`).
- **Quoted context on manual reply**: build an attribution-line + blockquote template (`On <date>, <fromName> <<fromAddress>> wrote:` + the last message's `bodyHtml`) and prepend it (collapsed by default, matching Gmail's "N older messages" convention) below the empty compose area in both the reply-open path (`mail-client.tsx:1355-1376`) and `openLocalDraft`. Reuse the existing "quoted history" collapse styling from `message-reader.tsx` for visual consistency.
- **Files**: `src/actions/mail.ts`, `src/components/mail/mail-client.tsx`, `src/lib/mail/mime.ts` (attachment re-copy helper). **Schema**: none required — `MailOutbox.attachmentsJson` already supports multiple entries.

### Phase 2 — Bulk actions & shortcut discoverability
Closes gaps #3, #8.

- **Multi-select**: add per-row checkboxes to the thread list, a `selectedThreadIds: Set<string>` state, a "select all on page" control (respecting the existing pagination), and a contextual bulk-action bar (Archive / Trash / Move to… / Apply label) that calls the *existing* single-thread server actions in a loop or via a small new batched wrapper (`archiveThreadsAction(ids: string[])`, etc., to avoid N sequential round-trips).
- **Shortcut-help overlay**: bind `?` in the existing `shortcutRef.current` switch (`mail-client.tsx:1111`) to a small modal listing the current shortcut set (also a natural place to add the Reply-All/Forward/Delete/Undo bindings from Phase 1/3 as they land).
- **Files**: `src/components/mail/mail-client.tsx`, `src/actions/mail.ts` (batched action wrappers). **Schema**: none.

### Phase 3 — Contact autocomplete & Undo Send
Closes gaps #5, #6.

- **Contact autocomplete**: new lightweight server action wrapping the already-built `findContacts`/`resolvePersonAddress` (`src/lib/mail/contacts.ts`) scoped for compose (return `{name, address}[]` for a partial-name/partial-address prefix); a dropdown component under the To/Cc/Bcc inputs (`mail-client.tsx:4260-4261`, `4636-4637`) with keyboard nav (arrow keys + Enter/Tab to accept), debounced like the existing search-input pattern.
- **Undo Send**: make `sendMailAction` (`src/actions/mail.ts:624`) actually respect `undoUntil` for immediate sends — hold the row at `status: "QUEUED"` and defer the `flushOutboxItem()` call (e.g. a short `setTimeout`-driven flush on the client with a visible countdown + Cancel button reusing `cancelScheduledSend`, or a server-side delayed-queue flush) instead of calling `flushOutboxItem` synchronously in the same request. Needs care: the current code fires `syncCeoMail()` right after flush, so the UI/status messaging around "Sent" vs. "Sending in 5s, Undo?" needs to change together.
- **Files**: `src/lib/mail/contacts.ts` (new export), `src/actions/mail.ts`, `src/components/mail/mail-client.tsx`. **Schema**: none — `undoUntil` already exists, just needs to be honored.

### Phase 4 — Attachments UX & print
Closes gaps #7, #9, #13.

- **Drag-and-drop**: `onDragOver`/`onDrop` handlers on the compose body wrapper in both docked and fullscreen composer modes, routing dropped `FileList` through the existing `onPickAttachments()` (`mail-client.tsx:1678`).
- **Inline image preview + download-all**: in `message-reader.tsx`, branch attachment rendering on `contentType.startsWith("image/")` to show a thumbnail (lazy-loaded via the existing `/api/mail/attachments/{id}` route) instead of a generic chip; add a "Download all" link that either zips server-side (new API route) or fires sequential downloads client-side for messages with 2+ attachments.
- **Print**: a `window.print()` button in `message-reader.tsx` plus a `@media print` stylesheet rule scoping visibility to the open message/thread only.
- **Files**: `src/components/mail/mail-client.tsx`, `src/components/mail/message-reader.tsx`, possibly a new `src/app/api/mail/attachments/zip/route.ts`. **Schema**: none.

### Phase 5 — Search operators & richer filters
Closes gaps #10, #12.

- **Search operators**: a small parser layer in front of `threadQuery` that recognizes `from:`, `to:`, `has:attachment`, `is:unread`, `is:starred`/`is:important`, `before:`/`after:`, `label:` and translates them into structured Prisma filter fragments (composable with the existing `messageFieldMatchOr` in `src/lib/mail/mail-search.ts`), falling back to the current AI-expand/keyword path for the free-text remainder of the query.
- **Richer filters**: extend `MailLabelRule`'s `matchJson`/action model (`prisma/schema.prisma`, `src/lib/mail/ai/label-rules.ts`) beyond "add label" to also support archive/move-to-folder/mark-read, applied in `applyStandingLabelRules()` at ingest. **Schema change**: add an `action` + `actionValue` (or a small JSON actions array) column to `MailLabelRule`.
- **Files**: `src/lib/mail/mail-search.ts`, `src/lib/mail/ai/label-rules.ts`, `src/actions/mail.ts` (`upsertLabelRuleAction`), `prisma/schema.prisma`.

### Phase 6 — Out-of-office, notifications, nested folders
Closes gaps #11, #14, #17. Lower urgency / more infra-dependent.

- **Out-of-office**: requires deciding between (a) server-side Sieve vacation script pushed via ManageSieve (the mail server already runs docker-mailserver, which supports Sieve, per `ai-email-client-plan.md`'s "ManageSieve 4190 in-container only — not used by app" note — this would be the first consumer of it) or (b) an app-side auto-reply-on-sync-detected-new-mail approach (weaker, doesn't work if the app/server isn't running). Sieve is the correct answer for reliability but is a bigger infra lift (needs ManageSieve exposed to the app, currently explicitly not wired).
- **Browser notifications**: hook the existing SSE handler for `/api/mail/live` (`idle-watcher.ts` → live-bus) to request `Notification` permission once and fire a notification on new-mail events when the tab is backgrounded.
- **Nested folder tree**: replace the flat `pickLabelFolders()` list with a tree built from folder `path` delimiters, with expand/collapse state per parent.
- **Files**: `src/lib/mail/idle-watcher.ts`, `src/components/mail/mail-client.tsx`, possibly a new `src/lib/mail/vacation.ts` + ManageSieve client for the out-of-office piece.

### Explicitly deferred / not recommended to build speculatively

- **Read receipts** (`Disposition-Notification-To`): low value for a single-CEO inbox where the AI-driven follow-up/reminder system already does a better job of tracking "did they respond" than a receipt (which recipients can decline anyway on every reference client). Build only if specifically requested.
- **Plain-text compose mode**: rare need; low priority, small effort — fold into whichever phase touches `composer.tsx` next rather than a dedicated phase.
- **Multi-account/multi-identity support**: explicitly against the product thesis (single CEO mailbox). Do not build unless the product direction changes.

---

## Destructive / Irreversible Actions — Requires Explicit Human Sign-Off

Per the product thesis already established in `ai-email-client-plan.md` ("human confirms irreversible actions"), the following must **never** be silently automated, defaulted-on, or shipped without an explicit conversation with the CEO first:

1. **Any Trash auto-purge / retention-expiry job** (the "Gmail deletes Trash after 30 days" pattern). This app currently has **no such job** — nothing hard-deletes mail today. If this is ever built:
   - It must default to **off**, with the retention window explicitly configured by the CEO, not inherited from Gmail's 30-day default without discussion.
   - It must run against `trashedAt` (the correct field — already isolated from `lastMessageAt` for exactly this purpose) with a wide safety margin and a dry-run/preview mode before the first live run.
   - It should log every purge to `AuditLog` (the pattern already used elsewhere in this codebase, e.g. `MAIL_SEND`/`MAIL_SCHEDULE` entries in `sendMailAction`) so a purge is always reconstructable/auditable after the fact.
   - Real business email (invoices, contracts, legal correspondence) can end up in Trash by accident (fat-finger, wrong bulk-action target once Phase 2 multi-select ships) — an unattended purge job compounds that mistake into permanent, unrecoverable data loss.
2. **Any future "Delete forever" / "Empty Trash" UI action** (gap #16): must keep the existing confirm-dialog pattern already used for Send (`window.confirm` in `sendCurrentDraft`, `mail-client.tsx:1710`) at minimum, and arguably a stronger double-confirm (type-to-confirm or a second modal) given there is currently no undo path once IMAP `\Deleted`+expunge actually runs.
3. **Any Sieve-based out-of-office / auto-reply / auto-forward rule** (Phase 6): a misconfigured vacation responder can leak information externally (e.g. replying to spam/phishing senders, confirming the mailbox is unattended) or loop with another auto-responder. Ship with a manual on/off toggle, a date-range expiry the CEO must set (never "on indefinitely" by default), and a domain/sender exclusion list (at minimum, exclude mailing lists and no-reply addresses) before going live.
4. **Any change that broadens `MailLabelRule` actions to include delete/archive/forward** (Phase 5): a bad standing rule (e.g. a mistyped `fromContains` match) could silently archive or delete real mail on every sync going forward, invisibly, for weeks before noticed. Any such rule with a delete/archive action should require an explicit one-time confirmation when created/enabled, and ideally a "dry run — show what this would have matched over the last 30 days" preview before going live.

None of the above should be scoped into a phase or implemented without a direct sign-off conversation, independent of how small the code change looks.

---

## Sources

- [101 Gmail Keyboard Shortcuts and Hotkeys (2026)](https://emailanalytics.com/101-gmail-keyboard-shortcuts-and-hotkeys-every-gmail-user-needs-to-know/)
- [Gmail Shortcuts Cheat Sheet (2026)](https://www.getinboxzero.com/blog/post/gmail-shortcuts-cheat-sheet)
- [Gmail Search Operators: The Complete 2026 List](https://leavemealone.com/blog/gmail-search-operators/)
- [50 Gmail Search Operators and How to Use Them](https://hiverhq.com/blog/top-gmail-search-operators)
- [Streak — How to empty the trash in Gmail and permanently delete messages](https://www.streak.com/post/how-to-empty-trash-in-gmail)
- [Manage email storage with auto delete settings — Google Workspace Help](https://support.google.com/a/answer/151128?hl=en)
- [Thunderbird Support — How do I change the "On [date], [sender] wrote:" line in replies?](https://support.mozilla.org/en-US/questions/1013415)
- [Thunderbird Support — Format of quoted original message in reply emails](https://support.mozilla.org/en-US/questions/1307927)
- [How to Undo Send in Outlook (Every Version, 2026)](https://www.usecarly.com/blog/how-to-undo-send-in-outlook/)
- [How to Recall an Email in Outlook (2026 Guide)](https://www.usecarly.com/blog/how-to-recall-email-in-outlook/)
- [Roundcube Webmail: Comprehensive Features and Setup Guide — Contabo](https://contabo.com/blog/roundcube-webmail-comprehensive-features-and-step-by-step-setup-guide/)
- [Sender Identities — Roundcubemail documentation](https://docs.roundcube.net/doc/help/1.1/en_US/settings/identities.html)
- [Signatures, identities and responses in Roundcube — catalyst2](https://www.catalyst2.com/knowledgebase/roundcube/signatures-identities-and-responses-in-roundcube/)
- [roundcubemail managesieve vacation settings docs (GitHub)](https://github.com/roundcube/roundcubemail/blob/master/plugins/managesieve/helpdocs/en_US/settings-vacation.rst)
- [Understanding Conversation View in Google Mail — Stony Brook IT](https://it.stonybrook.edu/help/kb/understanding-conversation-view-in-google-mail)
- [Set up & use Gmail offline — Gmail Help](https://support.google.com/mail/answer/1306849?hl=en)
- [Report spam in Gmail — Gmail Help](https://support.google.com/mail/answer/1366858?hl=en)
- [Avoid & report phishing emails — Gmail Help](https://support.google.com/mail/answer/8253?hl=en)
- [Request or return a read receipt — Gmail Help](https://support.google.com/mail/answer/9413651?hl=en)
- [Gmail Read Receipts: How They Work in Google Workspace — Exclaimer](https://exclaimer.com/email-signature-handbook/guide-to-understanding-gmail-read-receipts/)
- [Set categories, flags, or reminders — Microsoft Support](https://support.microsoft.com/en-us/office/set-categories-flags-or-reminders-a894348d-b308-4185-840f-aff63063d076)
- [Organize your inbox with Archive, Sweep, and other tools in Outlook on the web — Microsoft Support](https://support.microsoft.com/en-us/outlook/organize-your-inbox-with-archive-sweep-and-other-tools-in-outlook-on-the-web)
- [Use rules to create an out of office message in Outlook — Microsoft Support](https://support.microsoft.com/en-us/outlook/use-rules-to-create-an-out-of-office-message-in-outlook)
- [Using Identities — Thunderbird Help](https://support.mozilla.org/en-US/kb/using-identities)
- [Send or unsend Gmail messages — Gmail Help](https://support.google.com/mail/answer/2819488?hl=en)
- [How to Forward Attachments in Gmail — CLRN](https://www.clrn.org/how-to-forward-attachments-in-gmail/)
