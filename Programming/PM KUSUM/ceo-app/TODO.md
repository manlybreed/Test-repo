# Mail client TODO

- [ ] Merge previous branch (`feature/mail-ux-feedback-round2`) to main, then start on the items below
- [ ] Send a mail to akshayroyal678@gmail.com; check on the server whether it was really sent. Check draft and trash mail in-app vs. on the server and confirm they're coherent with each other
- [ ] Add a mail-sent sound with a message, plus an animation of the mail sending/flying
- [ ] In the reply, show a "..." ("show trimmed content") affordance on hover, for both reply and reply-all — cleaner than the current UI
- [ ] Check desktop notifications and verify they're actually working
- [ ] Combine the undo and mail-sent toast into one: add a close (X) button, auto-disappear after the undo window (10s/20s per setting), and if close is pressed, send the mail immediately instead of undoing
- [ ] Allow writing a new message directly from the "Select a thread" empty state, not just via the header Compose button

---

## Ruthless founder UX audit — 2026-07-26

Full live-browser walkthrough (inbox, thread reading, reply/forward/compose,
search, bulk actions, settings, keyboard shortcuts, mobile viewport),
benchmarked against Superhuman / Gmail / Outlook / Thunderbird / Vercel-level
polish. Context: `docs/mail-feature-parity-plan.md`'s entire 6-phase roadmap
(Forward, Reply-All, quoted context, bulk multi-select, shortcut help,
contact autocomplete, working Undo Send, drag-and-drop attachments, inline
image previews, download-all, print, search operators, desktop
notifications, nested folders, vacation responder) was **already shipped**
by the time this audit started — so this pass is about execution quality,
not feature checklists.

### Achievements (genuinely ahead of the reference clients)

- Full feature-parity roadmap shipped end-to-end — every gap in the parity
  plan's Phase 1-6 is closed and working (verified live: Forward, Reply-All,
  bulk multi-select with a real toolbar, `?` shortcut-help overlay, contact
  autocomplete dropdown, Gmail-style search operators returning in ~85ms).
- AI-native features with no equivalent in Gmail/Outlook/Thunderbird/
  Roundcube: Smart Inbox + AI smart labels, AI-assigned P1-P4 priority
  driving real triage (not cosmetic), commitment/task extraction, follow-up
  nudges, one-click Categorize/Digest/Follow-ups/Cleanup/Style, per-message
  AI Draft/Summarize/Shorten/Meeting-ICS, attachment summarization, and an
  always-available "Ask mailbox…"/recall bar.
  IMAP IDLE + SSE live sync, genuinely ahead of typical webmail polling.
- Superhuman-style focus mode: opening a thread collapses the threads
  column so the reader takes the space; fullscreen compose is clean and
  distraction-free (no sidebar chrome).
- Bulk-select checkboxes correctly `stopPropagation` so selecting never
  fires the row's open-thread handler.
- Keyboard-shortcut help overlay is well organized and lists the search
  operator grammar inline — better discoverability than any of the 4
  reference clients offer by default.

### Bugs found and fixed this pass

1. **[CRITICAL, FIXED]** Collapsible-quote gap silently dropped reply text
   from the sent mail. The `CollapsibleBlockquote` NodeView's wrapper div
   (everything except the "•••" toggle and the blockquote itself) was never
   marked `contentEditable=false`, so a click landing in the sliver of DOM
   between the toggle and the blockquote let the browser place a native
   caret there. Typing at that point inserted a real DOM text node that
   rendered on screen — but `ignoreMutation` discarded it before it ever
   reached the ProseMirror document model, so `editor.getHTML()` (what
   actually gets sent) silently omitted it. A user could type a reply,
   watch it appear on screen, hit Send, and the recipient would get an
   email missing that text with no warning. Fixed by marking the wrapper
   non-editable and the blockquote explicitly editable (a standard
   "non-editable atom with an editable content island" NodeView pattern).
   Verified live both ways: typing in the gap is now an inert no-op, and
   typing in the real reply body still lands correctly.
   [composer.tsx](src/components/mail/composer.tsx) —
   `fix/mail-quote-node-caret-trap`, merged to main.
2. **[FIXED]** Empty-state copy had a grammar break: "AI triage, summarize,
   draft, and ask sit on the right…" → "…and ask all sit on the right…".
   [mail-client.tsx](src/components/mail/mail-client.tsx) —
   `fix/mail-copy-and-a11y-labels`, merged to main.
3. **[FIXED]** Thread-list row buttons and bulk-select checkboxes had no
   distinguishing accessible name — every row announced as a bare
   "button"/"Select thread" to a screen reader, so a screen-reader user
   couldn't tell threads apart without visually scanning. Both now include
   sender + subject. Same commit as above.
4. **[FIXED]** Forward — one of the most common daily actions in any mail
   client — was only reachable through the "More" dropdown, filed under a
   header literally labeled "AI actions" alongside Triage/Summarize/AI
   Draft, even though it isn't AI-related at all. Promoted to a first-class
   icon button next to Reply / Reply-all / Fullscreen reply (matching
   Gmail/Outlook/Thunderbird/Superhuman convention) and removed the
   duplicate menu entry. `feature/mail-forward-toolbar-button`, merged to
   main.
5. **[CRITICAL, FIXED — found by the user right after this audit shipped]**
   Trash/Archive/Move-to-folder moved the message correctly on the IMAP
   server, but locally just hard-deleted the MailMessage/MailThread rows
   and relied on a fire-and-forget, non-awaited, error-swallowed
   full-mailbox resync to reimport the message into its new folder. That
   resync scans every folder over a fresh IMAP connection and can easily
   take many seconds with no "still syncing" indicator — so trashing a
   thread and immediately checking Trash showed nothing there, identical
   to data loss. Reported live: "i moved one thread to trash, can't find
   it." Fixed by using `messageMove`'s UIDPLUS uidMap (old UID -> new UID)
   to repoint the local rows at the target folder/UID in the same
   request, instead of deleting and hoping. Verified live for both Trash
   and Archive by querying the DB directly right after each action and
   confirming the thread appears in its new folder instantly.
   [imap-mailbox.ts](src/lib/mail/imap-mailbox.ts) —
   `fix/mail-trash-archive-move-lost-cache`, merged to main.
6. **[FIXED]** ~15 debug/test emails from this session's own QA work
   ("Close button tight-timing test", "Send FX debug marker test", "Console
   debug 2", etc.) were sitting in the live inbox mixed in with real
   correspondence. Bulk-selected and moved to Trash (reversible) via the
   app's own bulk-select UI.

### Issues / backlog (not implemented this pass — flagged for a deliberate follow-up)

- **No mobile-responsive layout at all.** At a 375px-wide viewport the
  desktop 3-column layout does not adapt — the full desktop sidebar stays
  expanded, the AI action row wraps into an overlapping vertical stack, and
  the mailbox/threads columns are squeezed into an unusable sliver with
  horizontal overflow. This is a large, multi-day rework (collapsible
  sidebar drawer, breakpoint-driven single-column view, touch-sized
  targets) — flagging rather than rushing a partial fix. Worth doing if the
  CEO actually checks mail from a phone.
- **No unified Settings page.** Auto-label rules / Signatures / Out of
  office / Keyboard shortcuts / Desktop notifications / Undo-send window
  all live as entries in one flat dropdown menu. Fine at 6 items; won't
  scale if more settings get added later.
- Contact-autocomplete dropdown appears correctly on typing, but keyboard
  accept (arrow-down-then-Enter) wasn't verified working in this pass —
  worth a dedicated pass with real keyboard-driven interaction testing.
- `showCompose` / `composeFullscreen` are still two independently-tracked
  booleans rather than a single `'closed' | 'docked' | 'fullscreen'` enum —
  flagged as the root cause of a prior undo/fullscreen bug class (already
  fixed for the cases found so far) and still the more robust long-term
  fix. Deferred pending explicit sign-off since it's a real refactor, not a
  bug fix.

---

## Reported bugs

- [x] **[FIXED] AI attachment summary showed empty for an attachment that
  does exist.** In the "Sky volt Raisar Pvt Ltd,Component A,Jaipur-Part 1"
  email thread, running AI summary on Santosh Yadav's Net Worth Certificate
  returned an empty/useless summary even though the file was genuinely
  attached and present. Root cause: `pdf-parse` only reads a PDF's
  embedded text layer. This certificate (like most of the KYC PDFs in this
  thread — Aadhar cards, PAN cards, net worth certificates, ID photos) is a
  scanned/photographed document with no text layer at all, so extraction
  "succeeded" with 2 stray characters instead of failing outright — and
  `summarizeAttachment` happily fed those 2 characters to Claude, which
  naturally had nothing to summarize. Image attachments (.jpeg/.png) had
  the identical problem one step earlier: they never go through text
  extraction at all (always `SKIPPED`), so AI summary always returned "No
  extractable text." for every photo attachment in the mailbox.
  Fixed by adding a vision fallback: when extracted text is empty or below
  a 30-character usability threshold, the attachment's actual PDF/image
  bytes are now sent directly to Claude (`document`/`image` content
  blocks) instead of relying on the text layer — Claude reads scanned
  documents directly, no OCR pipeline needed. Capped at 20MB per file to
  stay under API request limits; falls back to "No extractable text." only
  if the file is missing, too large, or an unsupported type.
  Verified live against the real mailbox: Santosh Yadav's Net Worth
  Certificate now returns "...Net Worth: ₹380.61 Lakh... signed by CA
  Kamal Kant Vashisht... UDIN: 26464645TMUCXA5505..." (previously empty);
  same for Divya Kumawat's certificate in the same thread. Confirmed no
  regression on a normal text-PDF (Sky Volt Raisar-AOA.pdf, 41K chars of
  extracted text) — still summarized via the original text path, unchanged.
  [claude.ts](src/lib/mail/ai/claude.ts),
  [attachments.ts](src/lib/mail/ai/attachments.ts) —
  `fix/mail-attachment-summary-vision-fallback`, merged to main.
- [x] **[FIXED] Threads column showed stale Inbox content after trashing
  from All Inbox.** Delete a thread while viewing All Inbox, then land
  on/click Trash: the Mailboxes sidebar correctly highlighted Trash as
  selected, but the Threads column kept rendering the old All Inbox list.
  Root cause: two long-lived effects — the SSE live-update listener
  (`useEffect(..., [configured])`) and the fallback poll's `runSync` —
  captured `reloadActiveView` in a closure at mount/subscribe time and
  never refreshed it, so a background-sync-triggered reload fired *after*
  the user had switched folders still reloaded whichever mailbox was
  active back when the effect first subscribed, silently overwriting the
  correct view. A same-request-ordering sequence guard (added first, for a
  narrower race between a mutation's own reload and a folder switch) was
  necessary but insufficient here, since this reload wasn't out of order —
  it just targeted the wrong folder. Fixed by routing both call sites
  through a ref that's reassigned to the latest `reloadActiveView` closure
  every render, so any deferred reload always targets whatever mailbox is
  actually selected at the moment it fires. Verified live by rapid-fire
  trashing a thread and immediately switching to Trash, then waiting past
  a full background-resync cycle (12+s) to confirm the correct Trash
  content never got clobbered.
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-stale-folder-after-trash`, merged to main.
- [x] **[FIXED] Threads column kept its old scroll position when switching
  mailboxes.** Scroll down in All Inbox, then click Trash (or any other
  mailbox): the new folder's thread list rendered starting from wherever
  the previous folder happened to be scrolled to, instead of resetting to
  the top. Reported 2026-07-27. Fixed with a `useEffect` keyed on
  `[activeFolder, activeSmartLabel, threadPage]` that scrolls the Threads
  `<ul>` back to the top — deliberately a separate effect from data
  fetching (not inside `reloadActiveView`, which is also called by
  background live-sync refreshes of the *same* view) so a passive sync
  tick never yanks your scroll position while you're mid-read. Verified
  live: scrolled 400px into Inbox, switched to Trash, landed at
  `scrollTop: 0`; then scrolled within Trash and waited 8s past a sync
  tick to confirm position held steady.
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-scroll-reset-on-folder-switch`, merged to main.
- [x] **[FIXED] AI Draft didn't control To/Cc — couldn't resolve a
  name/email mentioned in the instruction.** In a fresh compose with To
  left blank, typing "send mail to Akshay on akshayroyal678@gmail.com with
  some content" into the AI assist brief and clicking Draft: the To field
  stayed completely empty, and the drafted body didn't address Akshay at
  all — it hallucinated a greeting to an unrelated person ("Dear Surajbhan
  ji") pulled in from irrelevant retrieved mail context. Reproduced exactly
  as described, then fixed. Root cause: `draftNewMail`
  (`src/lib/mail/ai/draft.ts`) only ever used whatever `to` the client
  already had typed — it never parsed a recipient out of the free-text
  intent, and `runAiDraft()` (`mail-client.tsx`) never touched the To field
  either. With `to` empty, retrieval fell back to a loose, unscoped query
  that surfaced unrelated threads, and nothing in the prompt stopped Claude
  from treating that as grounding for a greeting.
  Fixed with `resolveDraftRecipients()`: an explicit email address in the
  brief always wins (deterministic regex match, no guessing); failing
  that, a capitalized name after "to"/"for" is resolved against the
  contact index the same way "recall NAME" already does. `runAiDraft()`
  now calls this and populates To when it's empty, before drafting.
  Also hardened `draftNewMail`'s system prompt to only address the
  recipient by a name that appears in `knownClient`/`knownContact`/the
  instruction itself — never inferred from unrelated `priorMail` context —
  and added a `knownContact` lookup (the existing `clientHit` only checked
  the business-`Client` table, missing personal contacts entirely).
  Verified live with the exact reported prompt: To now auto-fills
  `akshayroyal678@gmail.com` and the draft opens "Hi Akshay," instead of a
  hallucinated name.
  [draft.ts](src/lib/mail/ai/draft.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-ai-draft-recipient-and-ask-history`, merged to main.
- [x] **[FIXED] "Ask mailbox" had no conversation memory — couldn't handle
  follow-up questions.** Each Ask query was answered independently with no
  reference to the previous question/answer in the same session, so a
  natural follow-up ("and when did he send that message?") was treated as
  a fresh, context-free query. Root cause: `askMailbox`
  (`src/lib/mail/ai/ask.ts`) took only the current `question` — no history
  parameter existed anywhere in the chain, and the client kept just a
  single `askA` answer, never an array of turns.
  Fixed by adding an `AskTurn[]` history (capped at the last 6 turns): the
  client now keeps `askHistory` and sends it on every Ask; the server
  folds the previous turn's question+answer into the retrieval query (bare
  follow-ups like "and when was that sent?" carry almost no retrievable
  keywords on their own) and passes a `<conversation_so_far>` transcript to
  Claude — explicitly scoped to resolving pronouns/references only, with
  every actual fact still required to cite mail_data exactly as before.
  Added a visible scrollback of prior turns above the current answer and a
  "Clear conversation" button, so the context being carried forward is
  actually visible, not just a backend change.
  Verified live: asked "What did Ranjeet Kumar want regarding the Kotak
  Mahindra current account?", got a grounded answer; followed up with
  "and when did he send that message?" (no name repeated) and got back the
  correct dates (2026-07-22, 2026-06-19) — confirming "he"/"that message"
  correctly resolved against the prior turn.
  [ask.ts](src/lib/mail/ai/ask.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-ai-draft-recipient-and-ask-history`, merged to main.
