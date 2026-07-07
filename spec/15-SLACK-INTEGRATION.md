# 15 — Slack Integration

> **Status:** DRAFT — decisions D1–D4 RESOLVED (2026-07-07). Awaiting build go.
> **Owner:** Marketing OS core
> **Depends on:** 11-HOSTED-PATH (control plane, pooled runtime, chat handoff), 12-STORE-MCP (credential model, broker posture, router pattern), 13-CONSOLE-DESIGN-RETROFIT (Integrations surface)
> **Lives in:** `marketing-os-app` (control plane) almost entirely; template/runtime changes are minimal-to-zero for Phase S0–S3.
> **First target:** Arthaus workspace, then every hosted tenant.

---

## 0. The thesis

The console is a **destination**; Slack is **ambient**. Today a merchant interacts with their marketing agents in three places — the embedded Shopify-admin console, the branded client-owned console, and MCP clients (Claude, Cursor). All three require *going somewhere*. The merchant's team already lives in Slack, and the highest-frequency agent interactions — "how did the weekend sale do?", "draft three subject lines", "what's the status of that homepage proposal?" — are exactly the kind of low-ceremony, conversational asks that die when they cost a context switch.

A Slack integration makes the marketing agent a **coworker instead of a console**: DM it, @mention it in `#marketing`, get the weekly review pushed to the channel where the team already discusses it, approve a storefront proposal from the message that announced it. This is also the retention surface — a bot that talks in your team's channel every week is structurally harder to churn than a dashboard nobody opens.

**Scope claim:** Slack is a *fourth interaction surface* over the existing agent runtime — not a new agent, not a new credential seam, not a fork. It reuses the pooled runtime's `/api/chat`, the platform's HMAC handoff, the Google-OAuth breakout pattern, and the connector-token revocation model. The net-new work is: Slack OAuth + installation mapping, an events endpoint with Slack's ack discipline, thread↔memory continuity, and (later) an outbound notifier.

---

## 1. Product shape

**One-click install.** In the embedded admin (`app.integrations`), a "Add to Slack" button. Merchant clicks, approves the Slack OAuth consent screen in their workspace, lands back in the console with the connection live. No tokens shown, no config, no webhook URLs. Under 60 seconds. Single-store merchants are done here. Agencies with several stores in one workspace bind additional channels to additional stores from each store's admin (§4).

**Then, in Slack:**
- **DM the bot** → full conversation with `marketing-agent`, same brain as the console.
- **@mention in a channel** (`@Marketing OS how did CAC trend this week?`) → agent replies in-thread.
- **Threads are conversations.** Replies in a thread share memory; a new thread/DM burst is a fresh conversation. Maps 1:1 onto Mastra memory threads.
- **`/mos` slash command** for quick asks and utilities (`/mos status`, `/mos weekly`).
- **Proactive pushes (Phase S4):** weekly review digest to a chosen channel; proposal-ready notifications with **Preview / Approve** buttons that drive the existing draft-theme proposal loop.

**Explicitly not** (v1): Slack-native canvas/workflow-builder integrations, per-user DM identity mapping to Shopify staff accounts, file-upload ingestion, and any path where Slack becomes a credential holder. (Multi-store *per workspace* is in — D2; multi-*workspace* per store is not.)

---

## 2. Architecture

### 2.1 One platform Slack app, multi-tenant (D1)

A single Slack app — **"Marketing OS"** — owned by the platform, distributed via standard OAuth v2 (unlisted at first; App Directory listing is a later, separate track). Per-tenant Slack apps are rejected: they'd multiply signing secrets, break one-click install, and buy nothing. Tenancy is resolved per-request, exactly the way the pooled runtime resolves it from handoff headers today (never implied by deployment, spec 11 §3). All code lives in `marketing-os-app`.

**The workspace is the install; the channel is the store binding (D2 — multi-store from day one).** One Slack workspace can serve **many** stores. This is the agency reality: a partner running Arthaus, plus three other clients, works out of a single Slack. So the two concerns split:

- **Installation** is workspace-level: one OAuth grant, one bot token, one `team_id`, owned by the workspace.
- **Store binding** is channel-level: each channel (or DM) is bound to exactly one tenant. `#arthaus` → Arthaus, `#acme-store` → Acme. Resolution is `(team_id, channel_id)` → tenant, so a single message unambiguously routes to one store's agent and one store's memory.

An **unbound** channel gets a friendly ephemeral nudge ("This channel isn't linked to a store yet — pick one: …") rather than guessing. The workspace's *default* store (set at install) handles DMs and any channel without an explicit binding, so a single-store merchant never sees a binding step — multi-store is progressive, not upfront tax.

Bot token scopes, minimal set: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `commands`, `users:read`. Add `files:write` (chart images) and `reactions:write` (ack emoji) when those features land — scope additions re-prompt, so start lean.

### 2.2 Everything lives on the control plane

New surfaces in `marketing-os-app`, mirroring the Google OAuth + webhook patterns file-for-file:

| Surface | Route | Mirrors |
|---|---|---|
| OAuth start (top-level breakout, signed state) | `app/routes/slack.oauth.start.tsx` | `api.oauth.google.start.tsx` |
| OAuth callback (code→token, store install) | `app/routes/slack.oauth.callback.tsx` | `api.oauth.google.callback.tsx` |
| Events API + slash + interactivity receiver | `app/routes/slack.events.tsx` | `webhooks.*.tsx` (ack-fast + `waitUntil`) |
| Server logic (signature verify, team→tenant, Slack Web API client, thread mapping) | `app/lib/slack.server.ts` | `oauth.server.ts` + `connector-tokens.server.ts` |
| Embedded admin UI (connect, channel config, revoke) | section in `app/routes/app.integrations.tsx` | existing GA4 block |

The pooled runtime (`marketing-os-hosted-agents`) is **unchanged**: Slack traffic enters through the existing `/api/chat` with the existing `x-mos-chat-*` HMAC handoff (mint side as `app.console.tsx:31-79`, verify side `lib/proxy-auth.ts`). No new runtime opening in `middleware.ts`.

### 2.3 Data model

The install and the store binding are separate rows — this is what makes multi-store (D2) structural rather than bolted on.

```prisma
// Workspace-level: the OAuth grant. One per Slack workspace.
model SlackInstallation {
  id              String   @id @default(cuid())
  teamId          String   @unique      // Slack workspace
  teamName        String
  botUserId       String
  botTokenRef     String                // Supabase Vault secret_ref — token NEVER in Prisma
  scopes          String
  installedBy     String                // Slack user id of installer
  defaultTenantId String?               // DMs + unbound channels route here (set at install)
  status          String   @default("active")  // active | revoked
  createdAt       DateTime @default(now())
}

// Channel-level: which store a channel talks to. Many per workspace.
model SlackChannelBinding {
  id            String  @id @default(cuid())
  teamId        String
  channelId     String
  tenantId      String                  // the store this channel is bound to
  digestChannel Boolean @default(false) // is this a proactive-push destination (S4)
  boundBy       String                  // Slack user id who bound it
  createdAt     DateTime @default(now())
  @@unique([teamId, channelId])         // a channel maps to exactly one store
}

// Entitlement: a store's admin has accepted an invite to bind channels in a workspace it
// did not install. Absent for the installing store (entitled implicitly) and for same-Account
// stores (entitled via the Account grouping). One row per (workspace, invited store).
model SlackWorkspaceEntitlement {
  id         String @id @default(cuid())
  teamId     String                     // the workspace
  tenantId   String                     // the store now entitled to bind channels here
  grantedVia String                     // "installer" | "invite" | "account"
  grantedBy  String?                    // Slack user id of installer, if via invite
  createdAt  DateTime @default(now())
  @@unique([teamId, tenantId])
}

// Conversation continuity: a Slack thread ↔ a Mastra memory thread, scoped to the resolved store.
model SlackThread {
  id             String @id @default(cuid())
  teamId         String
  channelId      String
  threadTs       String                 // Slack thread anchor
  tenantId       String                 // resolved store (denormalized for isolation checks)
  memoryThreadId String                 // Mastra memory thread in tenant_<slug> schema
  @@unique([teamId, channelId, threadTs])
}
```

The Slack installation is the **sixth credential** in the platform's model (PLATFORM.md §2): independently revocable from the embedded admin, bot token in **Supabase Vault** exactly like Google refresh tokens (`provider_connections.secret_ref` pattern). Revoke = mark installation revoked + call Slack `auth.revoke` + delete Vault secret + tombstone that workspace's channel bindings. Nothing durable ever reaches tenant infra — broker-only credential seam invariant holds (spec 11 §6).

**A subtlety multi-store forces, and how it resolves:** one Slack app serves multiple tenants, but each tenant is a distinct store with its own admin. Binding a channel to a store requires **two facts to be true at once** — the *workspace* consents to accept that store, and the actor *administers* that store. Store B's embedded admin proves the second (App Bridge session → store B tenant); the `SlackWorkspaceEntitlement` row proves the first. A store may bind channels in a workspace only if it is **entitled**, and a store becomes entitled by exactly one of three routes (the installer-invite / agency-grouping mechanism, §4):

1. **Installer** — the store that ran the OAuth install is entitled implicitly (`grantedVia: "installer"`, no row needed; `SlackInstallation.defaultTenantId` already marks it).
2. **Account grouping** — if store B shares a platform `Account` with the installing store (the existing `Account → Tenant` relation in `prisma/schema.prisma`), it is auto-entitled (`grantedVia: "account"`). This is the true-agency path: a partner whose stores live under one account attaches any of them with zero ceremony.
3. **Installer invite** — for stores *outside* the installer's account (looser arrangements), the installer issues a signed, time-boxed **bind-invite** (HMAC over `{teamId, nonce, expiry}` with `OAUTH_STATE_SECRET`, same stateless pattern as OAuth state). Store B's admin opens it inside their own embedded admin; the signature proves workspace consent, the session proves store admin, and a `SlackWorkspaceEntitlement` row is written (`grantedVia: "invite"`).

This closes the gap the earlier draft flagged: no Slack-user ↔ store-admin identity proof is ever needed. Entitlement lives on the platform between two things it already trusts — a store's App Bridge session and an HMAC it minted. An un-entitled store simply cannot bind a channel; the install token being workspace-shared grants nothing on its own.

### 2.4 The auth chain, end to end

```
Slack POST /slack/events
  → verify Slack signing secret (v0 HMAC, 5-min timestamp window)   [new verifier, joins the HMAC family in app/lib/]
  → dedupe on event_id (Slack retries: x-slack-retry-num)
  → team_id → SlackInstallation (active?)                           [workspace resolution]
  → (team_id, channel_id) → SlackChannelBinding → tenant            [store resolution; DM/unbound → defaultTenantId]
       └─ no binding & no default → ephemeral "link this channel to a store", stop
  → ack 200 within 3s; continue via waitUntil
  → mint x-mos-chat-{shop,ts,sig} (HMAC over chat.{shop}.{ts}, MCP_PROXY_SECRET)  [shop = resolved tenant]
  → POST pooled runtime /api/chat  (hosted)  |  POST tenant.agentsUrl /api/chat (client-deployed, §5)
  → stream agent reply → chat.postMessage / chat.update into the thread
```

The two-step resolution (workspace → store) is the whole of the multi-store mechanism. Everything downstream — the handoff, the runtime's `runWithTenant` context, memory — sees exactly one shop, so the pooled runtime is oblivious to whether the workspace serves one store or twelve.

---

## 3. The chat loop

**Ack discipline.** Slack requires a 200 within 3 seconds and retries up to 3× otherwise. The receiver verifies, dedupes (`event_id` in a short-TTL table or memory cache keyed with the retry header), resolves tenant, returns 200, and does all agent work post-ack via `waitUntil` — the exact pattern `webhooks.compliance.tsx` uses today.

**Progressive reply.** On dispatch, immediately `chat.postMessage` a placeholder in-thread ("_thinking…_" or an hourglass reaction), then consume the runtime's stream and `chat.update` the message on a ~1s throttle, finishing with the final text (Slack `mrkdwn`, converted from the agent's markdown). Long agent turns (tool-heavy, minutes) exceed comfortable `waitUntil` budgets → enqueue on the **existing job runner** (`POST /api/jobs`, drain cron) with the placeholder message as the completion target. Heuristic in v1: run in-request, hand off to the queue if the turn exceeds a wall-clock threshold; the placeholder message makes the two paths indistinguishable to the user.

**Thread ↔ memory continuity.** `(team_id, channel_id, thread_ts)` → `SlackThread.memoryThreadId`, created on first message, passed to the runtime so Mastra memory (Postgres, `tenant_<slug>` schema) gives Slack conversations the same continuity the console has. A DM without a thread uses the DM channel + the message's own `ts` as anchor (Slack convention: replying in-thread continues; a fresh top-level message starts fresh).

**Identity into the agent.** Resolve the Slack user's display name (`users.read`) and prefix the runtime call's context ("Slack user Dana asked, in #marketing: …") so agent memory and audit trails are attributable. This is *attribution*, not authorization — authorization is D3.

**Formatting.** Text-first. The runtime's UIMessage/GenUI parts (charts, approval widgets) degrade to text + console deep-links in v1; chart images via `files.upload` and Block Kit cards are S3 polish. The hosted runtime's current plain-text streaming (PLATFORM.md §11 known gap) is *sufficient* for Slack — Slack does not block on the UIMessage re-merge.

---

## 4. The install flow

App Bridge iframes cannot host a third-party OAuth consent screen, so the flow reuses the **signed-state top-level breakout** built for Google (D3 precedent, spec 11):

1. Embedded `app.integrations` loader mints an HMAC state (`OAUTH_STATE_SECRET`, carries shop + nonce + expiry) and renders "Add to Slack".
2. Click → top-level nav to `slack.oauth.start` → verifies state → redirects to `slack.com/oauth/v2/authorize` with bot scopes.
3. Slack consent → callback with `code` → `oauth.v2.access` → bot token into Vault, `SlackInstallation` row written, `defaultTenantId` set to the tenant from the state (so the installing store works immediately with zero channel config).
4. Redirect back into the embedded admin; the Integrations tab shows the connected workspace, installer, a Disconnect button, and — for multi-store — the **channel-binding manager**. Bot posts a one-time welcome DM to the installer ("You're connected. DM me or @mention me in a channel…").

**Binding channels to stores (multi-store, D2).** For the common single-store merchant, nothing more is needed — DMs and every channel fall through to the default store. Adding *other* stores to the same workspace runs through the **installer-invite / agency-grouping** mechanism (the resolution of the earlier §11.5 open question), which turns on the `SlackWorkspaceEntitlement` model (§2.3):

- **Same-account stores (agency path).** A partner whose stores live under one platform `Account` sees, in each store's Integrations tab, "This workspace is connected via your account" — no invite needed. They pick a channel the bot is in (`conversations.list`), confirm, and a `SlackChannelBinding` is written. Auto-entitlement via the existing `Account → Tenant` relation; this is the frictionless path for a real agency.
- **Outside-account stores (invite path).** The installer opens the workspace's Integrations tab and generates a **bind-invite** — a signed, expiring link (HMAC over `{teamId, nonce, expiry}`, `OAUTH_STATE_SECRET`). They send it to the other store's operator. That operator opens it *inside their own embedded admin*; the platform verifies the signature (workspace consent) against their App Bridge session (store admin), writes a `SlackWorkspaceEntitlement`, and they can now bind channels exactly like the agency path.
- **In-Slack shortcut (S2).** Once entitled, `/mos link` in a channel returns an ephemeral store-picker limited to that workspace's entitled stores, writing the `SlackChannelBinding` without leaving Slack.

Installation is **workspace-level, merchant-admin-initiated**; entitlement is **per-store, granted by account-membership or a signed installer invite**; channel binding is **per-store-admin-authorized**. Every step reduces to two things the platform already trusts — an App Bridge session and an HMAC it minted — so no new identity infrastructure is introduced (§2.3).

---

## 5. Tiers

**Hosted (default, primary path):** everything above. Slack front door on the platform, handoff to the pooled runtime, tenant resolved per request. Structural isolation, zero tenant-side moving parts.

**Client-deployed / managed:** the Slack front door **stays platform-hosted** and proxies to the tenant's own deployment — `POST tenant.agentsUrl /api/chat` with the same signed handoff, exactly the pattern the MCP edge router uses (`api.mcp.tsx` → `agentsUrl`). The client's deployment needs no Slack code, no Slack secrets, no inbound-webhook exposure; it already verifies `x-mos-chat-*`. This keeps one Slack app, one signing secret, one events URL for the entire fleet — and honors the one-template-tree invariant (hosted behavior stays env-driven, never a fork).

**Eject (full exit):** the tenant registers *their own* Slack app and points it at their own deployment. The template grows an optional, env-gated `/api/slack/events` route (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` in their env) implementing the same receiver contract. This is S5, documentation-plus-template work, and is what makes the platform path non-lock-in — same shape as `pg_dump --schema=tenant_<slug>` for state.

---

## 6. Permissions, identity, safety

- **Who can talk to the bot:** D3 below. Default posture v1: any member of the connected workspace can *converse* (reads + drafts); the workspace was connected by a store admin and Slack workspace membership is the trust boundary, same as a shared console login.
- **Who can approve:** mutating actions surfaced in Slack (proposal approval, offer ship) are **gated to an allowlist** — v1: the installer, editable in the Integrations tab. Everyone else gets the deep-link to the console. Approval via Slack button drives `proposals` approve exactly as the console does — draft-theme loop, reconcile-before-branch, never raw git (spec 11 D1/D2 hold unconditionally; Slack is a *trigger*, never a new mutation path).
- **Prompt-injection posture:** Slack message content is user input like any console message — no elevated trust. The agent's tool surface via `/api/chat` is identical to the console's; Slack adds no new capabilities to escalate into.
- **Tenant isolation (multi-store):** `(team_id, channel_id)` → exactly one tenant (`SlackChannelBinding` unique on `[teamId, channelId]`); the handoff carries exactly one shop; the runtime's AsyncLocalStorage tenant context (`runWithTenant`) hard-errors without it. In a multi-store workspace, `#arthaus` and `#acme` resolve to different tenants and different memory schemas — a message in one channel can never reach the other store's data, because resolution happens *before* the handoff is minted and the runtime only ever sees the resolved shop. The allowlist (approvals) and the digest bindings are likewise per-`(team, channel, tenant)`, so an agency operator's approval rights are scoped to the stores they administer, not the whole workspace.
- **Revocation:** Disconnect in admin → token revoked + Vault secret deleted + installation row tombstoned → events for that `team_id` are dropped with a polite "this workspace is disconnected" ephemeral reply.

---

## 7. Proactive messaging (S4)

The platform has no outbound notification bus today — this is net-new, and Slack is the reason to build the first one:

- **Weekly review digest:** the existing `weekly-review` workflow output, rendered to Block Kit, posted to `digestChannel`. Producer exists; this is a delivery adapter.
- **Proposal lifecycle:** proposal enters `ready` → post to channel with Preview (theme-preview URL) / Approve (gated, §6) / Open in Console.
- **Offer engine events (spec 14):** experiment concluded, offer auto-retired, policy-loop escalations → digest items, not real-time noise.

Shape: a thin `notifyTenant(tenantId, event)` seam on the control plane, with Slack as the first (only) sink. Explicitly *not* a generic pub/sub build-out — one function, one table of channel bindings, delivered from the job runner. If email or in-console inbox sinks appear later, they slot behind the same seam.

---

## 8. Decisions — RESOLVED 2026-07-07

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| **D1** | Slack app topology | **One platform app for the fleet, multi-tenant. All code in `marketing-os-app`.** | One signing secret, one events URL, one-click install; tenancy resolved per-request like everywhere else. Per-tenant apps only ever exist in the eject tier. |
| **D2** | Workspace↔tenant cardinality | **Multi-store from day one.** Workspace-level install (`team_id` unique in `SlackInstallation`); channel-level store binding (`SlackChannelBinding`, unique `[teamId, channelId]`). DMs + unbound channels fall through to `defaultTenantId`. | Agencies running many stores from one Slack are a first-class case, not a v2 afterthought. Single-store merchants pay zero binding tax (default store); multi-store is progressive. Channel-binding manager ships in S0, `/mos link` in S2. |
| **D3** | Conversation authorization | **Members converse, allowlist mutates.** Any workspace member can ask/draft/analyze; an explicit per-store allowlist (default: installer) gates mutations (proposal approval, offer ship). Others get a console deep-link. | Workspace membership is the conversational trust boundary; sharp edges stay gated. Allowlist is scoped per-`(team, channel, tenant)` so agency approval rights don't leak across stores. |
| **D4** | Receiver implementation | **Hand-rolled thin receiver.** Signature verify + events JSON + Slack Web API calls on the existing HMAC-verifier and ack-fast/`waitUntil` webhook idioms. ~3 routes. | The control plane already owns four HMAC verifiers and the webhook pattern; Slack's wire protocol is small. Bolt fights the React Router/serverless shape; Vercel Chat SDK is a framework commitment worth revisiting only if Teams/Discord land (revisit at S5). |

---

## 9. Build phases

| Phase | Scope | Exit criterion |
|---|---|---|
| **S0 — App + install + binding** | Slack app manifest, OAuth start/callback with signed-state breakout, `SlackInstallation` + Vault storage, `defaultTenantId`, `SlackChannelBinding` + `SlackWorkspaceEntitlement` models, entitlement (account auto-grant + signed installer bind-invite) + channel-binding manager in Integrations tab, connect/disconnect | Arthaus workspace installs from embedded admin in <60s; a same-account second store binds a channel with no invite, and an outside-account store binds via an installer invite; token in Vault; revoke works |
| **S1 — DM chat loop** | Events receiver (signature verify, dedupe, ack-fast), two-step `(team,channel)→tenant` resolution, chat handoff to pooled runtime, placeholder + `chat.update` streaming, `SlackThread` memory continuity | DM to the default store holds a memory-continuous conversation at parity with console text chat |
| **S2 — Channels + slash + link** | `app_mention` in channels, in-thread replies, `/mos` command surface incl. `/mos link` in-Slack store-picker, unbound-channel ephemeral nudge, user attribution in agent context | @mention in a bound channel produces a threaded, attributed reply; `#acme` and `#arthaus` in one workspace route to different stores |
| **S3 — Polish** | mrkdwn fidelity, Block Kit result cards, chart images via `files.upload`, error ephemerals, long-turn job-queue path | Tool-heavy turns (semantic-layer queries with charts) present well; no dead placeholders |
| **S4 — Proactive + approvals** | `notifyTenant` seam, digest channel binding, weekly-review digest, proposal-ready cards with gated Approve driving the draft-theme loop | Weekly review lands in-channel; a proposal is approved from Slack end-to-end |
| **S5 — Tiers + distribution** | Client-deployed routing via `agentsUrl`, eject-tier template route (env-gated), App Directory submission prep (if pursued) | A client-deployed tenant chats via the platform front door; eject documented |

S0–S1 is the demonstrable core ("chat with your store's agent from Slack") and the right first tranche. S4 is where retention value concentrates but depends on nothing exotic — the notifier seam is deliberately tiny.

---

## 10. Non-goals (v1)

- No Slack as a credential holder or broker client — it is a message transport into `/api/chat`, nothing more.
- No per-Slack-user ↔ Shopify-staff identity mapping (attribution yes, authorization mapping no).
- No Enterprise Grid / multi-workspace org install handling beyond rejecting gracefully.
- No socket mode (serverless-hostile), no Slack workflow-builder steps, no message-shortcut ingestion of arbitrary content.
- No generic notification bus — one seam, one sink.

## 11. Open questions

1. **Events URL domain** — `avant-garde-marketing-os.vercel.app/slack/events` works; does the pending platform-domain/DNS decision (spec 12 open item) want to land first so the Slack app manifest never needs a URL migration?
2. **Slack App Directory** — unlisted distribution requires nothing; a Directory listing brings review requirements (privacy policy, support URL, scope justifications) — pursue only when hosted tenants beyond Arthaus exist.
3. **Rate limits** — `chat.update` streaming at 1s intervals is within Tier-3 method limits for one workspace, but the throttle should be per-channel and the notifier (S4) should batch; worth a limits pass before S3.
4. **Message retention posture** — agent replies persist in the customer's Slack (their data, their retention policy); memory threads persist in the tenant schema. Confirm nothing in Slack ToS/App Directory review constrains storing message *content* in our memory (it doesn't for standard apps, but verify before Directory submission).
5. **Cross-store binding discovery (D2 mechanics)** — RESOLVED 2026-07-07: installer-invite / agency-grouping via `SlackWorkspaceEntitlement` (§2.3, §4). Same-account stores auto-entitled through the existing `Account → Tenant` relation; outside-account stores entitled by a signed, expiring installer bind-invite. No Slack-user ↔ store-admin identity proof needed — entitlement rests on the App Bridge session plus a platform-minted HMAC. Remaining sub-detail for S0: bind-invite UX (single-use vs reusable link, default TTL) — a build-time call, not a design blocker.
