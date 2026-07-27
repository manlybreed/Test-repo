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
