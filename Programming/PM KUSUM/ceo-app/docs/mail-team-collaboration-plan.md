# Mail Client Team/Collaboration Plan

Companion to `mail-feature-parity-plan.md` (single-user client UX parity vs. Gmail/Thunderbird/Outlook/Roundcube — already covers search, compose, attachments, filters, etc. — **not re-covered here**). This doc is scoped to a completely different axis: what makes an email client good for a **team working out of a shared mailbox**, and what it would take to bring any of that to `/ceo/mail`.

Grounded in: (1) direct reading of `src/lib/mail/ceo-config.ts`, `src/lib/mail/account.ts`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/access.ts`, `src/types/next-auth.d.ts`, `prisma/schema.prisma`, and `src/components/mail/mail-client.tsx` on `main` (commit `620ae99`); (2) live web research (July 2026) on Missive, Superhuman, Canary Mail, Front, Hiver, Help Scout, Spike, Loop Email, Shortwave, and HubSpot Conversations — sources listed at the end of each section and consolidated at the bottom. Every claim about this codebase was confirmed by reading/grepping the actual files, not inferred.

---

## 0. What "team/collaboration" means here (and what this app is today)

BluRidge CEO Command Center is, right now, **one mailbox for one person**:

- `getCeoMailConfig()` (`src/lib/mail/ceo-config.ts:14`) reads a single `CEO_MAIL_USER`/`CEO_MAIL_PASS` pair from env — there is exactly one IMAP/SMTP credential the whole app ever connects with.
- `ensureCeoMailAccount()` (`src/lib/mail/account.ts:5`) does a `findUnique({ where: { address: cfg.user.toLowerCase() } })` — the schema's `MailAccount.address` is `@unique`, so there is structurally one mailbox row, ever, per deployment.
- `MailAccount.userId` (`prisma/schema.prisma:757`) is a **nullable, single-valued** foreign key — at most one `User` can "own" the account, not several.
- The Prisma `Role` enum (`prisma/schema.prisma:12-14`) is, literally, `enum Role { CEO }` — one value. `User.role` is set on login (`src/lib/auth.ts:43,50`) and exposed on the session/JWT (`src/types/next-auth.d.ts`), but a full-repo grep confirms **no code anywhere ever branches on `session.user.role`** — it's write-only scaffolding, never read. The only real per-identity gate in the app is `src/lib/access.ts`'s `isFinanceOwnerEmail()`, an **allowlist of one email** used to *restrict* the finance/agreements area to Akshay specifically — the inverse of what team mail needs (opening a mailbox to *several* trusted people, with different capabilities each).
- `requireCeo()`/`requireCeoAction()` (`src/lib/session.ts:12,24`) — despite the name — only check "is there a logged-in session at all." Any second `User` row that existed would pass every mail Server Action's guard today with zero mail-specific restriction, but also zero mail-specific *awareness*: nothing scopes reads, writes, read-state, or notifications to "which user is this."
- `MailMessage.seen` (schema.prisma:867) and `MailThread.unreadCount` (schema.prisma:825) are single, shared fields, mutated globally (`mail-client.tsx:1605`, `1620`) — there is one read/unread state for the whole mailbox, not one per viewer.
- There is no assignment, ownership, internal-note, mention, presence/collision, canned-response-sharing, SLA, or routing-rule concept anywhere in the schema or UI.

In short: this is closer to a single IMAP mailbox opened in one browser tab than to a "team inbox" in the Missive/Front/Hiver sense — even though a second person *could* technically log in today (the auth layer supports multiple `User` rows), they'd be looking at the exact same undifferentiated read state, no ownership trail, and no way to talk to a teammate without leaving the app.

The rest of this doc: (1) surveys what genuinely collaborative tools do, (2) synthesizes what's table-stakes vs. differentiator, (3) maps that onto concrete schema/architecture changes here, and (4) proposes a phased roadmap — starting from the honest premise that **Phase 0 is "let a second human safely touch this mailbox at all,"** which nothing downstream can skip.

---

## 1. Comparison Matrix

Scored against the six requested products plus two extra shared-inbox-first competitors (Spike, Loop Email) that came up repeatedly in 2026 comparisons as genuinely relevant to "small-team shared mailbox," which is BluRidge's likely team-mail shape. Shortwave and HubSpot Conversations are covered narratively in §1b rather than in the grid (Shortwave's team features are explicitly the weakest of the set per its own reviewers; HubSpot Conversations is a CRM-attached omnichannel/live-chat inbox, a different product category than "our one business mailbox, shared"). Zendesk is intentionally excluded — every 2026 comparison source found agrees it's enterprise ticketing infrastructure (multi-level routing, workforce management, compliance dashboards) built for teams over ~50 agents doing high-volume queue-based support; for a small business sharing one or two mailboxes it's repeatedly described as "overkill," costing 3-4x a shared-inbox tool for capability BluRidge's shape of team would not use.

| Feature | Missive | Superhuman | Canary Mail | Front | Hiver | Help Scout | Spike | Loop Email |
|---|---|---|---|---|---|---|---|---|
| **Shared/team inbox model** | Core product — one or many shared addresses, real IMAP-style folders | Native "Shared Conversations" layered onto individual Superhuman mailboxes, not a true shared mailbox | "Shared Inbox by Canary" — separate product tier layered on top of the individual AI mail client | Core product — unifies personal *and* shared accounts | Layer on top of real Gmail/Outlook shared mailboxes (no new mail server) | Core product, purpose-built shared inbox for support | "Teamspace" shared inbox alongside personal inbox | Core product, shared inbox + internal chat |
| **Internal comments/notes (never sent out)** | Yes — internal chat/notes on every thread | Yes — "Team Comments," added 2025 (`help.superhuman.com`) | Yes — "Internal Notes" listed as a core Shared Inbox feature | Yes — internal @-comments in-thread, explicitly pitched as a Slack-thread replacement | Yes — internal notes + @mentions | Yes — "private notes" | Yes — shared notes | Yes — internal messages within a thread |
| **@mentions to loop in teammates** | Yes | Yes — mention a colleague to start collaborating | Implied via notes/assignments (not explicitly documented as `@mention`) | Yes | Yes | Yes | Yes (via Teamspace chat/notes) | Yes |
| **Thread assignment/ownership** | Yes — "auto-assignment" + manual | No native concept — Superhuman is still fundamentally single-owner-per-mailbox | Yes — "every email has an owner" | Yes — core feature, with round-robin/load-balancing rules | Yes — with rule-based or round-robin auto-assignment | Yes — assign to a person or a Team | Yes — assign to teammates for clear ownership | Yes — assign ownership + task-style status |
| **Collision detection** | Yes — "no-collision live updates" | Partial — "Team Reply Indicators" show a teammate is drafting/scheduled a send (same goal, lighter mechanism, no hard lock) | Not documented on Canary's own feature page — unclear if this exists beyond assignment-based avoidance | Yes — a named, marketed feature | Yes — alerts both agents before either sends | Yes — visual indicator when a teammate is typing a reply, described in reviews as blocking a conflicting send | Not prominently documented; presence/read-indicator features exist, explicit collision lock unclear | Yes — dedicated "Collision Detection & Alerts" feature page |
| **Shared drafts / draft-approval workflow** | Yes — real-time **collaborative co-drafting** (multiple people editing one draft live) — the most advanced version of this found in the survey | Partial — "Shared Conversations" share history/visibility, not a jointly-edited draft; no approval gate | Not documented | Yes — rules can auto-create a shared draft; teammates can co-view/edit before send | Not prominently featured (assignment-centric, not draft-centric) | Not a named feature | Not documented as distinct from assignment | Not documented as distinct from assignment |
| **Per-user vs. shared read/unread state** | Per-user read state layered above the shared mailbox (each teammate has their own unread view) | N/A in the shared-mailbox sense — "Team Read Statuses" specifically shows *when a specific teammate* (e.g. the deal lead) read a shared conversation, i.e. read state is itself a shared signal, by design | Not documented | Conversation "status" (open/closed) plus per-teammate "assigned to me" views — status is shared, assignment is not | Per-agent email status (open/pending/closed) + assignment; true independent unread-per-agent is layered by Hiver, not inherited from Gmail (Gmail/Outlook's own shared-mailbox unread state is a single shared flag — confirmed via Microsoft's own support docs) | Conversation status (active/pending/closed) shared; "assigned to me" is the per-user lens | Read indicators present; explicit per-user unread-of-shared-thread not detailed | Not detailed |
| **SLA tracking / team analytics** | Team analytics (throughput etc.) on paid tiers; no dedicated SLA engine | None — not a support-desk product | Yes — response time, ownership tracking, bottleneck identification dashboard | Yes — a named, prominent feature: SLA rule builder + breach routing to Slack/tags | Yes — Pro/Elite tiers: first response time, resolution time, CSAT per agent, custom dashboards | Reporting/analytics present (tier-gated); SLA is lighter than Front/Hiver | Not a focus | Analytics mentioned generically, not SLA-specific |
| **Shared canned responses/snippets/templates** | Yes | Not a named feature (Superhuman has personal snippets, not documented as team-shared in the collaboration-feature set) | Implied via "AI-powered replies," not a distinct saved-reply library | Yes | Yes | Yes — "Saved Replies" with merge-field personalization, a flagship feature | Not detailed | Yes — canned responses shared across the whole shared inbox, *and* individual ones per member |
| **Automation/routing rules (round-robin etc.)** | Yes — rules engine, tier-gated (Starter = basic, Productive = advanced) | None | Yes — "AI-Powered Routing" by sender/keyword | Yes — the deepest rules engine surveyed: trigger → condition → action (assign/tag/move/draft/SLA/webhook), with round-robin and load-balancing assignment | Yes — rule-based and round-robin/skill-based routing | Yes — Workflows (trigger-based tagging/assignment/routing/replies), advanced tiers unlock more | Not a focus | Yes — workflow automation mentioned generically |
| **Slack/Teams integration for notifications** | Yes, native | Not found as a named integration (Superhuman is Gmail/Outlook-account-based, not positioned around Slack notifications) | Not documented | Yes | Yes — native, one-click auth, posts activity + @mentions assignee in Slack | Yes — posts events to a chosen channel, @mentions the assignee, shows conversation status changes | Not detailed | Not detailed |
| **Customer/contact context sidebar (mini-CRM)** | Via integrations (Salesforce/HubSpot/Pipedrive) rather than native | Not a focus — Superhuman is an individual-productivity mail client first | Not documented as a distinct sidebar feature | Via integrations + custom fields; "CRM, telephony, knowledge base" are the most popular App Store plugins | Native sync of CRM fields, billing/order history, deal data into the thread (Salesforce/HubSpot/Shopify/NetSuite/Asana/Jira) | Native "Custom Fields" (dropdown/text/number/date) on customers, admin-managed | Not a focus | Not a focus |
| **Permission/role model** | Default roles + "advanced permissions/audit logs" gated to the top (Business) tier | Team-level settings exist (`Team Features` article) but Superhuman is not built around granular per-seat roles the way support-desk tools are | Not documented (no pricing/role detail found on Canary's own collaboration page) | Two defaults (Member, Workspace Admin) + a top Company-Admin role + fully **custom roles/permissions** on Enterprise; roles can differ per shared inbox/workspace | Role-based access as part of its admin console (documented via integrations/admin guides, less granular than Front/Help Scout in public docs) | Four explicit tiers — Account Owner, Administrator, User, Light User — with per-admin/per-user custom permission overrides on Plus/Pro; only Owner can touch billing or Admin permissions | Owner/admin can customize per-member, per-Teamspace permissions | Different access levels configurable per member |

### 1a. Notes on maturity / marketing vs. reality

- **Canary Mail's "Shared Inbox"** is real and shipping (7-day trial, "available on all plans and devices" per its own feature page), but its own marketing pages are thin on permission/role detail and don't document collision detection explicitly — treat it as the least-battle-tested of the six named products, not as a peer of Front/Hiver/Help Scout's years of support-team mileage.
- **Superhuman's team features are genuinely new** (Shared Conversations + Team Comments shipped as a named 2025/2026 release, bundled into the $30/mo Starter plan at no extra cost) but are explicitly an *individual-productivity-tool-plus-collaboration-bolt-on*, not a shared-mailbox product — there is no "one shared address multiple people triage" model the way Missive/Front/Hiver/Help Scout have; it shares *visibility* into conversations, not thread *ownership* across a team the way a support inbox does.
- **Missive is the clear standout for real-time collaborative editing** (co-authoring a single draft live) — no other product surveyed does this as a named, central feature.
- **Front and Hiver are the two most mature "operational" team-inbox tools** (SLA engines, round-robin/load-balancing rules, deep analytics) — this is the category BluRidge would be closest to if it ever needed genuine multi-agent support-style workflows rather than "let two trusted people read/reply from the same address."
- **Help Scout is repeatedly cited as the best fit for small teams** specifically *because* it avoids ticketing-system heaviness while still shipping collision detection, saved replies, and workflows — several 2026 comparisons explicitly frame it as the "lightweight but complete" option, which is closer to BluRidge's actual scale (one CEO + a handful of trusted staff) than Front's enterprise-support posture.

### 1b. Also considered, not tabulated

- **Shortwave** — has real collaboration primitives (private comments, thread assignment, shared/searchable archives, shared AI snippets/labels) built on top of Gmail, but its own reviewers explicitly rank its team/shared-inbox depth below Missive's; a good reference for "AI-forward individual client with collaboration bolted on" but not a top-tier team tool.
- **HubSpot Conversations** — a genuinely capable shared/team inbox, but it's the front-end of HubSpot's CRM, unifying live chat/SMS/WhatsApp/social/bots/team email around Smart CRM contact records. Relevant as an example of "mini-CRM sidebar done natively" (contact info, past orders, cross-channel history), but it's a different product shape (CRM-first, email-secondary) than BluRidge (email-first, single mailbox).
- **Zendesk** — excluded from the grid per the framing in the task and confirmed by research: multiple 2026 sources independently describe it as overkill below ~50 agents/1,000 tickets-a-month, with pricing that reflects enterprise routing/SLA/workforce-management features a small team sharing 1-2 mailboxes would never touch.

---

## 2. Cross-Product Synthesis: What Makes a Team Mail Tool Great

Ranked by how universal/high-value each pattern is across the survey, folding in review commentary (G2/Capterra ratings referenced, blog comparisons, and Reddit-style small-business framing found during research).

### Tier 1 — Table stakes (present in nearly every product surveyed; a team tool without these reads as "not really built for teams")

1. **Shared inbox with a real assignment/ownership model.** Every product in the grid has this. It's the foundational primitive everything else hangs off — "who owns this conversation right now" is the first question a team-mail tool must answer.
2. **Internal notes/comments never sent to the outside world.** Universal. Review commentary repeatedly frames this as the reason teams *stop* running parallel Slack threads or CC-chains just to coordinate about a customer email — Canary's own marketing calls out "confirming every team member stays informed without endless email chains," and this phrasing echoes across multiple vendors' positioning almost verbatim, suggesting it's the single most-repeated value proposition in the category.
3. **@mentions to loop teammates in.** Universal, and usually the trigger for a notification (in-app, email, or Slack).
4. **Collision detection (or an equivalent presence signal).** Present in some form in 6 of 8 surveyed products, and singled out repeatedly in comparison articles as the feature that most directly prevents an embarrassing double-reply to a customer. One review methodology found scored "proactive, real-time" collision indicators (live presence while drafting) higher than "reactive" ones (block only after a duplicate was already sent) — the mechanism's *timing* matters, not just its existence.
5. **Saved replies / canned responses shared across the team.** Universal except where the product is individual-first (Superhuman, Canary less emphasized). Directly reduces onboarding time for new teammates and keeps tone consistent.
6. **Role-based permissions (at least admin vs. everyone-else).** Universal, though granularity varies hugely — Help Scout's 4-tier model with per-user custom overrides and Front's fully custom Enterprise roles are the deep end; Missive/Canary gate "advanced permissions" behind a top pricing tier, implying even they treat granular roles as a premium concern rather than a baseline one.
7. **Slack/Teams notification integration.** Present in every product with real support-team DNA (Front, Hiver, Help Scout, Missive); conspicuously *absent or unfeatured* in the two most individual-first tools (Superhuman, Canary) — a fairly clean signal for "is this actually a team tool or an individual tool with team features bolted on."

### Tier 2 — Common but not universal (strong differentiators, found in roughly half the survey)

8. **Automation/routing rules with round-robin or load-balancing assignment.** Front and Hiver have the deepest engines; Missive/Loop have basic rules; Superhuman/Canary have little-to-none. This is where "team tool" starts to shade into "support-desk tool" — valuable once volume is high enough that manual triage is the bottleneck, overkill below that.
9. **SLA tracking + team analytics dashboards.** Front, Hiver, Canary, and (lighter) Help Scout have this; Missive/Superhuman/Spike don't treat it as core. Clearly a support-operations feature, not a general "team shares a mailbox" feature — the line between "shared inbox" and "help desk" runs almost exactly through this feature.
10. **Native mini-CRM contact sidebar (notes, custom fields, order/deal history).** Hiver (via integration sync) and Help Scout (native custom fields) and HubSpot (native, CRM-first) do this well; Front leans on its App Store/plugins rather than native fields; Missive/Superhuman/Canary don't emphasize it. Valuable specifically for customer-support-shaped mail, less so for a CEO's general correspondence.
11. **Omnichannel unification (SMS/WhatsApp/social alongside email in the same inbox).** Missive, Front, Hiver, Spike, HubSpot all do this; Help Scout partially (chat/social, less SMS-first); Superhuman/Canary are email-only. A real differentiator, but one that assumes the business already needs those channels — not automatically relevant to BluRidge.

### Tier 3 — Rare / genuine differentiators (found in only one or two products)

12. **Real-time collaborative co-drafting** (multiple people literally editing one outgoing draft together, live). Only Missive does this as a named, central feature. This is the single most distinctive team-collaboration feature found in the whole survey.
13. **Cross-team read-state sharing as a *feature*, not a limitation** — Superhuman's "Team Read Statuses" deliberately shows a specific teammate's read state (e.g., "did the deal lead see this") as a shared signal. This is worth flagging because it's the *opposite instinct* from what a naive multi-user read/unread implementation would produce (see §3) — Superhuman treats "who's read this" as something to surface, not just an unread-count bug to avoid.
14. **Hard pre-send draft-approval gates.** Notably, **no product surveyed has an explicit, named "approval required before send" workflow** — "shared drafts" everywhere means *visible/co-editable*, not *gated on a second person's sign-off*. Front's rule engine can auto-*create* a shared draft, but nothing found forces a second human to approve before SMTP dispatch. This is a real gap in the category, and — given this app's own existing "human confirms irreversible actions" thesis (from `ai-email-client-plan.md`) — a legitimate opportunity for BluRidge to build something genuinely ahead of the market if a junior-drafts/senior-approves workflow is ever wanted (e.g., an assistant drafting on the CEO's behalf, gated on CEO approval before send).

### What reviews actually praise/complain about (not just feature checklists)

- **Praise:** Collision detection is the single most consistently singled-out feature across blog/G2-style commentary as the concrete "aha" moment for teams — it's the thing that visibly prevents an embarrassing customer-facing mistake, which makes it easy to point to in a review.
- **Praise:** Internal notes replacing "endless email chains" or a parallel Slack thread is the second most repeated praise pattern — teams frame it as collapsing two tools into one, not just adding a feature.
- **Praise/positioning:** Help Scout is repeatedly recommended over Zendesk/Front for small teams specifically for being "lightweight but complete" — ease-of-setup scores (9.2/10 vs. Front's 8.8/10 in one comparison) and its reputation for support responsiveness come up unprompted in multiple sources.
- **Complaint pattern:** Front's late-2025 pricing changes (AI features unbundled into paid add-ons, a cited example of a 7-person team on Professional + AI landing near $1,070/month) surfaced as a recurring gripe in comparison articles — a caution that "operational" team-inbox tools trend toward add-on-heavy pricing as they mature, worth keeping in mind if BluRidge ever positions any of this as a paid feature tier internally.
- **Complaint/framing pattern:** Multiple sources frame the choice as "shared inbox vs. ticketing system," explicitly warning that ticket-queue framing (Zendesk-style) makes small-team correspondence feel more robotic than customers expect — reinforcing that BluRidge's instinct to look at Missive/Help Scout/Hiver rather than Zendesk-class tools is the right calibration for its scale.

---

## 3. Honest Architecture Assessment

This section maps §1-2's feature set onto what actually exists in `prisma/schema.prisma`, `src/lib/auth.ts`, and `src/components/mail/mail-client.tsx` today, and what each feature would require.

### 3.1 What exists today (the foundation, or lack of one)

| Concern | Current state | File/line |
|---|---|---|
| Auth | NextAuth Credentials provider (email+bcrypt), JWT session, `User.role` set but **never read anywhere in the app** (confirmed via grep — no `session.user.role` branch exists outside auth.ts itself) | `src/lib/auth.ts`, `src/types/next-auth.d.ts` |
| Role model | `enum Role { CEO }` — one value, period | `prisma/schema.prisma:12-14` |
| Per-identity access control precedent | `isFinanceOwnerEmail()` — a single-email allowlist restricting a sensitive area to one person; the *inverse* pattern of what team mail needs (opening access to several people, not narrowing to one) | `src/lib/access.ts` |
| Mailbox↔user link | `MailAccount.userId` — nullable, single-valued FK, no join table | `prisma/schema.prisma:757` |
| Read/unread state | `MailMessage.seen` (one boolean/message) + `MailThread.unreadCount` (one shared counter/thread), both mutated globally with no viewer dimension | `prisma/schema.prisma:867,825`; `mail-client.tsx:1605,1620` |
| Assignment/ownership | None | — |
| Internal notes | None (`MailAiCache` and `MailReminder` are the nearest adjacent models but serve AI-cache and follow-up purposes, not human-authored teammate notes) | `prisma/schema.prisma:990,1005` |
| Mentions/notifications | None — the only "push" mechanism is the IMAP IDLE→SSE new-mail stream, which has no concept of a human-authored mention | `src/lib/mail/idle-watcher.ts` |
| Presence/collision | None — no presence table, no Redis/pub-sub layer of any kind in the mail subsystem | — |
| Canned responses shared across users | None distinct from `MailSignature` (identity-scoped, insert-at-compose-start only, not a searchable mid-compose snippet library) | `prisma/schema.prisma:962` |
| Automation/routing | `MailLabelRule` — label-only action (already flagged as a parity-plan gap for lacking archive/move/delete actions; team assignment would be a third reason to extend it) | `prisma/schema.prisma:1026` |
| SLA/analytics | None — no aggregation job, no reporting model, and (confirmed via the parity plan's own Phase 6 note) **no scheduled job of any kind exists in the mail subsystem today** | — |
| Contact "mini-CRM" | `MailContact` — aggregate stats only (message count, last message, sample subjects); no notes field, no custom fields | `prisma/schema.prisma:1045` |

### 3.2 A structural constraint worth naming explicitly: this is one real IMAP mailbox

Several of the gaps above aren't just "we haven't built it yet" — they reflect a real protocol-level fact worth being honest about: **IMAP itself has exactly one `\Seen` flag per message**, because there is exactly one mailbox on the mail server. This is precisely why Outlook/Exchange shared mailboxes have the well-documented (and frequently complained-about, per Microsoft's own support forums) behavior where one person reading a message marks it read for everyone — it's not a client bug, it's the server-side mailbox model. Missive, Front, Hiver, Help Scout, etc. all solve this the same way: **the app-level per-user read state lives entirely in their own database, decoupled from the underlying mail store's single `\Seen` flag.** BluRidge would need to do the same — keep `MailMessage.seen` as "has the mailbox as a whole (i.e., has anyone) seen this via IMAP," and add a separate, purely-Postgres per-user overlay for "has *this specific teammate* seen it." This is a real modeling decision, not just an additive migration.

### 3.3 Concrete new models/fields required

**Foundational (Phase 0/1 — nothing else in this doc works without these):**

- **`MailAccountMember`** — new join table enabling many `User` rows to access one `MailAccount` with a role:
  ```
  model MailAccountMember {
    id        String   @id @default(cuid())
    accountId String
    account   MailAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
    userId    String
    user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
    role      String   // ADMIN | AGENT | VIEWER
    createdAt DateTime @default(now())
    @@unique([accountId, userId])
  }
  ```
  This replaces the current 1:1-optional `MailAccount.userId` as the source of truth for "who can touch this mailbox," and is where every mail Server Action's authorization check needs to move to (today they only check `requireCeo()`/`requireCeoAction()`, i.e. "is anyone logged in" — every one of the ~40+ actions in `src/actions/mail.ts` would need a second check against this table).
- **Mail-specific role, kept separate from `User.role`.** Recommend *not* growing the global `Role` enum (`CEO` → `CEO | ADMIN | AGENT | VIEWER`) since `User.role` is currently vestigial but its blast radius if repurposed is unknown-but-nonzero (it's serialized onto every session/JWT app-wide). A `MailAccountMember.role` string field, scoped only to mail authorization, is a smaller and safer surface.
- **Per-user read state** — a new `MailThreadReadState` (or per-message) table:
  ```
  model MailThreadReadState {
    id            String   @id @default(cuid())
    threadId      String
    thread        MailThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
    userId        String
    lastReadAt    DateTime?
    updatedAt     DateTime @updatedAt
    @@unique([threadId, userId])
  }
  ```
  Per-viewer unread count becomes "messages in thread newer than `lastReadAt` for this user," computed at read time rather than stored as a single denormalized `MailThread.unreadCount`. The existing shared `unreadCount`/`seen` fields stay as the IMAP-level "has anyone seen this" signal (see §3.2) rather than being deleted outright.

**Assignment/ownership:**

- Simplest form: add `assignedToUserId String?` directly on `MailThread` (matches the single-assignee default in Front/Hiver/Help Scout). Escalate to a dedicated `MailThreadAssignment` history table only if "who assigned this, when, and what it was reassigned from" needs to be queryable later (e.g. for the SLA/analytics phase).

**Internal notes + mentions:**

- **`MailInternalNote`**: `{ id, threadId, messageId?, authorUserId, bodyHtml, createdAt, updatedAt }` — rendered only in-app, never touches `MailOutbox`/SMTP.
- **`MailMention`**: `{ id, noteId, mentionedUserId, readAt?, createdAt }` — feeds a notification surface. Note there is currently **no notification delivery mechanism in this app at all** beyond the SSE new-mail push (`idle-watcher.ts`) — a mention needs its own delivery path (in-app bell at minimum; email/Slack webhook as a stretch, itself requiring the Slack integration called out in §1/§2).

**Collision detection / presence:**

- No presence system exists anywhere in the codebase today. Lightest-weight option: an ephemeral `MailThreadPresence` row (or a short-TTL Redis/in-memory key, if the deploy already has Redis available — needs checking) recording `{ threadId, userId, state: VIEWING|DRAFTING, updatedAt }`, broadcast over the **existing** SSE bus (`/api/mail/live`, already built for IMAP IDLE push) — this is a genuine reuse opportunity, since the hard part (a working real-time channel to the open tab) is already built for a different purpose.

**Shared canned responses:**

- New `MailSnippet`/`MailTemplate` model, sibling to `MailSignature` but insertable mid-compose (slash-command or picker) rather than only at compose-start: `{ id, accountId, name, bodyHtml, shortcut?, sortOrder, createdByUserId }`.

**Automation/routing for assignment:**

- Extend `MailLabelRule`'s action model (already flagged in the parity plan as needing to grow beyond "add label") with an `assignToUserId` / round-robin action type. This makes team routing the *third* independent reason to do that extension (the parity plan's Phase 5 wanted archive/move/mark-read actions too) — a good signal it's worth designing the action model generically once rather than bolting on a third special case.

**SLA/analytics:**

- The heaviest lift in this doc. Requires either a scheduled aggregation job (and the mail subsystem has **zero** scheduled jobs of any kind today — this would be the first) or a `MailSlaEvent`/reporting table populated at write time (on assign, on first reply, on close) and rolled up on read. Recommend the write-time-event approach over a cron job — it avoids introducing new deploy/infra dependencies (a job runner) purely for reporting.

**Mini-CRM contact context:**

- Smallest lift of the "differentiator" tier — `MailContact` already exists and is populated at sync (`upsertContactsFromMessage`). Add a `notesJson`/`customFieldsJson` column or a small `MailContactNote` model rather than a new subsystem.

---

## 4. Phased Implementation Roadmap

Ordered by value vs. effort, in the same spirit as `mail-feature-parity-plan.md`'s roadmap — but note the shape is different here: **every phase after Phase 0 is blocked on it**, because nothing in §1-2 makes sense while there is structurally one viewer of one mailbox with one shared read state.

### Phase 0 — Multi-user access to the same mailbox, with permissions (foundational; blocks everything below)

**Requires product-direction sign-off before any engineering — see §5.** Not a normal "gap," a change to the product's core premise.

- `MailAccountMember` join table + mail-scoped role (ADMIN/AGENT/VIEWER), replacing the 1:1-optional `MailAccount.userId`.
- Retrofit every mail Server Action in `src/actions/mail.ts` (all ~40+) to check membership+role via the new table, not just "is anyone logged in" via `requireCeo()`.
- Per-user read state (`MailThreadReadState`), decoupled from the shared `MailMessage.seen`/`MailThread.unreadCount` per §3.2 — this alone touches every place `unreadCount` is read or written in `mail-client.tsx` (at minimum lines 152, 1310, 1605, 1620, 4194, 4237, 4259).
- A minimal admin UI to invite/create additional `User` rows scoped to the mailbox (today, the only way a second `User` row gets created is `prisma/seed.ts` — there is no in-app flow at all).
- **Files**: `prisma/schema.prisma`, `src/actions/mail.ts`, `src/lib/session.ts` (new `requireMailRole()` helper alongside existing `requireCeo`/`requireFinanceOwner`), `src/components/mail/mail-client.tsx`, a new admin/invite page.

### Phase 1 — Thread assignment + internal notes (highest collaboration value once Phase 0 exists)

The two Tier-1 table-stakes features from §2 that aren't already implied by Phase 0.

- `assignedToUserId` on `MailThread`; an "Assign to…" control in the thread list/reader; an "Assigned to me" filter view.
- `MailInternalNote` model + a notes panel in `message-reader.tsx`/`mail-client.tsx`, rendered distinctly from the message body (never included in reply/forward quoting) and clearly labeled as internal-only so no one mistakes it for part of the outgoing thread.
- **Files**: `prisma/schema.prisma`, `src/actions/mail.ts`, `src/components/mail/mail-client.tsx`, `src/components/mail/message-reader.tsx`.

### Phase 2 — @Mentions + notifications

Closes the loop on Phase 1's notes — a note nobody is told about doesn't drive collaboration.

- `MailMention` model, an @-autocomplete in the note-composer (can reuse the same contact-autocomplete UI work already scoped in the parity plan's Phase 3 for compose To/Cc), and an in-app notification surface (a bell/badge at minimum).
- Stretch: Slack webhook delivery for mentions/assignments, matching the pattern every mature competitor in §1/§2 has (Front, Hiver, Help Scout, Missive all notify to Slack).
- **Files**: `prisma/schema.prisma`, `src/actions/mail.ts`, `src/components/mail/mail-client.tsx`, a new notification-bell component, optionally a new `src/lib/mail/slack-notify.ts`.

### Phase 3 — Collision detection (presence while drafting)

Reuses the one piece of real-time infra this app already has.

- `MailThreadPresence` (ephemeral) + broadcast over the existing `/api/mail/live` SSE channel from `idle-watcher.ts`; a small "Akshay is replying…" indicator in the thread list/composer, matching the proactive (not just reactive/post-hoc) pattern review commentary favored in §2.
- **Files**: `src/lib/mail/idle-watcher.ts`, `src/components/mail/mail-client.tsx`, `prisma/schema.prisma` (or an in-memory/Redis store if presence rows are judged too heavy for Postgres — needs an infra decision).

### Phase 4 — Shared canned responses + team-aware automation rules

Lower urgency than Phases 0-3 (nice-to-have efficiency, not a missing collaboration primitive) but low-medium effort given adjacent scaffolding already exists.

- `MailSnippet`/`MailTemplate` model + mid-compose picker (sibling to the existing `MailSignature` UI in `signatures-panel.tsx`).
- Extend `MailLabelRule`'s action model with an `assignToUserId`/round-robin action — the same extension point the parity plan already wants for archive/move/mark-read, now with a third reason to build it generically.
- **Files**: `prisma/schema.prisma`, `src/lib/mail/ai/label-rules.ts`, `src/actions/mail.ts`, a new snippet-panel component.

### Phase 5 — Mini-CRM contact context + SLA/analytics

Highest effort, most infrastructure-dependent, and — per §2 — the pair of features that most clearly signal "support desk" rather than "shared mailbox." Only worth doing if BluRidge's mail usage genuinely grows into multi-agent customer-support-shaped work rather than staying "a CEO plus a couple of trusted staff reading one inbox."

- Extend `MailContact` with notes/custom fields (small lift, existing model).
- SLA/analytics: write-time `MailSlaEvent` rows on assign/first-reply/close + a rollup view, avoiding a net-new scheduled-job dependency (see §3.3's recommendation against a cron-based approach).
- **Files**: `prisma/schema.prisma`, `src/lib/mail/contacts.ts`, a new `src/lib/mail/sla.ts`, a new analytics view/component.

### Explicitly deferred / not recommended to build speculatively

- **Omnichannel unification** (SMS/WhatsApp/social in the same inbox, à la Missive/Front/Hiver/Spike) — a large, separate infrastructure commitment (new channel providers, not just new schema) with no signal yet that BluRidge's team correspondence needs anything beyond email. Revisit only if the product direction explicitly wants it.
- **Real-time collaborative co-drafting** (Missive's standout differentiator) — genuinely impressive but a large editor-infrastructure lift (operational-transform or CRDT-backed shared editing on top of the existing TipTap composer) for a feature no other surveyed product besides Missive has prioritized. Worth a second look only after Phases 0-2 land and prove there's real multi-person drafting demand.
- **Hard pre-send draft-approval gate** — flagged in §2 as a genuine category gap (no competitor has it) and a plausible differentiator given this app's existing "human confirms irreversible actions" thesis, but it's a product decision (who approves what, under what circumstances) before it's an engineering one — do not build without an explicit conversation, and only after Phase 0's role model exists to define who "the approver" even is.

---

## 5. Requires Explicit Product-Direction Sign-Off Before Building Anything

This entire document assumes a premise the product has never actually adopted: **more than one human safely operating on akshay@thebluridge.com.** Every existing piece of documentation (`ai-email-client-plan.md`, `mail-feature-parity-plan.md`) is explicit that this is a **single-CEO, single-mailbox product by design**, not by oversight — the parity plan calls multi-account support "explicitly against the product thesis" and says "do not build unless the product direction changes." This doc is that "if it changes" exploration, and it should be read as such:

1. **Opening akshay@thebluridge.com to additional logins at all is a product-direction decision, not an engineering task.** Who gets access, at what role, to what's currently one CEO's personal-and-business correspondence, is a business/trust decision that has to be made explicitly before Phase 0 starts — not discovered as a side effect of shipping a schema migration.
2. **Per-user read state changes what "unread" *means*** — once several people can read the same thread, "unread" stops being "the CEO hasn't seen this" and becomes "this specific teammate hasn't seen this." Any AI feature that currently reasons about `unreadCount`/`seen` as a proxy for "the CEO's attention" (triage, digests, follow-up nudges — see `ai-email-client-plan.md`) needs to be re-examined for whose attention it's now tracking.
3. **Internal notes and mentions put a permanent, in-app conversation trail on top of what is otherwise private correspondence with real vendors/clients/counsel** — worth an explicit decision on retention, visibility (can a VIEWER-role person see notes an ADMIN wrote about a sensitive matter?), and whether notes are ever exportable/discoverable in a way that matters for the business.
4. **A role model needs an explicit definition of what ADMIN/AGENT/VIEWER actually means for this specific mailbox** before it's built — e.g., can an AGENT permanently delete mail, block a sender, change autonomy settings (`MailAutonomySettings`), or set up a vacation responder? The parity plan's own destructive-action sign-off section (permanent delete, autonomy settings, vacation responder) becomes materially more sensitive once it's not just "the CEO can shoot themselves in the foot" but "a teammate can take an irreversible action on the CEO's mailbox."
5. **Any Slack/Teams notification integration means mail content (subject lines, note text, mentions) leaving this app's own database and Postgres-backed storage for a third-party workspace** — a data-residency/confidentiality question worth a direct conversation given the mailbox handles legal/financial correspondence (per the existing finance-owner-email gating precedent in `src/lib/access.ts`, this app already treats some of its own content as sensitive enough to restrict to one person).

None of Phase 0 (or anything built on top of it) should be scoped into a sprint or implemented without a direct conversation with the CEO confirming the underlying premise — "more than one person, safely, on this mailbox" — is actually wanted, independent of how mechanically straightforward any individual piece of §3/§4 looks in isolation.

---

## Sources

- [Missive — 7 Best Shared Inbox Tools 2026 (Canary Mail Blog)](https://canarymail.io/blog/best-shared-inbox-tools)
- [Missive Pricing](https://missiveapp.com/pricing)
- [Missive Pricing Explained: Plans, Costs & Value](https://www.featurebase.app/blog/missive-pricing)
- [Missive Review 2026 (Efficient App)](https://efficient.app/apps/missive)
- [Missive Reviews (G2)](https://www.g2.com/products/missive/reviews)
- [9 best Help Scout alternatives for 2026 (Missive Blog)](https://missiveapp.com/blog/helpscout-alternatives)
- [Shared Conversations and Team Comments — Superhuman Help Center](https://help.superhuman.com/hc/en-us/articles/38457432565267-Shared-Conversations-and-Team-Comments)
- [Team Features — Superhuman](https://help.superhuman.com/hc/en-us/articles/49369800640147-Team-Features)
- [Supercharge Your Team with Superhuman Mail](https://help.superhuman.com/hc/en-us/articles/45272347015827-Supercharge-Your-Team-with-Superhuman-Mail)
- [Shared Conversations — Superhuman](https://help.superhuman.com/hc/en-us/articles/38450322526995-Shared-Conversations)
- [Superhuman Releases Team Comments & Shared Conversations (Efficient App)](https://efficient.app/blog/superhuman-releases-team-comments-shared-conversations)
- [Shared Conversations & Team Comments for everyone — Superhuman Mail updates](https://new.superhuman.com/shared-conversations-team-comments-for-everyone-302784)
- [Shared Inbox by Canary — Team Collaboration Made Simple (Canary Mail Blog)](https://canarymail.io/blog/shared-inbox-by-canary)
- [Collaboration Tools — Shared Inbox by Canary](https://canarymail.io/features/collaboration)
- [Canary Mail Features](https://canarymail.io/features)
- [Best Front Alternatives for Shared Inbox & Team Collaboration (Canary Mail Blog)](https://canarymail.io/blog/top-front-alternatives)
- [Front Review 2026 (thectoclub)](https://thectoclub.com/tools/front-review/)
- [What Is Front? The Customer-Ops & Shared-Inbox App Explained (getmacha)](https://www.getmacha.com/blog/what-is-front-app)
- [Front Shared Inbox Explained (getmacha)](https://www.getmacha.com/blog/front-shared-inbox-explained)
- [Front Rules Explained: The Automation Engine (getmacha)](https://www.getmacha.com/blog/front-rules-explained)
- [Front Assignment Explained: Assign, Round-Robin & Load Balancing (getmacha)](https://www.getmacha.com/blog/front-assignment-explained)
- [Customer Service SLA: The Complete Guide — Front](https://front.com/guides/service-level-agreement-rules)
- [Front's workspace rule library](https://help.front.com/en/articles/2114)
- [Understanding rules — Front Help](https://help.front.com/en/articles/2105)
- [Admin roles — Front Help](https://help.frontapp.com/t/8029ym/admin-roles)
- [Default roles and permissions — Front Help](https://help.front.com/en/articles/2118)
- [Custom roles and permissions — Front Help](https://help.frontapp.com/t/m2290g/custom-roles-and-permissions)
- [Teammate groups — Front Help](https://help.front.com/en/articles/2087)
- [Front vs Help Scout (Hiver Blog)](https://hiverhq.com/blog/front-vs-help-scout)
- [Help Scout vs. Front: A Deep-Dive Comparison](https://www.helpscout.com/compare/frontapp/)
- [Front vs. Help Scout — Front](https://front.com/compare/front-vs-help-scout)
- [Hiver — Shared Inbox software 2026 (Guideflow Blog)](https://www.guideflow.com/blog/shared-inbox-software-tools)
- [Hiver Review 2026 (Research.com)](https://research.com/software/reviews/hiver)
- [Distribution List vs. Shared Mailbox vs. Shared Inbox — Hiver](https://hiverhq.com/blog/distribution-list-vs-shared-mailbox)
- [12 best shared inbox software in 2026 — Hiver](https://hiverhq.com/blog/best-shared-inbox-software)
- [Integrate Slack with Hiver](https://hiverhq.com/integrations/slack)
- [Hiver-Slack Integration Guide](https://help.hiverhq.com/connectors/hiver-slack-integration)
- [Hiver Integrations](https://hiverhq.com/integrations)
- [The 7 Best Shared Inbox Software: Reviewed & Compared — Help Scout](https://www.helpscout.com/blog/shared-inbox/)
- [What Is A Shared Inbox? — Help Scout Support](https://docs.helpscout.com/article/1581-what-is-shared-inbox)
- [User Roles and Permissions — Help Scout Support](https://docs.helpscout.com/article/15-user-roles-and-permissions)
- [An Admin's Guide to Help Scout](https://docs.helpscout.com/article/1076-an-admins-guide-to-help-scout)
- [Work With Custom Fields — Help Scout Support](https://docs.helpscout.com/article/593-custom-fields)
- [Integrate Slack with Help Scout](https://www.helpscout.com/help-desk-integration/slack/)
- [What Features Does Help Scout Have? (Gorgias Blog)](https://www.gorgias.com/blog/help-scout-features)
- [Spike's Shared Inbox Redefines Team Collaboration](https://www.spikenow.com/blog/team-collaboration/spike-shared-inbox/)
- [Shared Inbox for Teams — Spike](https://www.spikenow.com/features/shared-inbox/)
- [Spike Teamspace adds shared inbox support (9to5Mac)](https://9to5mac.com/2024/03/17/spike-shared-inbox/)
- [11 Best Loop Email Alternatives for Team Inbox Analytics (emailanalytics)](https://emailanalytics.com/loop-email-alternatives/)
- [Collision Detection & Alerts — Loop](https://www.intheloop.io/features/collision-detection/)
- [Can Shortwave Email Help Create Epic Campaigns? 2026 Review (Woodpecker)](https://woodpecker.co/blog/shortwave/)
- [Shortwave Review 2026 (this+that)](https://www.thisandthat.chat/blog/shortwave-review/)
- [Overview of the conversations inbox — HubSpot Knowledge Base](https://knowledge.hubspot.com/inbox/overview-of-the-conversations-inbox)
- [Collaborate with your team in the conversations inbox — HubSpot](https://knowledge.hubspot.com/inbox/collaborate-with-your-team-in-the-conversations-inbox)
- [Close Tickets Faster with Free Shared Inbox Software — HubSpot](https://www.hubspot.com/products/crm/conversations)
- [8 best Zendesk alternatives and competitors for 2026 (Missive Blog)](https://missiveapp.com/blog/zendesk-alternatives)
- [Top Zendesk Alternatives For Small Business Service — Salesforce Blog](https://www.salesforce.com/blog/small-business/zendesk-alternatives-for-small-business/)
- [Zendesk vs Zoho Desk 2026 — ClonePartner Blog](https://clonepartner.com/blog/zendesk-vs-zoho-desk-2026-the-operations-leads-decision-matrix)
- [Shared mailbox — individual mail read/unread option — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/4660699/shared-mailbox-individual-mail-read-unread-option)
- [Shared Mailbox is individual read/unread status possible? — Google Workspace Admin Community](https://support.google.com/a/thread/199619296/shared-mailbox-is-individual-read-unread-status-possible?hl=en)
- [If two or more people have access to the same mailbox in Outlook... — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/928382/if-two-or-more-people-have-access-to-the-same-mail)
