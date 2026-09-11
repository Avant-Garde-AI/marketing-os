# Spec 31 — The Ejected Store Contract

**Status:** proposed · **Supersedes nothing** · **Companions:** spec 12 (Store MCP + semantic layer), spec 16 (model & credential topology), spec 18 (external MCP integration), spec 20 (capability suite & the Action gate)

---

## 1. The failure that produced this spec

On 2026-09-11 an operator asked in Slack how the week's email campaigns had performed. The agent answered:

> We haven't sent any email campaigns this week.

Three campaigns had sent — 8,112 recipients between them — and the console at `www.arthaus.cloud` was showing their open rates on screen at that moment. The agent was not confused and it was not lying. It resolved the tenant correctly, queried `mos_email_campaigns`, and truthfully reported what it found: four `drafted` rows, none sent.

It was reading a different database.

```
console (arthaus-agents)   writes campaign index + readback ──▶  Arthaus's own Supabase
Slack  → pooled runtime    reads campaign index            ──▶  platform Postgres
```

Both databases hold a table called `mos_email_campaigns`. Both hold rows for tenant
`bd77037d-…` = `arthaus-website.myshopify.com`. The contents differ, and the ids are not even
the same campaigns: the platform copy has `2026-09-01-artist-83-oranges` where the store has
`2026-09-01-artist-drop-83-oranges`, plus an artist the store does not carry. It is not a
lagging replica. It is an abandoned copy from an earlier era, still being read.

**The lesson is not "fix the query."** Four separate code fixes were made that day — a tenant
scoping bug, an unsupported filter operator, a status-writeback gap, a missing cron schedule —
every one of them real, every one verified, and not one of them changed the Slack answer,
because none of them addressed which database was being read. Time spent debugging the reader
is time not spent asking where the data lives.

---

## 2. What ejection actually means

A tenant with `Tenant.agentsUrl` set runs its own deployment. Today that is a single column,
set once at eject time, and the rest of the platform mostly ignores it. That is the root
problem: **ejection changed where the data lives, and nothing was told.**

So, the definition this spec adopts:

> **An ejected store owns state the hosted plane cannot see, and is responsible for exposing it.**

Everything else follows. The hosted plane keeps one chat implementation, one memory model, one
approval flow, for pooled and ejected tenants alike. What differs is only *where it reads from*
— and that difference is expressed as an MCP endpoint, not as a second code path.

### 2.1 Why not the alternatives

**Migrate ejected consoles into the pooled runtime.** This does not solve the problem; it *is*
the problem. Ejection exists so a store can run its own deployment with its own data and custom
tooling. Pooling the chat does not move the data, it guarantees the agent sits on the wrong side
of it.

**Proxy chat to the console when the tenant is ejected.** This works, and it forks the chat
implementation by tenant type. Two paths for the same conversation — memory, threading,
approvals, model routing, rich surfaces — drifting apart at every subsequent change. The email
pack already exists in three copies across three repos, and the cost of that has been paid
repeatedly: a capability shipped to one copy is invisible in another, and the symptom is always
"it works when I test it and not when you use it". Do not create a fourth axis of divergence.

**Write the store's projections into the platform database as well.** Two sources of truth for
the same table. The stale rows that caused this failure are what that looks like after a year.

### 2.2 Why MCP

The mechanism is already built, on both sides, and already carrying production traffic:

- The ejected console already serves `{agentsUrl}/api/mcp` — a stateless-HTTP MCP endpoint
  authenticated by a connector token, exposing **26 tools** today (§4.1).
- The pooled runtime already attaches external MCP servers over stateless HTTP, resolving them
  per-tenant from `external_mcp_connections` via `/api/broker/mcp-connections`.
- Arthaus already has one attached and active — *Picasso Concierge*, since 2026-07-08.

Nothing here requires a new transport, a new auth scheme, or a routing rewrite. It requires
pointing an existing mechanism at one more endpoint: the store's own.

### 2.3 The consistency argument

Writes already work this way. An approved Action dispatches to
`{tenant.agentsUrl}/api/actions/execute` — the ejected console, against the store's own data.
That has been true since spec 20.

Only reads do not. This spec makes reads match writes rather than maintaining two opposite
conventions in one system.

---

## 3. The contract

> A store that sets `agentsUrl` MUST serve an MCP endpoint at `{agentsUrl}/api/mcp`, authenticated
> by a connector token, exposing the three tiers below. The hosted plane MUST prefer that endpoint
> over its own storage for anything in Tier 1 or Tier 2, and MUST NOT fall back to local storage
> when it is unreachable.

That last clause is the one that matters. A silent fallback to the hosted plane's own tables is
exactly the failure in §1 — it returns a confident, well-formed, wrong answer. An unreachable
store MCP must surface as *"the store's data is unreachable"*, never as *"no campaigns"*.

### Tier 1 — Measure

The governed semantic layer. Answers *how did this perform*.

| tool | purpose |
|---|---|
| `explore_schema` | what views exist and what each answers |
| `describe_field` | a field's meaning, format, provenance |
| `query` | the governed query, returning the self-describing envelope |
| `explain_query` | validate + compile without spending quota |

Plus the `semantic://` resources — `manifest`, `views/{view}`, `glossary`, `connections`,
`cookbook` — and the analysis prompts.

**Status: already served.** And because `email_performance` is a semantic view (added
2026-09-09), email results flow through this tier with no additional work.

### Tier 2 — The work record

The store's own state: what has been planned, written, reviewed, and sent. This is the tier the
hosted plane cannot see, and the one whose absence caused §1.

| group | tools |
|---|---|
| calendar & campaigns | `email_calendar_read`, `email_campaign_read`, `email_strategy_read` |
| audiences | `klaviyo_audiences_read`, `klaviyo_audience_explain` |
| results | `klaviyo_performance_read`, `email_campaign_retrospective` |
| feedback | `email_review_notes`, `email_review_notes_resolve` |
| rendering | `email_render_preview`, `email_review_sheet` |
| catalogue | `imagery_resolve`, `imagery_rooms`, `artist_profile_read`, `gallery_wall_sets_read` |

**Status: mostly served** — `klaviyo_audience_explain` and `email_campaign_retrospective` are
the gap (§5.1).

A note on where Tier 2 data actually lives, because it is not uniform and the distinction
matters when debugging: **artifacts** (`campaign.md`, `strategy.md`, `brand.md`) live in the
store's git repo and are already readable from the hosted plane via the GitHub App. **Projections**
(`mos_email_campaigns`, review notes, readback) live in the store's own database and are not.
The failure in §1 was entirely a projection failure. An agent can read what a campaign *says*
and be wrong about whether it *sent*.

### Tier 3 — Propose, never execute

Authoring and staging tools may be served (`email_campaign_upsert`, `email_plan_propose`,
`propose_email_draft`, `email_strategy_upsert`, `email_partials_upsert`) because they write to
the store's repo and create *proposals*.

**Execution stays on the Action gate.** Nothing reachable over MCP may send email, create a
discount, publish a post, or otherwise mutate external state. A connector token proves
possession of a token; it does not carry a verified human identity, and approval requires one.
This is spec 20's structural invariant and MCP does not get an exception to it.

---

## 4. As-built

### 4.1 What the ejected console serves today

26 tools: `explore_schema`, `describe_field`, `query`, `explain_query`, `get_account_summaries`,
`get_property_details`, `get_custom_dimensions_and_metrics`, `run_report`, `email_calendar_read`,
`email_campaign_read`, `email_campaign_upsert`, `email_partials_upsert`, `email_plan_propose`,
`email_render_preview`, `email_review_notes`, `email_review_notes_resolve`, `email_review_sheet`,
`email_strategy_read`, `email_strategy_upsert`, `propose_email_draft`, `klaviyo_audiences_read`,
`klaviyo_performance_read`, `imagery_resolve`, `imagery_rooms`, `artist_profile_read`,
`gallery_wall_sets_read`.

Auth: `Authorization: Bearer mos_…` or `?token=`, verified by `verifyConnectorToken`.

### 4.2 What the pooled runtime does today

Resolves per-tenant MCP connections from the broker and attaches them over stateless HTTP,
supporting `auth_type: "none" | "bearer_static"`. `bearer_static` is exactly what a connector
token needs — so attaching an ejected store's own MCP requires **no new auth code**.

---

## 5. Build order

### 5.1 — Close the Tier 2 gap *(small)*

Add `klaviyo_audience_explain` and `email_campaign_retrospective` to the console's MCP tool list.
Both already exist as console tools; this is exposure, not implementation.

### 5.2 — Attach the store's own MCP *(the end-to-end fix)*

Mint a connector token for the tenant and register `{agentsUrl}/api/mcp` as an
`external_mcp_connections` row with `auth_type: "bearer_static"`. The pooled runtime picks it up
through the path Picasso Concierge already uses, and the Slack agent gains the store's real tools
reading the store's real data.

This should become **automatic at eject time**, not a manual step: setting `agentsUrl` is the
declaration that state has moved, and the attachment is the consequence. A manual step here is a
step someone forgets, and the symptom of forgetting it is §1.

### 5.3 — Stop the silent fallback *(the durable fix)*

For a tenant with `agentsUrl` set, the pooled runtime's own email/social projection reads MUST
NOT answer from platform storage. Either the store MCP answers, or the agent reports the store
as unreachable.

Without this, 5.2 is an optimisation that can silently regress to the broken state the moment a
token expires — and regress *quietly*, which is the whole problem.

### 5.4 — Clean the abandoned rows *(hygiene, needs owner sign-off)*

Delete the four stale `mos_email_campaigns` rows for `bd77037d-…` in the platform database. They
are not a replica and will keep generating false answers under any architecture. Deleting tenant
data requires the owner's explicit go-ahead.

### 5.5 — Extend beyond email

The same contract applies to social, brand, and design surfaces. Email is first because it is
where the failure surfaced and where the tooling is most complete. The tiering in §3 is intended
to generalise: *measure*, *the work record*, *propose — never execute*.

---

## 6. Open questions

1. **Token lifecycle.** Connector tokens are minted per connection. What rotates them, and what
   does the hosted plane do when one expires — degrade loudly (§5.3) or attempt re-mint?
2. **Discovery vs. registration.** Should the pooled runtime discover `{agentsUrl}/api/mcp` from
   the `Tenant` row directly, rather than requiring a row in `external_mcp_connections`? A
   registered connection is visible and auditable; derived discovery cannot be forgotten. These
   pull in opposite directions and the choice should be deliberate.
3. **Version skew.** An ejected console can be upgraded on its own schedule, so the hosted agent
   will meet stores serving older tool sets. `tools_snapshot` already records what a connection
   offered at attach time; the contract needs a stated minimum and a behaviour for stores below it.
4. **Latency.** Every Tier 1/2 read becomes a network hop to the store's deployment. Acceptable
   for chat; needs measuring before anything on a hot path depends on it.
