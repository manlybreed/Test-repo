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

---

## Voice commands for AI assist — 2026-07-27

- [x] **[DONE] Every AI-assist field in Mail now supports voice commands.**
  Scoped to Mail only (confirmed with the user — the rest of the CEO
  Command Center app wasn't touched). Added a mic button to the AI Draft
  brief, the draft refine/exact-change box, and the Ask mailbox bar: press
  it, speak one instruction, and — like a real voice command rather than
  plain dictation — it auto-runs the corresponding action (Draft / Apply /
  Ask) as soon as the browser detects you've stopped talking, instead of
  just filling the field and waiting for a separate click.
  Built on the Web Speech API (`useSpeechToText` in the new
  [use-speech-to-text.ts](src/components/mail/use-speech-to-text.ts)) —
  supported in Chrome/Edge; the mic button renders nothing at all on
  Firefox/Safari rather than showing a dead control. `runAiDraft` and
  `applyDraftRefine` gained an optional override-text parameter so a
  just-finished voice command can act on its own transcript immediately,
  instead of reading state that the triggering `setState` call hasn't
  flushed into that render's closure yet.
  Verified live: real microphone capture can't be exercised in this
  sandboxed environment (device access is blocked), so the recognizer's
  constructor was mocked to fire a synthetic final transcript through the
  actual component wiring — confirmed for all three fields that the
  transcript lands in the field and the corresponding action (Ask/Draft/
  Refine) fires and returns a real result, and that the mic correctly
  resets to idle afterward.
  Noted in passing, not fixed here (separate from voice input): dictating
  a brief with no recipient mentioned at all can still occasionally drift
  to a hallucinated greeting name despite the "use a neutral greeting if
  none is given" instruction added in the AI Draft fix above — the
  instruction reduces this but a brief with zero recipient signal is a
  different case from the one that was reported and fixed.
  [use-speech-to-text.ts](src/components/mail/use-speech-to-text.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `feature/mail-voice-commands`, merged to main.

---

## Follow-ups — 2026-07-27

- [x] **[FIXED — root cause, not output patching] AI Draft hallucinated a
  greeting name when no recipient was given at all.** Reported with a
  screenshot: brief "introduce BluRidge Consulting and propose a 20 minute
  call" with To empty produced "Dear Surajbhan ji," — a name pulled from
  unrelated retrieved mail context, not from the instruction.
  Root cause found in `packChunks`/`retrieveMail`
  (`src/lib/mail/ai/retrieve.ts`): when there's no known recipient,
  `draftNewMail` still runs an unscoped retrieval for topic/style grounding,
  and each retrieved chunk's `bodyExcerpt` is up to 1200 raw characters of
  someone else's actual email — including *that* email's own real "Dear
  X," salutation. That text sat in the prompt as `priorMail` next to a
  single soft sentence saying not to use it for the greeting; the model,
  asked to write something greeting-shaped with a real name sitting right
  there in context, sometimes copied it anyway. A single sentence
  competing against vivid, structurally-identical context in the same
  prompt is a weak instruction, not a fix.
  Fixed by removing the ambiguity instead of asking the model to resolve
  it: `recipientName` is now resolved server-side *before* the prompt is
  built (from the contact/client lookup) into one authoritative field —
  the model's only job is to check that one value, not reconcile three
  separate fields into an inference. The retrieved grounding data was
  renamed `priorMail` → `topicReference` and explicitly reframed in the
  system prompt as "other people's past correspondence, not a conversation
  with this recipient — recipientName always overrides anything you see
  in here." No output regex, no post-processing — Claude simply isn't
  given a plausible reason to reach for a name that isn't recipientName
  anymore.
  Verified live: reran the exact reported brief 3 times back-to-back —
  every run opened "Hi," with no invented name. Confirmed no regression on
  the explicit-recipient case (`akshayroyal678@gmail.com` in To): now
  correctly opens "Dear Akshay Royal," using the real resolved contact
  name, an improvement over the plain "Hi Akshay," from before.
  [draft.ts](src/lib/mail/ai/draft.ts) —
  `fix/mail-ai-draft-greeting-root-cause`, merged to main.
- [x] **[DONE] Mail-wide voice command**, available as soon as the Mail tab
  is open — not scoped to a single AI-assist field like the three shipped
  earlier. Added a mic button in the header (next to Compose/Refresh) that
  parses a spoken utterance into a command and executes it directly:
  "compose a new email", "open trash"/"go to sent"/"show me the drafts",
  "search for X", "archive this"/"delete this", "reply"/"reply all"/
  "forward". Anything that doesn't match one of those falls through to
  Ask-mailbox with the whole utterance as the question — so no command is
  ever "lost", worst case it's answered as a natural-language question.
  Deliberately deterministic keyword/pattern matching
  ([voice-commands.ts](src/lib/mail/voice-commands.ts), unit tested in
  voice-commands.test.ts) rather than another Claude round-trip for
  classification — instant, free, and has no hallucination surface of its
  own.
  Verified live (same synthetic-transcript technique as the field-level
  voice commands, since real mic capture is blocked in this sandbox):
  "open trash" switched to Trash and rendered its contents; "compose a new
  email" opened fullscreen compose; "search for HackerNoon" populated the
  search box and returned matching threads; "archive this" archived the
  open thread (confirmed gone from the Inbox list); a natural question
  ("what did Ranjeet Kumar want...") correctly fell through to Ask and
  returned a grounded answer.
  [voice-commands.ts](src/lib/mail/voice-commands.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `feature/mail-wide-voice-command`, merged to main.

---

## Follow-up — 2026-07-27 (second AI Draft greeting report)

- [x] **[FIXED — plumbing bug, not a prompt/NLU issue] AI Draft still
  didn't greet a recipient named explicitly in the instruction, in a
  differently-shaped brief.** Reported with a screenshot: "draft a mail to
  md@thebluridge.com belonging to Baneshwari Royal regarding the sample
  mail" opened "Hi," with the body saying "I am reaching out on behalf of
  Baneshwari Royal" — treating the named person as a third party instead
  of the recipient.
  Root cause verified directly (ran the exact regex against the exact
  string before touching any code): `resolveDraftRecipients`
  (`src/lib/mail/ai/draft.ts`) *already* correctly extracts "Baneshwari
  Royal" as `knownName` from this brief — the existing "name after to/for"
  pattern happens to match "...belonging **to** Baneshwari Royal" further
  in the sentence. The extraction was right; the bug was that
  `runAiDraft()` (`mail-client.tsx`) computed `resolved.knownName` and then
  never passed it anywhere — `draftNewMailAction`/`draftNewMail` had no
  parameter to receive it, and independently tried to re-derive a name
  from contact/client DB records alone, which fail for any address (like
  this test one) that isn't already a known contact.
  Fixed by threading it through: added `recipientNameHint` to
  `draftNewMailAction`/`draftNewMail`, used as a fallback in the
  `recipientName` priority order (confirmed contact/client name still wins
  if one exists; the hint only fills in when there's no DB record to
  confirm a name from). Also found and fixed a second-order inconsistency
  while stress-testing this: the extraction only ran when To was still
  empty, so a second "Draft" click on the *same* brief (To now filled in
  from the first click) silently dropped the hint and reverted to "Hi,".
  Decoupled the two: extraction (and the name hint) now runs on every
  Draft click regardless of To's state; only the *address* backfill is
  gated on To being empty, so a manually-entered recipient is never
  overwritten.
  Verified live: 3 consecutive "Draft" clicks on the same brief (the exact
  scenario that broke on the 2nd click before this fix) all opened "Dear
  Baneshwari Royal,"; confirmed no regression on the no-recipient-at-all
  case (still "Hi,").
  [draft.ts](src/lib/mail/ai/draft.ts), [mail.ts](src/actions/mail.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-ai-draft-recipient-name-hint-plumbing`, merged to main.

---

## Follow-up — 2026-07-27 (regex replaced with AI for recipient extraction)

- [x] **[FIXED — regex replaced with an actual AI call, per explicit
  instruction] AI Draft's recipient extraction missed a lowercase/
  honorific name.** Test case: "write a mail to yogesh ji on
  abc@gmail.com regarding hr policy." opened "Hi," instead of naming
  Yogesh — the "name after to/for" pattern in `resolveDraftRecipients`
  only matched Capitalized words, so a casually-typed lowercase name with
  an honorific ("yogesh ji") never matched at all.
  Root cause: pattern-matching was being asked to do a genuine language-
  understanding task (who is this email for, in arbitrary phrasing/
  casing/honorifics) that no fixed regex can generalize to. Replaced the
  whole extraction with a Claude (haiku) call that reads the instruction
  and returns `{recipientEmail, recipientName}` directly — the only
  regex left is a plain shape check (`user@domain.tld`) on the email
  Claude returns, kept because that string becomes a literal SMTP
  recipient and needs format validation regardless of how it was
  extracted; that's a technical safety check, not a parsing step.
  Verified live with 4 test cases the user provided, run through the
  actual app end-to-end:
  1. "write a mail to yogesh ji on abc@gmail.com regarding hr policy." →
     To: abc@gmail.com, opens "Dear Yogesh ji," (lowercase name +
     honorific, handled correctly).
  2. "write a mail to rahul.narayan@gmail.com regarding loan
     application" → To: rahul.narayan@gmail.com, opens "Dear Rahul
     Narayan," — no name was stated separately, but the model reasonably
     read it off the email's own local-part (a real name shape, not a
     hallucination pulled from unrelated context).
  3. "write a mail regarding the cricket game screening to Ram.
     xyz@gmail.com" → To: xyz@gmail.com, opens "Dear Ram," — correctly
     split "Ram." (name, trailing period) from the actual email address
     despite no space and an ambiguous period, something the old regex
     could plausibly have gotten wrong.
  4. "write a mail regarding intro call to xyz@gmail.com" → To:
     xyz@gmail.com, opens "Hi," — no name given and none invented, since
     "xyz" isn't name-shaped (contrast with case 2).
  Also found in passing during this test run: the dev Postgres container
  hit "too many clients" at one point (`docker logs bluridge-ceo-db`),
  causing one draft attempt to silently return nothing — a transient
  infra issue from a very long dev session's accumulated hot-reload
  connections, not a code bug. Confirmed the DB was healthy again
  (15/100 connections) before continuing; worth restarting the dev DB
  container occasionally on very long sessions, not something to code a
  fix for.
  [draft.ts](src/lib/mail/ai/draft.ts) —
  `fix/mail-ai-draft-recipient-extraction-uses-ai`, merged to main.

---

## 2026-07-28 — Label correction: retroactive fix + standing rule

- [x] **[FEATURE] Correcting a label now offers to fix similar existing
  mail and/or apply automatically to future mail — for both label
  systems.** Previously, relabeling one email was completely isolated:
  moving a thread to a custom label folder ("Move to…") only ever moved
  that one thread, and AI smart-label chips (Needs reply, Banking,
  Receipt, etc.) had no correction affordance at all. Researched industry
  precedent first (Gmail's "Also apply filter to matching conversations"
  checkbox, Outlook's "Create Rule from message," Superhuman's Custom
  Auto Labels with a live match preview, Notion Mail's "a correction
  teaches the system" framing) and built accordingly:
  - New correction affordance on smart-label chips in the reader header
    (`correctSmartLabelAction`) — previously these chips were pure
    display, no way to fix a wrong AI classification at all.
  - After either correction path, `suggestLabelCorrectionAction` asks
    Claude what makes *this* email generalizable (exact sender vs. whole
    domain vs. a subject keyword vs. "nothing — one-off"), then runs a
    real live-match query against existing threads — a non-blocking
    toast offers **"Apply to N"** (retroactive relabel/move, capped at
    200, most-recent-first) and **"Always do this"** (a standing rule),
    both strictly opt-in — nothing executes without an explicit click.
    If Claude finds nothing generalizable, no toast appears at all —
    today's single-thread-only behavior, unchanged.
  - "Always do this" reuses the existing `MailLabelRule`/"Auto-label
    rules" panel machinery (extended with `isSmartLabel`, `origin`,
    `sourceThreadId` columns) rather than a parallel concept — rules
    created this way show a "learned" tag in the same panel the user
    already knows.
  - **Root-cause gap closed, not papered over**: smart labels are
    replaced wholesale on every triage run
    (`mergeSmartLabels`/`refineSmartLabels`), and `refineSmartLabels`'s
    own deterministic `BANKING_FROM` regex guardrail runs *before* any
    correction is consulted — so a standing correction could get
    silently reverted by the very next re-triage. Fixed by adding
    `applySmartLabelCorrections` in `triage.ts`, consulted right after
    `refineSmartLabels`, so a matching per-account correction rule wins
    over the deterministic heuristics (applied in both `triageThread` and
    `repairSmartLabels`).
  - Retroactive apply returns a snapshot (previous folder id / previous
    labelsJson per thread) so the toast can offer **Undo** — mirrors the
    app's existing `pendingSend` undo-toast pattern exactly, including
    the self-clearing timer.
  Verified live end-to-end against the real mailbox:
  1. Corrected "Ranjeet Kumar 3 (Consumer Bank, KMBL)" from Banking →
     Needs reply (it's a meeting request, not a transactional alert) →
     toast found 1 other thread from the same sender → "Apply to 1"
     correctly relabeled it too (confirmed via DB).
  2. **Proved the root-cause fix actually matters**, not just that it
     "still worked": `ranjeet.kumar13@kotak.com` matches
     `BANKING_FROM`'s `/kotak/` pattern, so
     `refineSmartLabels(["NEEDS_REPLY"], ...)` alone — confirmed in
     isolation — returns `["BANKING"]` regardless of the model's own
     classification. Created the standing correction rule, force-
     re-triaged the thread (`triageThread(id, {force:true})`), and
     confirmed the label stayed "Needs reply" instead of reverting to
     "Banking" — the exact regression this fix exists to prevent.
  3. Corrected a HackerNoon "Company of the Week" digest from Newsletter
     → FYI and back; "Apply to 45" found the real count of matching
     HackerNoon mail; "Always do this" created a rule
     (`{"fromContains":"accounts@hackernoon.com"}`, `isSmartLabel: true,
     origin: "correction"`) that shows a "learned" tag in the Auto-label
     rules panel.
  4. Used "Move to…" on a real thread (GST Workings → a custom label
     folder) — confirmed the same suggestion toast fires for custom
     labels too ("2 similar emails — apply … too?"), proving the unified
     flow covers both label systems as intended, then reverted the test
     move.
  Also found in passing: the long-lived dev server (alive ~1.5 days from
  an earlier session) held a stale in-memory Prisma Client from before
  this session's `prisma db push`, causing `Unknown argument
  isSmartLabel` on the very first live "Always do this" attempt —
  regenerating the client on disk doesn't hot-swap an already-running
  Node process's `require` cache. Restarted the dev server to pick up
  the regenerated client; not a code defect, but worth remembering on
  long-running sessions that touch `schema.prisma`.
  [schema.prisma](prisma/schema.prisma),
  [label-rules.ts](src/lib/mail/ai/label-rules.ts),
  [label-correction.ts](src/lib/mail/ai/label-correction.ts),
  [triage.ts](src/lib/mail/ai/triage.ts),
  [mail.ts](src/actions/mail.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `feature/mail-label-correction`, merged to main.
