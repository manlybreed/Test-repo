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

---

## Follow-up — 2026-07-28 (selectable match list + always-present label affordance)

- [x] **[UX FIX] "Apply to N" only ever applied to everything matched — no
  way to review or exclude individual mails first.** User feedback after
  trying the feature live: "when it says applying this to n more mails,
  it should show those mails and allow us to select or deselect some of
  them." `suggestLabelCorrectionAction` now returns the full match list
  (up to the existing 200 cap, not just a 5-item preview), and the
  suggestion toast's count is a clickable link that expands a scrollable,
  checkbox-per-thread review panel (sender + subject, Select all/Deselect
  all, live "N of M selected" count) above the pill. Retroactive apply now
  sends the exact reviewed/checked thread-id list to
  `applyLabelCorrectionAction` instead of the server re-deriving "everything
  matching the rule right now" — closes a minor staleness gap too (what
  you saw and selected is exactly what happens, with no drift from mail
  that changed between the suggestion and the click). The auto-dismiss
  timer pauses while the review panel is open so it can't vanish mid-review.
  Verified live end-to-end: opened the review list, deselected the only
  match ("0 of 1 selected", Apply button correctly disappears), re-selected
  it, clicked Apply, and confirmed via direct DB query that only the
  selected thread was touched (a sibling match that was correctly left
  unselected in an earlier pass stayed untouched).
- [x] **[UX FIX] Reader header looked structurally different depending on
  whether a thread already had a smart label.** User feedback with two
  side-by-side screenshots: "the UI for these two threads looks so
  different." Root cause: the entire labels row was conditionally
  rendered only when `labelsJson` was non-empty — a thread with zero
  labels (common for anything not yet triaged) had no row at all, and
  critically, no way to assign a first label either, since the correction
  affordance lived only on existing chips. Now the row always renders; if
  no smart label exists yet, a dashed "+ Label" placeholder opens the same
  7-option popover to assign one for the first time (not just correct an
  existing one) — `correctSmartLabelAction`/`mergeSmartLabels` already
  handled going from zero labels to one correctly, so this was purely a
  UI gap, not a server-side one. Verified live on the exact thread from
  the screenshot ("Bhaureji Surajmal Green Energy... Bharatpur-Part 3",
  previously unlabeled): "+ Label" appeared, assigning PM KUSUM worked,
  and the row now matches the layout of an already-labeled thread.
  Also worth noting: while testing, the in-browser tab's hot-reloaded JS
  briefly got into a state where the new expand-toggle button existed but
  its click handler appeared to do nothing (and, via the browser
  automation tool's coordinate-based clicks specifically, appeared to
  dismiss the whole toast) — a hard page reload fixed it immediately and
  the feature worked perfectly afterward. Confirmed via direct DOM/JS
  inspection this was stale client-side Fast Refresh state on a
  very-long-lived dev tab, not an application bug.
  [mail.ts](src/actions/mail.ts),
  [label-rules.ts](src/lib/mail/ai/label-rules.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `feature/mail-label-correction-selectable-matches`, merged to main.

---

## Follow-up — 2026-07-28 (root-caused "finds 1-2, not the real ~10+")

- [x] **[ROOT-CAUSE FIX] Label correction found only 1-2 "similar" emails
  when there were genuinely far more.** User feedback: "the labelling
  is not really auto applying to genuine similar mails. though the
  similar mails may be 10 but it would find just 1 or 2. search on how
  to check if two mails are similar for label correction and fix this."
  Researched industry practice first (embeddings/cosine-similarity and
  LLM-judged semantic similarity are standard for this; Superhuman's
  Custom Auto Labels literally has the AI judge category membership from
  a natural-language description rather than keyword-matching) — then
  root-caused the actual bug rather than tuning constants: confirmed live
  that `suggestLabelMatchCriteria`'s own proposed `subjectContains`
  ("KUSUM") didn't even appear in the *source* email's own subject
  ("Bhaureji Surajmal Green Energy Pvt Ltd, Component A, Bharatpur-Part
  3") — because `findMatchingExistingThreads` requires `fromContains
  AND subjectContains` to both match, any templated business email using
  the same sender/purpose but naming a different company/client each
  time (confirmed: 55+ "Component A" PM KUSUM financing threads across
  a dozen different company names, all from the same sender) was
  silently excluded by the AND gate the moment the subject keyword
  didn't happen to also appear.
  Fixed by making "similar existing mail" a real two-stage retrieve-then-
  judge pipeline instead of a single keyword filter — the same shape as
  this codebase's other retrieval+AI features, not a new pattern:
  1. `findBroadCandidateThreads` (new, label-rules.ts) — deliberately
     loose OR match (either criterion alone qualifies), capped at 60
     candidates, to build a recall-favoring pool.
  2. `classifySimilarThreads` (new, label-correction.ts) — one batched
     Claude call judging which of those candidates are genuinely the
     *same kind* of mail as the source (same purpose/template, even with
     a different name/subject), not just a keyword/sender coincidence.
     Falls back to the old strict-AND result (never to the unfiltered
     broad pool) if classification is unavailable — degrade to fewer,
     verified matches, never to more, unverified ones.
  Verified live end-to-end on the exact reported case: re-running the
  Bhaureji Surajmal → PM KUSUM correction now finds **46-47 genuinely
  similar threads** (Kumha Solar, Sky Volt Raisar, Sky Volt Ajabpura,
  Khandela Solarplus, Pachlawada Solarplus, Solarseed Agri Tech, Dhabla
  Solar, Shree Radhey, Monvi Energy, Sakarwada — all different companies,
  same PM KUSUM financing template) instead of the 1-2 it found before,
  confirmed both via a standalone script exercising the real pipeline and
  via the live UI's new review checklist. The classifier isn't a rubber
  stamp either — it excluded ~13-14 of the 60 broad candidates, so
  precision is intact alongside the recall fix. Did not click "Apply to
  46" during verification — a 46-thread bulk mutation on the real,
  live business mailbox is a decision for the user to make deliberately,
  not something to trigger as a side effect of testing.
  [label-correction.ts](src/lib/mail/ai/label-correction.ts),
  [label-rules.ts](src/lib/mail/ai/label-rules.ts),
  [mail.ts](src/actions/mail.ts),
  [mail-client.tsx](src/components/mail/mail-client.tsx) —
  `fix/mail-label-correction-semantic-similarity`, merged to main.

---

## 2026-07-28 — Multi-mailbox support, Phase 1: schema + credentials + Add-mailbox UI

- [x] **[FEATURE, Phase 1 of 5] Foundation for multiple mailboxes
  (akshay@, accounts@, pmkusum@, ...) in one command center.** Researched
  industry practice first (Outlook's incoming unified "All Accounts" inbox
  on top of its per-account sidebar; Superhuman's fast account switching;
  the sidebar-color-coding best practice to avoid "replying from the wrong
  account"; confirmed real IMAP mailboxes — unlike Exchange-delegated
  shared mailboxes — genuinely need their own credentials, no shortcut).
  Direct code inspection first confirmed the data model was already built
  multi-account-ready (`MailAccount.userId` non-unique, every child model
  already `accountId`-scoped, a dormant `credentialKey` field) — this
  phase activates that design rather than rebuilding it. Three decisions
  confirmed with the user: encrypted in-app "Add mailbox" form (not more
  env vars), sidebar switcher **+** a unified "All Inboxes" view (not
  switcher-only), and real-time IMAP IDLE for every mailbox (not just the
  primary one) — the latter two land in Phases 3-5.
  This phase: `MailAccountCredential` (1:1 with `MailAccount`, encrypted
  via new AES-256-GCM helpers keyed by a new `MAIL_CREDENTIALS_KEY` env
  var — the key itself never touches the DB, so a DB dump alone can't leak
  a mailbox password); `getMailConfig(account)` resolver in `ceo-config.ts`
  that keeps akshay@ on the exact unchanged `CEO_MAIL_*` env path
  (`credentialKey: "ceo_env"`) and routes anything else through the new
  encrypted table; swapped all 8 places that called `getCeoMailConfig()`
  directly (sync/imap-mailbox/outbox/managesieve/drafts/labels — each
  already had an `accountId` in scope, so this was a mechanical per-account
  parameterization, not a redesign) — `idle-watcher.ts` deliberately
  deferred to Phase 5, since its whole architecture (one global watcher)
  is what that phase replaces; swapping it now would be a no-op.
  Also fixed a real correctness gap found along the way: the attachment
  download route checked ownership against only the one env-configured
  account, so an attachment on a second mailbox would 404 even for its
  rightful owner — now checks against any mailbox the session user owns.
  New `mail-accounts.ts` actions (list/test/add/update/remove) and a new
  "Mailboxes" settings panel (same modal pattern as the existing
  Signatures/Vacation panels) with a real "Test connection" button
  (attempts a genuine IMAP connect + SMTP verify, persists nothing).
  Verified live: akshay@'s sync/bootstrap continued working unchanged
  through the new `getMailConfig` path (the regression check that mattered
  most, since this phase touches the credential layer every existing mail
  operation depends on); the Mailboxes panel opens and lists akshay@ as
  primary with no Remove button; the Add-mailbox form renders with sane
  defaults (mail.thebluridge.com, ports 993/587); "Test connection" against
  a deliberately wrong username/password correctly reports "IMAP: Command
  failed" without proceeding to save; confirmed via direct DB query that
  no stray `MailAccount`/`MailAccountCredential` rows were left behind
  from that negative test. New unit tests for the encryption helpers
  (round-trip, non-deterministic ciphertext, tamper detection via GCM auth
  tag, missing/malformed key errors).
  **Not verified live**: actually adding a second *real* mailbox
  (accounts@/pmkusum@) and confirming it syncs — this needs real
  credentials for one of those mailboxes, which weren't available during
  this session. The mechanism (encrypt → store → resolve → connect) is
  proven end-to-end by the round-trip tests and the live negative
  connection test; a positive real-credential test is the natural first
  thing to do before relying on this in practice.
  [prisma/schema.prisma](prisma/schema.prisma),
  [credential-crypto.ts](src/lib/mail/credential-crypto.ts),
  [ceo-config.ts](src/lib/mail/ceo-config.ts),
  [account.ts](src/lib/mail/account.ts),
  [mail-accounts.ts](src/actions/mail-accounts.ts),
  [mailboxes-panel.tsx](src/components/mail/mailboxes-panel.tsx),
  [sync.ts](src/lib/mail/sync.ts),
  [imap-mailbox.ts](src/lib/mail/imap-mailbox.ts),
  [outbox.ts](src/lib/mail/outbox.ts),
  [managesieve.ts](src/lib/mail/managesieve.ts),
  [drafts.ts](src/lib/mail/drafts.ts),
  [labels.ts](src/lib/mail/labels.ts),
  [attachments/[id]/route.ts](src/app/api/mail/attachments/[id]/route.ts) —
  `feature/mail-multi-account-schema-and-credentials`, merged to main.

---

## 2026-07-28 — Multi-mailbox support, Phase 2: action-layer account resolution

Refactored `actions/mail.ts` so thread/message-scoped actions resolve their
account from the thread itself instead of always defaulting to the primary
env mailbox — the real gap this closes: several of these actions
(`snoozeThread`, `setThreadPriority`, `setThreadImportant`, `triageThreadAction`)
had **no ownership check on `threadId` at all** before this change, and
several more (`summarizeThreadAction`, `draftReplyAction`,
`multilingualDraftAction`, `extractCommitmentsAction`, the label-correction
trio) resolved to the *wrong* account's id whenever the thread belonged to
anything other than the primary mailbox, which would have silently broken
those features the moment a second mailbox existed. New helper
`requireAccountForThread(threadId)` in `actions/mail.ts` (mirrors
`requireAccount()`'s return shape) wraps the new
`requireOwnedAccountForThread` from `account.ts`, and now backs:
`trashThreadAction`, `archiveThreadAction`, `moveThreadToFolderAction`,
`archiveThreadsAction`/`trashThreadsAction`/`moveThreadsToFolderAction`
(bulk — derive from the first selected id, a known limitation for a future
cross-account multi-select), `setThreadImportant`, `getMailThread`,
`markThreadRead`, `snoozeThread`, `setThreadPriority`, `triageThreadAction`,
`summarizeThreadAction`, `draftReplyAction`, `multilingualDraftAction`,
`extractCommitmentsAction`, `correctSmartLabelAction`,
`suggestLabelCorrectionAction`, `applyLabelCorrectionAction` (from
`sourceThreadId`), and `undoLabelCorrectionAction` (from the snapshot's
first thread id, for the "folder" kind — the "smart" kind never scoped by
account to begin with).

**Scope deliberately narrowed from the original plan**: the plan also
called for adding an explicit `accountId` parameter to ~50 mailbox-level
actions (sync, bootstrap, search, compose, ask-mailbox, digest,
signatures/vacation/label-rules CRUD, etc). Skipped for now — Phase 3
(sidebar switcher) doesn't exist yet, so no caller can pass anything but
the default account regardless, meaning that plumbing would be untested
and inert until Phase 3 actually needs it. Folding it into Phase 3 instead,
where a real UI caller will exist to pass real values and the change can
be verified by actually switching mailboxes.

Verified: `npx tsc --noEmit`, `npx eslint src/actions/mail.ts
src/lib/mail/account.ts`, `npx vitest run src/lib/mail` (118 passed, 1
skipped), null-byte scan — all clean. Live regression on akshay@ (the only
account with real credentials): opened a thread (`getMailThread` +
`markThreadRead`), toggled Mark/Unmark important (`setThreadImportant`),
changed priority via the P2 dropdown (`setThreadPriority`), and filtered by
a smart label chip — all worked exactly as before, confirming
`requireAccountForThread` resolves the same account `requireAccount()` used
to for a single-mailbox session. No server errors in dev-server logs
throughout.

[account.ts](src/lib/mail/account.ts),
[mail.ts](src/actions/mail.ts) —
`feature/mail-multi-account-action-layer`, merged to main.

---

## 2026-07-28 — Multi-mailbox support, Phase 3 (part 1): mailbox-level accountId support + a real sync crash fixed

The user added two real second mailboxes (accounts@thebluridge.com,
pmkusum@thebluridge.com) via the Phase 1 Add-mailbox UI, unblocking real
verification instead of guessing. `requireAccount()` and
`getMailBootstrap()` now take an optional `accountId`, and every
mailbox-level action (sync, bootstrap, folders/threads list, search,
compose/send/draft, signatures, vacation responder, label rules, blocked
senders, reminders, and the AI toolbar actions — digest/ask-mailbox/
recall/cleanup/style/follow-ups) accepts an explicit `accountId` now
instead of always resolving to the primary env mailbox. Also fixed a real
bug this surfaced: `applyLabelCorrectionAction`'s internal call to
`upsertLabelRuleAction` wasn't passing the resolved account through, so a
standing rule created from a secondary mailbox's thread would have
silently landed on the primary account instead.

**Real bug found and fixed while verifying against the two new
mailboxes**: accounts@ synced cleanly on the first try, but pmkusum@
crashed with `Unique constraint failed on the fields: (folderId,
imapUid)` after importing only its INBOX. Root cause: `syncCeoMail` had
no guard against two overlapping syncs for the same account racing on the
same IMAP UID — the best-effort background sync `addMailAccountAction`
kicks off right after adding a mailbox can still be mid-flight (a slow
first connection, or a large mailbox) when a manual sync or a retry fires,
and both land on the same "this UID doesn't exist yet" check moments
apart, then both try to `create()` it. Fixed two ways: an in-process
per-account mutex in `syncCeoMail` (concurrent calls for the same account
now await the one already running instead of racing it), and a defensive
catch around the message insert that treats that specific duplicate-key
race as "already imported by the other run" rather than aborting the
whole sync. Verified live: pmkusum@'s sync went from crashing after 1
folder to completing cleanly across all 5 folders (280 messages), hitting
and correctly absorbing the race 9 times in that one run.

**Scope note**: this is the server-side foundation only. The actual
sidebar account switcher UI, the client-side wiring that threads the
active account through every one of the ~45 call sites in
`mail-client.tsx`, and the compose "From" selector are not built yet —
deliberately split off as their own follow-up rather than rushed
alongside this, since that's a large surgery on a ~6,700-line component
where a half-wired call site (some actions correctly following a switched
mailbox, others silently still hitting the primary one) would be a worse,
more confusing bug than not having the switcher at all.

Verified: `npx tsc --noEmit`, `npx eslint src/actions/mail.ts
src/lib/mail/sync.ts`, `npx vitest run src/lib/mail` (118 passed, 1
skipped), null-byte scan — all clean. Live: `accounts@` and `pmkusum@`
both fully synced with real credentials (106 and 280 messages, 5 folders
each) via the existing Add-mailbox UI.

[account.ts](src/lib/mail/account.ts),
[mail.ts](src/actions/mail.ts),
[sync.ts](src/lib/mail/sync.ts) —
`feature/mail-multi-account-switcher-ui`, merged to main.

---

## 2026-07-28 — Multi-mailbox support, Phase 3 (part 2): sidebar switcher UI

Built the actual switcher on top of the accountId plumbing from part 1: a
sidebar section listing every configured mailbox (color-coded via the
existing `labelTone` hash, in both the expanded and folder-collapsed
sidebar states), loaded once at mount via `listMailAccountsAction()`
rather than waiting on Settings to be opened. Clicking a mailbox calls
`getMailBootstrap(accountId)` and replaces folders/threads/signatures/
reminders, landing back on Smart Inbox (the previously active folder id
belongs to the old account and won't exist in the new one). Threaded
`accountId` through every mailbox-level action call in `mail-client.tsx`
(~34 call sites), `RecipientAutocomplete`, `SignaturesPanel`, and
`VacationPanel`. Added a "From {address}" line to the docked reply card
(only shown once there's more than one mailbox) — the fullscreen compose
already had this from earlier in the session, it just needed to keep
reflecting whichever account is active now that more than one exists.

**Real bug found and fixed while verifying against all three mailboxes**:
after switching to a secondary mailbox, marking a thread important (or
any other action that calls `revalidateMail()`) silently snapped the view
back to the primary mailbox. Root cause: `page.tsx`'s server component
has no notion of a client-side switch — it always calls
`getMailBootstrap()` with no accountId, so its `account`/`folders`/
`threads`/`signatures` props always describe the primary mailbox, and
`revalidatePath("/ceo/mail")` (called by nearly every mutating action)
makes Next.js re-run that server component and push those primary-only
props back down. An existing effect synced those props into local state
unconditionally on every change — including this one. Fixed by skipping
that sync whenever the currently active account differs from what the
incoming props describe.

Verified live against all three real mailboxes end to end: switching
correctly swaps folders/threads/signatures for accounts@ (101 threads)
and pmkusum@ (150 threads); opened a thread and toggled Mark
important on accounts@ and confirmed the view stayed on accounts@
afterward (the bug above, now fixed); opened fullscreen compose on
accounts@ and confirmed it showed "From accounts@thebluridge.com" with
that mailbox's own default signature ("Best regards, Accounts"); switched
back to akshay@ and confirmed a manual refresh still works exactly as
before (no regression to the single-mailbox path). tsc, eslint, vitest
(118 passed), null-byte scan — all clean.

**Deferred to Phase 4**: a full per-compose "From" override dropdown
(letting a single compose send from a different account than the
sidebar's active one) — genuinely only needed once the unified "All
Inboxes" view exists and you can be looking at merged threads without an
unambiguous "current" account; today's single-active-mailbox model makes
compose-from already unambiguous.

[mail-client.tsx](src/components/mail/mail-client.tsx),
[signatures-panel.tsx](src/components/mail/signatures-panel.tsx),
[vacation-panel.tsx](src/components/mail/vacation-panel.tsx) —
`feature/mail-multi-account-switcher-ui-client`, merged to main.

---

## Known gaps after Phase 3 (not fixed — flagged for a deliberate follow-up)

- **Blocked-senders has no UI at all.** `listBlockedSendersAction` and
  `unblockSenderAction` exist server-side (and now accept `accountId`
  correctly), but grepping the whole `src/components` and `src/app` trees
  turns up zero call sites for either — `blockSenderAction` (block +
  trash the current thread) is reachable from a thread's "More" menu, but
  there's no screen that lists who's blocked or lets you undo it. This
  predates multi-mailbox work; just surfaced while sweeping every
  mailbox-level action for an `accountId` parameter. Needs a small panel
  (same modal pattern as Signatures/Vacation) — not attempted here since
  it's a pre-existing gap, not something this phase touched.
- **Bulk multi-select (archive/trash/move-to-folder) derives the account
  from only the first selected thread.** Harmless today — nothing lets you
  select threads from two different mailboxes at once yet — but this will
  need real handling once Phase 4's unified "All Inboxes" view makes
  cross-account multi-select possible. Flagged in the Phase 2 TODO entry
  already; repeating here since Phase 4 is where it actually starts to
  matter.
- **Settings panels (Signatures, Out of office, Label rules) don't show
  which mailbox they're editing.** They correctly operate on the active
  account now (Phase 3's accountId wiring), but a user who switches to
  accounts@ and opens Signatures sees the same "Mail settings ›
  Signatures" header as on the primary mailbox — no on-screen mailbox
  address to confirm which one they're about to change. Minor, but worth
  a one-line address label in each modal header before this trips someone
  up.
- **Secondary mailboxes don't get real-time IMAP IDLE updates.** Only the
  primary mailbox has a live IDLE connection; accounts@ and pmkusum@ only
  refresh on manual sync or when you switch to them. By design — this is
  exactly what Phase 5 (IDLE per mailbox) is for — but worth naming
  explicitly so it isn't mistaken for a bug: switching to a secondary
  mailbox shows its state as of the last sync, not a live feed.
- **pmkusum@'s initial IMAP connection was unusually slow** (multiple
  minutes, `Socket timeout`/`ECONNRESET` before eventually succeeding)
  during Phase 3 verification — real enough that it's what surfaced the
  duplicate-key sync crash (now fixed). The slowness itself was never
  root-caused; it may just be first-connection latency on the mail
  server's side for a freshly created mailbox, but if a future mailbox
  addition hangs the same way, it's worth checking the mail server itself
  rather than assuming it's this app's connection code.
