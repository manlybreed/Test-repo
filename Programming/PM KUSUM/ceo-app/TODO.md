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

---

## 2026-07-28 — Multi-mailbox support, Phase 4: unified "All Inboxes" view

`queryThreadsForView` now accepts `accountIds` (plural) alongside the
existing single `accountId`. The tricky part: single-account views resolve
one real folder id for "the Inbox" and scope everything to it (exact
preview/unread semantics); the unified view has no single folder id to
point at across three separate mailboxes, so it resolves each account's
own INBOX-role folder id and scopes by `folderId: { in: [...] }` instead —
kept the same exactness as the single-account path rather than falling
back to a looser "any folder with this role" match, which would have let a
more-recent Sent-folder copy of a thread win the preview over its actual
Inbox message. `ThreadListRow` now carries `accountId` so the client can
badge each row without an extra join. New `listAllInboxesThreadsAction`
resolves the mailbox list from the session directly (every account the
user owns) — never from a client-supplied id list, so there's nothing to
verify ownership of. New `ALL_INBOXES_ID` pseudo-folder in the sidebar
(hidden until a second mailbox exists), following the same pattern as the
existing Smart Inbox/Outbox entries.

**Two real bugs found and fixed while verifying this against all three
mailboxes**:
1. Replying to a thread from the unified view sent from whichever account
   was last "active" in the sidebar, not the thread's own account — e.g.
   opening a pmkusum@ thread from All Inboxes while akshay@ was the
   last-switched-to account would reply *as* akshay@. Root cause:
   `sendMailAction`/`saveDraftAction`/`uploadComposeAttachmentAction` and
   the To/Cc/Bcc autocomplete were all wired to `accountInfo?.id` (the
   sidebar's notion of "active"), which has no relationship to which
   mailbox a given open thread actually belongs to once more than one
   mailbox's threads can appear in the same list. Fixed with a derived
   (not stored, so it can't go stale) `composeAccountId` — looks up the
   currently open thread's own `accountId` from the already-loaded
   `threads` list, falling back to `accountInfo` only for a brand-new,
   non-reply compose where there's no thread to derive it from.
2. `switchAccount()`'s same-account early-return guard didn't account for
   being in the unified view: "All Inboxes" never touches `accountInfo`,
   so after switching to it, clicking the account that was active
   *beforehand* compared equal to `accountInfo.id` and silently no-opped
   instead of switching back to a single-account view. Fixed by also
   requiring `activeFolder !== ALL_INBOXES_ID` in that guard.

**Also fixed a pre-existing display bug the new badges made obvious**: the
primary (`ceo_env`) mailbox's `displayName` is stored as a full RFC822
`"Name <email>"` string (built for the SMTP From header, not for UI
display), so the sidebar switcher (shipped in Phase 3) and the new account
badges were both rendering that whole string instead of just "Akshay".
Added `accountShortName()` to parse out just the name part when
`displayName` is in that shape, used consistently everywhere an account's
short label is shown.

Verified live against all three real mailboxes: All Inboxes correctly
merges and badges threads from akshay@/accounts@/pmkusum@ (initially
mis-verified against a thread whose *smart label* happens to also be named
"PM KUSUM" — coincidental naming collision with the account, not a bug —
caught and re-verified against a genuine cross-account thread instead);
opening and replying to one of pmkusum@'s threads from within the merged
view correctly showed "From pmkusum@thebluridge.com" and used that
mailbox's own default signature; switching between a single account and
All Inboxes in both directions, repeatedly, works correctly post-fix; no
stray draft rows were left behind by the verification session. tsc,
eslint, vitest (118 passed), null-byte scan — all clean.

**Deferred to Phase 5**: non-primary mailboxes' threads in the unified
view only refresh on manual sync or when switching to that account —
real-time IMAP IDLE is still primary-mailbox-only, per the plan.

[threads-query.ts](src/lib/mail/threads-query.ts),
[mail.ts](src/actions/mail.ts),
[mail-client.tsx](src/components/mail/mail-client.tsx) —
`feature/mail-multi-account-unified-inbox`, merged to main.

---

## 2026-07-28 — Multi-mailbox support, Phase 5: IMAP IDLE per mailbox (plan complete)

Last phase of the original multi-mailbox plan. `idle-watcher.ts` previously
ran exactly one global INBOX+SENT IDLE pair, hardcoded to the primary
account via `ensureCeoMailAccount(null)` called *inside* `watchRole()`
itself — and `pullDelta()`'s `syncCeoMail()` call never passed an
`accountId` either, so even a naive attempt to thread a second account
through would have synced the wrong mailbox on every IDLE-triggered
update. Restructured the global state from one flat `{started, stopping,
clients}` object to a `Map<accountId, ...>`, so every function
(`watchRole`, `runWatcherLoop`, `pullDelta`, `applyFlagUpdate`,
`applyExpunge`) takes the account explicitly. New `ensureIdleClientFor
(account)` starts (or no-ops if already running) one mailbox's loop —
called both by `startMailIdleWatcher()` for every configured mailbox at
boot, and by `addMailAccountAction` right after creating a new mailbox, so
a freshly added mailbox goes live immediately without an app restart.

**Also fixed a real inefficiency this exposed**: the client's SSE handler
refetched whatever view was on screen on *any* `mail:updated` event,
regardless of which mailbox it was about — harmless when only the primary
account ever had IDLE running, but with three independent loops now, mail
arriving on any one of them would make every open tab refetch its current
view whether or not that was the account being looked at. Added
`accountInfoRef`/`activeFolderRef` (the SSE subscription only connects
once per `[configured]`, so it needs refs rather than closing over state
directly — same pattern the codebase already uses for
`reloadActiveViewRef`) and skip the refetch unless the event's account
matches what's active, or the active view is the unified "All Inboxes"
list. Desktop notifications still fire regardless of account — you want
to know about new mail anywhere, just not have every tab thrash refreshing
for a mailbox you're not looking at.

Verified live via a full dev-server restart from a cold boot — necessary
here specifically because the global-state shape changed (object → Map)
and `instrumentation.ts`'s `register()` only runs once per process, so a
hot-reloaded old state could have masked a real problem. Temporarily
instrumented every step with console logging: confirmed all three real
mailboxes' watchers connected, resolved their INBOX/Sent folder paths, and
reached "watching" within seconds of boot — seed sync, IMAP connect, and
`mail:idle` publish all succeeded independently for akshay@, accounts@,
and pmkusum@. (One false alarm along the way: a first check via a fresh
browser-side `EventSource` saw only `hello`/`ping`, no `mail:idle` —
turned out the listener simply attached a few seconds *after* the events
had already fired, and SSE has no replay for late subscribers; the
server-log evidence settled it.) Removed the debug logging afterward,
confirmed the app still boots clean and shows "live". tsc, eslint, vitest
(118 passed), null-byte scan — all clean.

**This closes out the multi-mailbox plan** (`witty-finding-tiger.md`):
schema + encrypted credentials (Phase 1), action-layer account resolution
(Phase 2), sidebar switcher + client wiring (Phase 3), unified "All
Inboxes" view (Phase 4), per-mailbox IDLE (Phase 5). Known open items are
tracked in the "Known gaps after Phase 3" entry above (blocked-senders UI,
settings-panel account labels) plus the unified-view bulk-multi-select
limitation noted in Phase 4 — none of these block normal day-to-day use
of akshay@, accounts@, or pmkusum@ today.

[idle-watcher.ts](src/lib/mail/idle-watcher.ts),
[mail-accounts.ts](src/actions/mail-accounts.ts),
[mail-client.tsx](src/components/mail/mail-client.tsx) —
`feature/mail-multi-account-idle-per-mailbox`, merged to main.

---

## 2026-07-28 — Fix: removing a mailbox left behind a zombie IDLE loop and 8+ GB of orphaned files

The user removed accounts@ and pmkusum@ via the Mailboxes settings panel to
test the remove flow, then asked for a check before re-adding them. The DB
side was clean — `MailAccountCredential`, `MailFolder`, `MailThread`,
`MailMessage`, etc. all correctly cascaded away (verified via a fresh
`groupBy` query: only akshay@'s 564 threads remained). Two things weren't,
though:

1. **The removed account's IMAP IDLE loop kept running.**
   `removeMailAccountAction` deleted the `MailAccount` row but never told
   `idle-watcher.ts` to stop that account's loop. Since the credentials
   are gone (cascaded with the row), every reconnect attempt would fail
   and the loop would just retry forever on exponential backoff — quietly,
   since IDLE errors publish through the live-bus, not console output.
   Added `stopIdleClientFor(accountId)` (logs out any live connections,
   marks the loop stopping, drops the per-account state entry) and wired
   it into `removeMailAccountAction`.
2. **Orphaned files on disk.** Raw `.eml` messages and received
   attachments live under `storage/mail/<accountId>`, and compose-time
   uploaded attachments under `storage/mail/outgoing/<accountId>` —
   cascading the DB row never touches the filesystem. Confirmed the hard
   way: accounts@ left 57MB behind, pmkusum@ left **8.3GB**.
   `removeMailAccountAction` now removes both directories on removal.
   Deleted the two existing orphaned directories after re-confirming via
   a fresh DB query that neither `MailAccount` row existed anymore, and
   after the user explicitly confirmed deleting ~8.4GB was fine.

Verified live: restarted the dev server (clears any zombie IDLE state left
over from before this fix existed), confirmed the sidebar switcher and "All
Inboxes" entry correctly disappear with only akshay@ configured (both are
gated on `mailAccounts.length > 1`), confirmed the Mailboxes settings panel
shows just the primary account with a clean "+ Add mailbox" ready, and
confirmed core mail (thread list, All Inbox, live sync) works normally in
single-account mode. tsc, eslint, vitest (118 passed), null-byte scan — all
clean.

[idle-watcher.ts](src/lib/mail/idle-watcher.ts),
[mail-accounts.ts](src/actions/mail-accounts.ts) —
`fix/mail-remove-account-cleanup`, merged to main.

---

## 2026-07-28 — Add/remove-mailbox status visibility

Requested after the user re-added accounts@/pmkusum@ following the remove-
cleanup fix above: `addMailAccountAction` returns as soon as the account +
credential rows exist, then syncs and connects IDLE in the background — for
a large mailbox (pmkusum@ took several minutes earlier this session) the
settings panel showed nothing at all about what was actually happening
next. `MailboxesPanel` now subscribes to the same accountId-tagged SSE
stream `mail-client.tsx` already uses for live updates, scoped to just the
mailbox being added: "Connecting to the mail server…" while waiting for the
first event, "Importing messages… (N so far)" on a `mail:updated` event,
and "Live — watching for new mail" once both the INBOX and SENT IDLE
watchers report `mail:idle` (auto-clears a few seconds after that). A sync
error shows inline and is deliberately *not* auto-cleared; a 60-second
safety-net timeout clears a stuck "Connecting…"/"Importing…" status if IDLE
is disabled (`CEO_MAIL_IDLE=0`) or something else keeps it from ever
resolving, without touching a genuine error message.

Removing a mailbox now shows "Removing mailbox and local data… this can
take a moment for a large mailbox" on that row (DB delete + IDLE stop +
filesystem cleanup, per the fix above, can take a few seconds) instead of
the Remove button just sitting disabled with no explanation.

Verified: tsc, eslint, vitest (118 passed), null-byte scan — all clean.
Confirmed accounts@ (re-added by the user in parallel with this work, since
password entry has to happen in their own browser) synced correctly (5
folders, 123 messages) and the running dev server picked up the change via
Fast Refresh with no errors.

[mailboxes-panel.tsx](src/components/mail/mailboxes-panel.tsx) —
`feature/mail-account-add-remove-status`, merged to main.

---

## 2026-07-28 — Fix VoiceButton hydration mismatch

User reported a React hydration-mismatch error on `/ceo/mail`, with the
diff showing a server-rendered `<div className="flex flex-wrap items-center
gap-0.5 rounded-full pl-2.5 pr-1.5 py-1" ...>` where the client rendered a
`<button>`. The stack trace pointed at `VoiceButton`/`IconBtn`, but neither
actually contains a `<div>` with that markup — that div is the "AI mailbox
actions" pill two elements later in the header row
([mail-client.tsx:4140](src/components/mail/mail-client.tsx#L4140)). The
real bug was one level down, in
[use-speech-to-text.ts](src/components/mail/use-speech-to-text.ts):
`isSpeechToTextSupported()` was called synchronously on every render,
reading `window.SpeechRecognition` directly. On the server `window` doesn't
exist, so `supported` was `false` and `VoiceButton` rendered nothing; on the
client's first (hydration) render, in a browser that supports the Web
Speech API (Chrome/Edge), `supported` was already `true` — an extra button
appeared before the AI-actions pill, shifting it one slot over and causing
React to try to hydrate that div against the shifted-in button.

Fixed by making `supported` start `false` (matching SSR) on both sides and
flipping it via `useState`/`useEffect` only after mount, so the client's
hydration-pass render always matches the server's, and the real value
applies as a normal post-hydration update.

Verified: tsc, eslint, vitest (118 passed), null-byte scan — all clean.
Confirmed live via a full (non-Fast-Refresh) page reload against the
running dev server: no hydration-mismatch error in the console, page
renders normally.

[use-speech-to-text.ts](src/components/mail/use-speech-to-text.ts) —
`fix/mail-voicebutton-hydration-mismatch`, merged to main.

---

## 2026-07-28 — AI draft lists attached documents

Requested feature: attach files to a compose, then ask AI Draft to write
the email (e.g. "write a mail to yogesh@sbi.co.in regarding loan") — the
draft should actually mention and list what's attached instead of writing
as if nothing were enclosed. `composeAttachments` in
[mail-client.tsx](src/components/mail/mail-client.tsx) was already tracked
client-side but never passed to the AI draft call. `draftNewMailAction`/
`draftReplyAction` ([actions/mail.ts](src/actions/mail.ts)) and
`draftNewMail`/`draftReply` ([ai/draft.ts](src/lib/mail/ai/draft.ts)) now
take an optional `attachments: string[]` of filenames, fenced into
mail_data as `attachedDocuments`. The shared prompt rule
(`attachmentPromptRule`) tells the model: if non-empty, add an "Attached:"
line plus a sibling `<ul>` naming each file (explicitly not nested inside
a `<p>`, since the model's first attempt did that and it's invalid HTML);
if empty, don't claim anything is attached.

Verified: tsc, eslint, vitest (118 passed) all clean. Ran `draftNewMail`
directly against the real Claude API (bypassing the UI, since this
browser pane can't drive a native file-picker dialog — programmatically
setting a `<input type="file">`'s value is blocked by the browser itself)
with 3 attached filenames and a "loan application to yogesh@sbi.co.in"
brief — correctly listed all three in a clean, properly-nested `<ul>`.
Also verified live in the running dev server with no attachments (regular
AI Draft flow through the actual UI) — correctly made no attachment claim,
confirming the empty-list branch doesn't regress the existing behavior.

Noticed in passing (unrelated, not fixed here — flagged separately): a
fresh AI-drafted new email can end with "Best regards," twice — once from
the model's own sign-off, once from the signature block, which itself
opens with "Best regards,".

[actions/mail.ts](src/actions/mail.ts),
[mail-client.tsx](src/components/mail/mail-client.tsx),
[ai/draft.ts](src/lib/mail/ai/draft.ts) —
`feature/mail-ai-draft-attachment-list`, merged to main.

---

## 2026-07-28 — Fix AI draft double sign-off

Follow-up to the attachment-listing feature above, flagged as a separate
issue noticed in passing: a real AI Draft for a new email ended with
"Best regards,</p><p>Best regards,<br>Akshay<br>BluRidge Consulting" — the
model's own closing line immediately followed by the signature block's own
sign-off. The prompt told the model to leave a `<!--SIGNATURE-->` marker
but never said not to write a sign-off of its own first, and the signature
HTML (`MailSignature.htmlBody`) already opens with "Best regards, Akshay,
...".

`draftReply` and `draftNewMail` in
[ai/draft.ts](src/lib/mail/ai/draft.ts) now share one
`SIGNATURE_MARKER_RULE` string, added to both system prompts, that
explicitly forbids a closing/sign-off line before the marker.

Verified against the real Claude API (not mocked): 3 runs of
`draftNewMail` (the original loan-email-with-attachments repro) and 1 run
of `draftReply` (acknowledging a real thread) — all four produced exactly
one sign-off phrase in the output (the signature's own), zero duplicates.
tsc, eslint, vitest (118 passed) all clean.

[ai/draft.ts](src/lib/mail/ai/draft.ts) —
`fix/mail-ai-draft-double-signoff`, merged to main.

---

## 2026-07-28 — Fix AI draft greeting a contact by its own address

Reported live with a screenshot: "write a mail to Himanshu@thebluridge.com
and tell him to forward these documents to Yogesh Ji" opened "Hi," instead
of "Hi Himanshu,". Root cause wasn't the recipient-name extraction (Claude
correctly returned `recipientName: "Himanshu"` from the brief every time
this was tested directly) — it was that `MailContact.displayName` for
himanshu@thebluridge.com is literally the string
`"himanshu@thebluridge.com"`, because that mailbox's own mail client sets
its From-header display name to its own address. Real data, but it carries
no identity beyond the address, and both `resolveDraftRecipients` and
`draftNewMail` in [ai/draft.ts](src/lib/mail/ai/draft.ts) treated it as an
authoritative "known name," letting it silently outrank the correct name
already extracted from the user's own instruction.

Added `isRealName(name, address)` (true only when non-empty and not
identical, case-insensitively, to the address) and applied it wherever a
contact/client name is checked, so an address-echoing "name" now falls
through to the next candidate instead of winning by default.

Verified against the real Claude API: the exact reported brief now
resolves `knownName` to `"Himanshu"` and drafts "Dear Himanshu,". Checked
for regressions with a recipient that has a genuine contact name
(aarti@thinkbeyonds.com → "Aarti sharma") — still correctly drafts "Dear
Aarti Sharma,". Also reproduced the exact UI steps from the bug report
live in the running dev server: To filled with himanshu@thebluridge.com,
the exact reported brief typed into AI assist, Draft clicked — now opens
"Hi Himanshu," instead of "Hi,". tsc, eslint, vitest (118 passed) all
clean.

[ai/draft.ts](src/lib/mail/ai/draft.ts) —
`fix/mail-ai-draft-address-as-displayname`, merged to main.

---

## 2026-07-28 — Smarter contact names: derive from emailid or real correspondence

Requested explicitly: "check the database of contacts. make it smart, it
should be able to extract names from emailid, or greeting from a
particular mail." Follow-up to the two fixes above — those made bad names
get *ignored*, but the contact index still had no way to find a *good*
name when the header never carried one. Two new fallbacks in
[contacts.ts](src/lib/mail/contacts.ts), both feeding straight into
`findContacts`'s returned `ContactRow.displayName`, so every caller
(AI-draft resolution, recipient autocomplete, recall) benefits without
separate wiring:

1. `nameFromLocalPart(address)` — deterministic, pure: "himanshu@…" ->
   "Himanshu", "john.doe@…" -> "John Doe". Returns null (not a guess) for
   role/shared-mailbox local-parts (info, noreply, support, accounts, …)
   or a purely numeric local-part.
2. `discoverContactName(accountId, address)` — AI-based last resort when
   the local-part guess is also empty: reads one real message involving
   the address (their own sign-off if they've sent mail, otherwise how
   someone else greeted them) and asks Claude to read out a name only if
   one is genuinely stated — never guessed from the address itself.
   Persists the hit onto `MailContact` (creating the row if none existed)
   so this only runs once per address; a real header name still overwrites
   it later via the existing upsert logic in `bumpContact`.

`isRealName` moved from `draft.ts` into `contacts.ts` alongside these,
since it's now the shared guard all three build on.
`resolveDraftRecipients`/`draftNewMail` fall through to
`discoverContactName` as the final step before giving up and using "Hi,".

Verified against the real Claude API and DB (not mocked): sampled real
contacts — `ramesh.singh@tracxn.io` -> "Ramesh Singh",
`rahul@thebluridge.com` -> "Rahul" — while `accounts@`/`noreply@`/`support@`
style addresses correctly stayed null. `discoverContactName` extracted
"Suresh Patil" from a fabricated sign-off in a throwaway test message and
correctly persisted it onto a newly-created `MailContact` row (the
create-vs-update path was a real gap caught during this verification — the
first version only updated an existing row, silently never caching a
discovery for a brand-new address). Confirmed live in the running dev
server: drafting to rahul@thebluridge.com with a brief that never names
him opens "Dear Rahul," purely from the emailid-derived guess. tsc,
eslint, vitest (121 passed, 3 new) all clean.

[contacts.ts](src/lib/mail/contacts.ts),
[contacts.test.ts](src/lib/mail/contacts.test.ts),
[ai/draft.ts](src/lib/mail/ai/draft.ts) —
`feature/mail-smart-contact-names`, merged to main.

---

## 2026-07-28 — Phase 1: connect Google Calendar + real "Schedule meeting"

Requested: create meeting links/appointments, connect to a calendar,
create real Google Meet meetings — akshay@thebluridge.com has real Google
Calendar/Meet/Drive access. Planned via `/plan` (industry-standard
research: Google's own `conferenceData.createRequest` pattern for
Meet-linked events, OAuth scope tradeoffs, the standalone Meet API,
2026 scheduling-tool market direction) into
`~/.claude/plans/witty-finding-tiger.md` — a 2-phase plan, both phases
committed up front, not "phase 1 then maybe more."

This is Phase 1: a brand-new OAuth integration. The mailbox's own IMAP/
SMTP mail lives on a self-hosted mailserver
([ceo-config.ts](src/lib/mail/ceo-config.ts)) — completely separate from
this, which is real OAuth to a Google account for Calendar/Meet only.
Added `GoogleCalendarConnection` (1:1 with `MailAccount`, mirrors
`MailAccountCredential`'s shape/cascade; refresh token encrypted via the
existing `credential-crypto.ts` AES-256-GCM helper, no new secret).
[google.ts](src/lib/calendar/google.ts) builds the OAuth client/consent
URL and `createMeetingEvent` (`calendar.events.insert` with a
`conferenceData.createRequest` block — Google's documented pattern for a
Meet link), plus `getFreeBusy` staged for Phase 2. New OAuth redirect
routes (`/api/calendar/google/authorize`, `.../callback` — a real
browser-navigable flow, not a server action, since OAuth needs one).
`createMeetingAction` in
[actions/calendar.ts](src/actions/calendar.ts) creates a real event when
connected, otherwise falls back to the pre-existing `buildIcsInvite` path
unchanged — an unconnected mailbox loses nothing. New Calendar settings
panel (mirrors `mailboxes-panel.tsx`) and a real inline Schedule-meeting
form (title/date/time/duration/attendees) replacing the old
`window.prompt` + hardcoded-next-day-10am flow; removed the now-dead
`buildMeetingInviteAction` wrapper.

Verified: tsc, eslint, vitest (128 passed, 7 new in
[google.test.ts](src/lib/calendar/google.test.ts) covering the
request-body shape and OAuth URL construction as pure functions) all
clean. Live in the running dev server: Calendar settings correctly shows
"not connected" with a disabled Connect button and the missing-env-var
warning (`GOOGLE_CALENDAR_CLIENT_ID`/`SECRET` aren't set yet); Schedule
-meeting on a real thread with `akshayroyal678@gmail.com` as attendee
correctly fell back to the exact pre-existing ICS-download behavior with
no server errors — confirms the regression-free fallback path.

**Not yet verified — blocked on the user, not on code:** the real
Google-connect-and-create-a-meeting path. This needs a Google Cloud
Console OAuth 2.0 Client ID/Secret (Calendar API enabled, redirect URI
`<app-url>/api/calendar/google/callback`), which only the user can create
(their own Google login), plus their own one-time consent-screen click —
same boundary as never typing mailbox passwords. Once supplied as
`GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET` in
`.env.local`, remaining verification is: connect from Calendar settings,
schedule a real meeting, confirm the event + Meet link exist on the
actual Google Calendar, and confirm `akshayroyal678@gmail.com` receives
Google's own invite email.

**Phase 2 (committed, not yet started):** give the AI assist itself the
capability to check calendar availability and schedule meetings — two new
tools (`check_calendar_availability`, `schedule_meeting`) in the existing
assistant tool registry
([tools.ts](src/lib/ai/tools.ts)), plus thread-embedded time proposals
extending `draftReply`. See the plan file for full design.

[prisma/schema.prisma](prisma/schema.prisma),
[calendar/google.ts](src/lib/calendar/google.ts),
[actions/calendar.ts](src/actions/calendar.ts),
[calendar-panel.tsx](src/components/mail/calendar-panel.tsx),
[schedule-meeting-panel.tsx](src/components/mail/schedule-meeting-panel.tsx) —
`feature/calendar-google-connect-and-schedule`, merged to main.

---

## 2026-07-28 — Fix Calendar OAuth: missing userinfo.email scope; full live verification

The user supplied a real Google Cloud OAuth Client ID/Secret and completed
the consent flow, surfacing a real bug on the first attempt: the callback
got a valid code back from Google and exchanged it for tokens
successfully, but the follow-up call to learn which account had connected
(`oauth2.userinfo.get()`) failed with "Request is missing required
authentication credential." Root cause: `SCOPES` in
[calendar/google.ts](src/lib/calendar/google.ts) only requested
`calendar.events`/`calendar.freebusy` — never the profile/email scope
that endpoint needs. Fixed by adding
`https://www.googleapis.com/auth/userinfo.email`.

After the user reconnected, verified the entire Phase 1 flow end-to-end
against the real Google API (not mocked, not just the UI):
- Calendar settings correctly shows "Connected as akshay@thebluridge.com".
- Scheduled a real meeting ("BluRidge Calendar Integration Test") from an
  open thread with akshayroyal678@gmail.com as attendee — UI showed a
  real `meet.google.com` link and "invites sent."
- Independently confirmed server-side, querying the real Google Calendar
  API directly rather than trusting the UI: the event genuinely exists,
  with the correct title/start/end, `hangoutLink` matching the UI's Meet
  link, `htmlLink` matching "View on Google Calendar", `status:
  "confirmed"`, and akshayroyal678@gmail.com listed as an attendee with
  `responseStatus: "needsAction"` — confirming Google actually issued the
  invite to that address.

Phase 1 is now fully verified end-to-end, not just code-complete.

[calendar/google.ts](src/lib/calendar/google.ts) —
`fix/calendar-oauth-userinfo-scope`, merged to main.

---

## 2026-07-29 — Phase 2: AI assist checks availability and schedules meetings

Second half of the meetings/calendar plan (`~/.claude/plans/witty-finding-tiger.md`),
committed alongside Phase 1 up front, not an afterthought. Two new tools
in the existing assistant registry
([tools.ts](src/lib/ai/tools.ts)): `check_calendar_availability` (real
open slots for the next N days) and `schedule_meeting` (creates the
actual event, gated behind the same `assertAutonomy("calendar_invite",
...)` every other irreversible action already requires). New
[propose-times.ts](src/lib/calendar/propose-times.ts): a pure
`generateCandidateSlots` function that walks a time range and returns
only weekday/work-hour slots that don't overlap a real busy block —
deliberately code, not model output. `draftReply` in
[ai/draft.ts](src/lib/mail/ai/draft.ts) now also fetches these
(best-effort) so the Mail UI's own AI-draft reply flow can ground
scheduling suggestions in real availability too, not just the assistant
chat. Along the way, closed a real gap: `createMeetingAction`'s
confirmation gate previously only fired on the ICS fallback, not the real
Google Calendar path — meant nothing when it was UI-only, but matters now
that an AI tool can call it directly.

**A live test caught a real, meaningful bug on the first attempt** (exactly
the kind of thing this session's discipline of verifying against the real
service, not just the code, exists to catch): the first version of
`check_calendar_availability` returned only raw busy/free blocks and left
the model to work out "3 open slots" itself from that data. Asked it to
check availability and schedule a meeting — it proposed 3 plausible-looking
slots, and scheduling one produced a REAL Google Calendar event, with a
real Meet link, a real invite sent to akshayroyal678@gmail.com... dated a
full year in the past (2025 instead of 2026). The token exchange/booking
itself worked perfectly; the model had simply miscalculated the year when
constructing the ISO datetime from scratch. Root-caused and fixed by
having the tool return pre-computed candidate slots (via
`getCandidateMeetingSlots`) instead of raw data — the model now has exact
`startIso`/`endIso` strings to copy verbatim, nothing left to compute.
Added a cheap backstop too: `createMeetingAction` now rejects any
`startIso` already in the past, regardless of where it came from. Deleted
the erroneous 2025-dated event (real cancellation notice sent to the
attendee, since it was a genuine mistake, not a valid test artifact) and
re-ran the identical conversation after the fix: `check_calendar_availability`
correctly listed real open slots (correctly skipping the existing busy
block from the Phase 1 test event), and scheduling one produced a real
event — verified independently via the Google Calendar API directly, not
just the chat UI — with the correct 2026 date, correct Meet link, and the
attendee registered with a real pending invite.

Verified: tsc, eslint, vitest (137 passed, 16 new across
[propose-times.test.ts](src/lib/calendar/propose-times.test.ts) and
[tools.calendar.test.ts](src/lib/ai/tools.calendar.test.ts)) all clean.
Note: no unit test exists for `createMeetingAction`/`actions/calendar.ts`
directly — importing any "use server" actions file pulls in NextAuth,
which needs the Next.js server runtime and breaks under plain vitest
(confirmed by trying; no other actions file in this codebase has a direct
unit test either, for the same reason) — the autonomy-gate behavior is
covered generically by the pre-existing
[policy.test.ts](src/lib/mail/ai/policy.test.ts), and the actual
integration was verified live instead.

[actions/calendar.ts](src/actions/calendar.ts),
[calendar/propose-times.ts](src/lib/calendar/propose-times.ts),
[ai/tools.ts](src/lib/ai/tools.ts),
[ai/draft.ts](src/lib/mail/ai/draft.ts) —
`feature/calendar-ai-scheduling-tools`, merged to main.

---

## 2026-07-29 — Phase 1: unified voice + text command registry

First phase of a 4-phase plan (`~/.claude/plans/witty-finding-tiger.md`) to
make voice/typed commands control the whole app, not just mail search and
drafting. Investigation found three fragmented command surfaces that never
talked to each other: mail's own regex voice parser
([voice-commands.ts](src/lib/mail/voice-commands.ts), now removed), the ⌘K
command bar's local nav-intent regex + tool-less `/api/command` LLM call
([command-bar.tsx](src/components/command-bar.tsx)), and the real
~27-tool business-action engine (`ceoTools`/`runCeoTool` in
[ai/tools.ts](src/lib/ai/tools.ts)) reachable only from `/ceo/assistant`
with zero navigation or mail-mutation capability. Industry precedent
(Superhuman's own command-palette design) pointed at fuzzy client-side
matching as the fast path for known commands, with an LLM fallback for
everything else — exactly what this phase builds.

New [commands/registry.ts](src/lib/commands/registry.ts): a plain-data
`CommandEntry` table (id, phrases, description, optional `isVisible`/
`extractArgs`) matched via `command-score` — the actual library Superhuman
uses, confirmed via `npm view`. Empirically verified (via direct `node -e`
testing, not assumed) that scoring `commandScore(fullUtterance, phrase)` —
utterance as the target, trigger phrase as the abbreviation — correctly
finds a short phrase embedded in a longer sentence, and that each entry
needs short alias words in its `phrases` array, not just long canonical
phrases, or real utterances miss the match. New
[commands/use-register-commands.ts](src/lib/commands/use-register-commands.ts):
a `useRegisterCommands` hook implementing the VS Code "contribution"
pattern — pages register their command entries + handlers (which close
over local React state) on mount, unregistered on unmount, all funneling
through one `invokeCommand(id, args)` dispatcher.

[mail-client.tsx](src/components/mail/mail-client.tsx) is migrated onto
the new registry: its old bespoke regex parser is gone, replaced by 14
registered commands (compose, 8 folder-nav entries, search, archive,
trash, reply, reply-all, forward) reusing the exact same handler functions
the UI buttons already called. `VoiceButton`/`useSpeechToText` are
extracted out of `components/mail/` into a neutral
[components/voice/](src/components/voice/voice-button.tsx) location so
any page can use them — the mail-wide command mic is removed as redundant
now that [ceo-shell.tsx](src/components/ceo-shell.tsx) has a single global
voice button next to ⌘K that works on every page. Critically, the ⌘K
command bar's *typed* input now also tries the shared registry first
(`matchCommand` before `detectNavIntent`/LLM), so a typed command gets the
identical fast path a spoken one does — this was almost missed (the first
pass only wired voice), caught by re-reading the plan's own design intent
("this replaces detectNavIntent") before calling Phase 1 done. Also fixed
a real pre-existing gap: `/ceo/mail` was missing from both `detectNavIntent`
and the `/api/command` LLM prompt's nav list, making Mail unreachable from
⌘K entirely.

New [commands/registry.test.ts](src/lib/commands/registry.test.ts) mirrors
the old `voice-commands.test.ts`'s scenarios (compose phrasing, folder nav,
search-query extraction preserving case, reply-all-before-reply ordering,
context-gated visibility, empty/no-match input) against the new
fuzzy-matched API.

**Verified live, not just in tests**: opened a real thread, typed
"archive this" into ⌘K, and confirmed via the Network panel that it
executed the real `archiveThreadAction` server action directly (no call to
`/api/command` at all) — then confirmed the thread actually moved into the
Archive folder, not just disappeared from the inbox view. Separately typed
"open payroll" (a phrase nothing in the registry matches) and confirmed it
still fell through to the existing `detectNavIntent` path and navigated
correctly, proving the fallback is unbroken. Confirmed exactly one voice
button exists app-wide (the new global one) and that it renders on both
`/ceo/mail` and `/ceo/payroll`.

**A real null-byte corruption slipped past the first verification pass**:
two space characters in `use-register-commands.ts`'s id-join/split
delimiter had silently been written as raw `\x00` bytes, which made
`git`/`file(1)` treat the whole file as binary (visible as `Bin 0 -> 2325
bytes` in the merge diff — the tell that caught it). The null-byte scan
run beforehand missed it because it used `grep -I`, which *skips*
binary-detected files instead of flagging them — the opposite of what a
null-byte check needs. Fixed with a byte-level Python pass replacing
`\x00` with a space, re-verified with `grep -a` (not `-I`) across every
file touched this phase, and landed as a follow-up commit on `main` since
it was caught after the merge had already happened.

Verified: tsc, eslint, vitest (162 passed across all 32 suites, no
regressions) all clean; live browser walkthrough as above.

Phases 2-4 (mail send/trash gated behind a real confirmation-card UI +
mail-mutation tools + shared tool-loop extraction; `client_action` LLM
dispatch + non-mail page primitives; voice availability polish + macOS
mic-permission fix) are still ahead.

[commands/registry.ts](src/lib/commands/registry.ts),
[commands/use-register-commands.ts](src/lib/commands/use-register-commands.ts),
[voice/voice-button.tsx](src/components/voice/voice-button.tsx),
[mail-client.tsx](src/components/mail/mail-client.tsx),
[ceo-shell.tsx](src/components/ceo-shell.tsx),
[command-bar.tsx](src/components/command-bar.tsx) —
`feature/global-command-registry-and-voice`, merged to main.

---

## 2026-07-29 — Fix: Clients/Financing/Ledgers/Employees missing from ⌘K nav

Follow-up to the Phase 1 command-registry work above, flagged as a
separate out-of-scope item during that phase's review rather than bundled
in. Both `detectNavIntent()` in
[command-bar.tsx](src/components/command-bar.tsx) (the client-side fast
path) and the `/api/command`
[route.ts](src/app/api/command/route.ts) LLM prompt's Navigation URLs list
were missing four routes that genuinely exist in the sidebar
(`ceo-shell.tsx`'s `NAV_SECTIONS`): `/ceo/clients`, `/ceo/financing`,
`/ceo/ledgers`, `/ceo/employees` — unreachable from ⌘K entirely.

Added a branch for each, plus split "employee" out of the payroll
keyword set into its own `/ceo/employees` branch — they're two distinct
pages today (Payroll vs. the employee directory), and the old regex
would have swallowed "open employees" into `/ceo/payroll`.

Verified live via ⌘K for all four new routes ("open clients" →
`/ceo/clients`, "open financing" → `/ceo/financing`, "open ledgers" →
`/ceo/ledgers`, "open employees" → `/ceo/employees`), plus a regression
check that "open payroll" still resolves to `/ceo/payroll` after the
keyword split. tsc/eslint clean, full vitest suite (162 tests) unaffected
— no test suite covers this file, consistent with the rest of
`command-bar.tsx`.

[command-bar.tsx](src/components/command-bar.tsx),
[api/command/route.ts](src/app/api/command/route.ts) —
`fix/command-bar-missing-nav-routes`, merged to main.

---

## 2026-07-29 — Phase 2: confirmation-card gate + mail-mutation tools for AI/voice

Second phase of the voice/command plan (`~/.claude/plans/witty-finding-tiger.md`):
closes the gap Phase 1 explicitly deferred — mail send/delete and any
other irreversible action still had no real confirmation gate, only the
model's own self-reported `confirmed:true`. This phase makes a real
human click the only thing that ever executes one.

**The mechanism**: `CONFIRMATION_REQUIRED_TOOLS` in new
[tool-confirmation.ts](src/lib/ai/tool-confirmation.ts) names every
irreversible tool (`schedule_meeting`, `trash_mail_thread`,
`bulk_trash_mail_threads`, `send_mail`). The shared tool-loop — extracted
into new [run-tool-loop.ts](src/lib/ai/run-tool-loop.ts) out of
`api/ai/chat/route.ts` — pauses the instant the model calls one of these,
discards that turn, and returns a `pendingConfirmation` (tool name, input,
and a human-readable summary from `describePendingAction`) instead of
executing anything. A new
[ConfirmationCard](src/components/confirmation-card.tsx) component renders
that inline (Confirm/Cancel, not a blocking modal) in both
[assistant-chat.tsx](src/components/assistant-chat.tsx) and the ⌘K result
panel. Only a real click on Confirm calls the new
[POST /api/ai/confirm-tool](src/app/api/ai/confirm-tool/route.ts), which
sets `confirmed: true` itself — the client only echoes back which pending
action it's confirming, never asserts that it was confirmed. Cancel is
pure client-side state, no server call at all.

**A real, independently-confirmed pre-existing bug got fixed along the
way**: `trashThreadAction`/`trashThreadsAction` in
[actions/mail.ts](src/actions/mail.ts) hardcoded
`assertAutonomy("delete", { confirmed: true })` — the literal boolean
`true`, regardless of what the caller actually confirmed. There was no
real server-side gate on trashing mail at all; the only protection was
the client's own `window.confirm()` popup. Both functions now take a real
`confirmed: boolean` parameter, made a required (not optional) argument
specifically so the compiler forces every call site to be updated —
confirmed via `tsc` that all 3 real call sites in
[mail-client.tsx](src/components/mail/mail-client.tsx) were caught, no
`grep` needed to find them.

**New reversible mail-mutation tools** (direct execution, no card):
`archive_mail_thread`, `move_mail_thread_to_folder`, `set_mail_priority`,
`mark_mail_important`, `mark_mail_read`, `snooze_mail_thread` — all thin
wrappers over already-working `actions/mail.ts` functions. **New
irreversible tools gated behind the card**: `trash_mail_thread`,
`bulk_trash_mail_threads`, `send_mail`. `send_mail` surfaced a real
architectural gap during design (not just implementation): the existing
Undo-Send window is driven entirely by a client-side `setTimeout` in
`mail-client.tsx`'s own component state — an AI-initiated send from
`/ceo/assistant` or ⌘K never mounts that component, so nothing would ever
call `flushQueuedSendAction` and the email would sit `QUEUED` forever.
Fixed by having the `send_mail` tool call `flushQueuedSendAction`
synchronously itself right after queuing, with a minimal 3s window,
instead of relying on a timer that would never fire.

**`/api/command` rebuilt on the shared loop** with the full `ceoTools`
array — every tool ever built for `/ceo/assistant` (invoices, payroll,
agreements, mail, calendar) is now reachable from ⌘K and voice too, not
just navigation, with zero new tool code. Since "navigate" isn't a real
business tool, the ⌘K-specific system-prompt addition asks the model to
reply with a literal `[[navigate:/ceo/xyz]]` marker for pure-navigation
requests. First attempt under-specified this and the model refused to
navigate to pages it has no tool for ("I don't have a Ledgers section",
for a page that very much exists) — fixed by explicitly telling the model
to trust the path list over its own tool inventory, prepending the
instruction before the main prompt instead of appending it (so it's read
as the dominant framing, not an afterthought), and adding worked examples;
re-verified live afterward.

**Verified live against real services, not just code** (the same
discipline that caught the Phase 2 calendar bugs earlier in this project):
a `schedule_meeting` proposal was Cancelled and independently confirmed
via the Google Calendar API to have created nothing, then a second
proposal was Confirmed and confirmed via the API to have created a real
event; a `send_mail` proposal was Cancelled and confirmed via the database
to have queued zero outbox rows — the single most safety-critical check
in this whole phase — then a second proposal was Confirmed and confirmed
via the database to be `SENT` with a real SMTP message id (the CEO's
original ask: a real test email to akshayroyal678@gmail.com, now sent
safely through the new gated path); a `trash_mail_thread` proposal via ⌘K
was Confirmed and confirmed via the database to have set the thread's
`trashedAt`; `archive_mail_thread` was called directly (reversible, no
card) and confirmed via the database to have moved a thread to the
Archive folder; the rebuilt ⌘K nav marker was verified for a phrase the
client-side regex can't catch ("take me to the ledgers section").

Verified: tsc, eslint, vitest (180 passed across 35 suites, no
regressions) all clean. Learned from the Phase 1 null-byte incident —
every touched file was scanned with `grep -a` (not `-I`, which had
silently let the earlier corruption through) before merging.

Phases 3-4 (the `client_action` virtual tool for pure browser-side
primitives like scroll/next-row; extending registry coverage to non-mail
pages; voice availability polish; the macOS desktop wrapper's missing
`NSMicrophoneUsageDescription`) are still ahead. Also noted but out of
scope for this phase: `send_mail` only supports composing a brand-new
email, not replying-and-sending into an existing thread — that needs
`mail-client.tsx`'s client-only `replyContext` threading-header logic
extracted into something server-callable, a real but separate piece of
work.

[tool-confirmation.ts](src/lib/ai/tool-confirmation.ts),
[run-tool-loop.ts](src/lib/ai/run-tool-loop.ts),
[confirmation-card.tsx](src/components/confirmation-card.tsx),
[api/ai/confirm-tool/route.ts](src/app/api/ai/confirm-tool/route.ts),
[api/command/route.ts](src/app/api/command/route.ts),
[tools.ts](src/lib/ai/tools.ts),
[actions/mail.ts](src/actions/mail.ts) —
`feature/mail-mutation-tools-and-confirmation-ui`, merged to main.

---

## 2026-07-29 — Phase 3: client_action tool for cross-page voice/text control

Third phase of the voice/command plan
(`~/.claude/plans/witty-finding-tiger.md`): a new `client_action` virtual
tool in [run-tool-loop.ts](src/lib/ai/run-tool-loop.ts) lets the LLM (Tier
2) trigger any command already registered with the shared client-side
registry ([registry.ts](src/lib/commands/registry.ts)) — the fallback for
whatever Tier 1's fuzzy matcher (`command-score`) missed on an odd
phrasing. Loop-terminal, same reasoning as the confirmation gate: the
model's turn is discarded, and `{commandId, args}` goes back to the
browser, which resolves it through the exact same `invokeCommand` handler
map Tier 1 already uses.

The tool schema is built dynamically per request — `command-bar.tsx` sends
whatever commands are actually registered right now (`listCommands(ctx)`)
alongside the query, and `/api/command` turns that into a `client_action`
tool with `commandId` constrained to a real string enum, so the model can
never invent one. `runToolLoop` gained a new `extraTools` option to carry
this request-specific tool alongside the fixed `ceoTools` array.

Registered the first non-mail commands to prove registry coverage
genuinely extends across the whole app, not just Mail:
`nav.collapse-sidebar` / `nav.expand-sidebar` in
[ceo-shell.tsx](src/components/ceo-shell.tsx) (which wraps every page) —
deliberately two separate commands rather than one blind toggle, each
checking current state first, so saying "collapse" while already
collapsed is a no-op instead of a confusing re-expand.

**Investigated and deliberately skipped** one plan sub-bullet: "fold in
the two unrelated local keydown listeners." The two non-mail keydown
listeners in the codebase
([plant-registry-panel.tsx](src/components/plant-registry-panel.tsx),
[checklist-template-editor.tsx](src/components/checklist-template-editor.tsx))
turned out to both be plain Escape-to-close handlers for modal/panel UI —
the same pattern `command-bar.tsx`'s own Escape handler already uses, not
duplicate "commands" competing with the registry. Converting them into
registry entries would add complexity (voice/⌘K plausibly saying
"escape"?) with no real user-facing benefit, so left as-is rather than
forcing a low-value refactor to match the plan's original wording written
before this specific detail had been inspected.

Verified live on `/ceo/invoices` (a non-mail page, proving cross-page
coverage): the exact registered phrase "collapse the sidebar" resolved via
Tier 1 with zero network calls (confirmed via the network panel); a
paraphrase nowhere near any registered phrase ("the nav panel is too
narrow, widen it back up") correctly fell through to Tier 2 — confirmed
via the network panel that `/api/command` returned
`{type:"client_action", commandId:"nav.expand-sidebar"}`, and the sidebar
visibly re-expanded.

Verified: tsc, eslint, vitest (190 passed across 37 suites, no
regressions) all clean. Every touched file scanned with `grep -a` (not
`-I`) before merging, per the discipline established after the Phase 1
null-byte incident.

Phase 4 (voice availability messaging for Safari/Firefox; the macOS
desktop wrapper's missing `NSMicrophoneUsageDescription`; expanding the
shortcut-help modal) is still ahead.

[run-tool-loop.ts](src/lib/ai/run-tool-loop.ts),
[api/command/route.ts](src/app/api/command/route.ts),
[command-bar.tsx](src/components/command-bar.tsx),
[ceo-shell.tsx](src/components/ceo-shell.tsx) —
`feature/client-action-dispatch-and-page-primitives`, merged to main.
