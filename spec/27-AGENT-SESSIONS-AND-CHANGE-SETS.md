# 27 — Agent Sessions & Change Sets

> Open Conjecture · September 2026 · **PROPOSAL — not built**
>
> How a conversation with the agent becomes staged, reviewable, reversible work
> on the store — and how every plugin (email, social, storefront, the next one)
> stages through the same primitive instead of inventing a review lane.

---

## 1. The problem

Two things are true about the platform today:

1. The **write path is hardened**. Storefront edits run through a draft theme
   the merchant previews on their own store before anything publishes (spec 11
   §3.3). Every governed write narrows through one Action gate with a
   single-use nonce, a preview hash, and an append-only audit ledger (spec 20,
   migration 005). The email agent commits artifacts to the store repo and
   cannot send without a Slack approval. None of this is theoretical — it is
   shipped and live on Arthaus.

2. The **presentation of that path is five unrelated lanes**, and the
   conversation that produced the work is bound to none of them.

Inventory, as built:

| Lane | Substrate | Where it's reviewed | Who can decide |
|---|---|---|---|
| Storefront proposal | `proposal/<id>` branch in `mos-tenant-<slug>` + standing preview theme | `/app/reviews` | Shopify admin |
| Action proposal | `mos_action_proposals` (nonce + preview hash) | Slack card | Slack user id |
| Email campaign | store-repo artifact (`email/campaigns/{id}/`) + Klaviyo draft | HMAC review room link | **nobody** — notes only; approval is a separate Slack Action |
| Social post | store-repo artifact + `mos_calendar_items` | HMAC review/sheet link | same |
| Executor run | Vercel Sandbox working tree → diff → proposal | falls into lane 1 | Shopify admin |

And the conversation itself: a Mastra thread keyed by a UUID in
`localStorage` under `mos-console-thread-id` (`app.console.tsx`). One thread
per browser. Switch laptops and your history is gone. Nothing anywhere records
that proposal #4 came out of the conversation where you asked for it.

The cost of this shape is concrete:

- A merchant cannot answer "what is my agent proposing right now?" from one
  screen. They check Reviews, then Slack, then their email review links.
- A plugin author cannot stage a reviewable change without building a review
  surface. The email pack built review rooms, notes, and expiring links from
  scratch; the social pack built a second copy. The third pack will build a
  third.
- The one interaction people already understand from Claude and ChatGPT —
  a list of named sessions you resume — does not exist, so there is nowhere
  natural to hang "and here is what this session changed."

## 2. Three primitives

### 2.1 Session

**A session is a chat thread, promoted to a first-class object.**

Most of this already exists and is unused by the embedded app. The hosted
runtime ships `GET /api/conversations` (list threads for `resourceId = shop`,
newest first, with Mastra's auto-generated titles), `GET
/api/conversations/{id}/messages`, and `DELETE /api/conversations/{id}` — all
authenticated by the same per-turn chat handoff the Agent page already mints.
The embedded page simply does not call them.

So the first move costs no schema: replace the localStorage single-thread model
with a session list. Sessions become per-**store**, not per-browser — resume on
any device, which is what "like Claude and ChatGPT" actually means to a user.

What a session is *not*: an approval context. A session is a conversation. It
proposes; it never decides. §2.3 keeps that line.

### 2.2 Change set

**A change set is the unit of staged, reviewable work — pack-agnostic.**

One row per thing-that-would-change-the-store, in the platform DB, written by
every pack through one helper. It is an **index, not content**: the artifact
stays exactly where its pack already puts it (theme branch + preview theme;
store-repo commit; Klaviyo draft). This is spec 22 D1 doctrine — files are
truth, the DB is the index — and it is the same shape as `mos_calendar_items`,
whose acceptance test (05 H4.2) is that a third channel renders with zero
calendar-component changes. Change sets get the same test: **a fourth pack's
work appears in Reviews with zero Reviews changes.**

```sql
CREATE TABLE mos_change_sets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,

  -- Provenance. NULL session_id = raised by cron or a Slack turn, which is a
  -- first-class origin, not a degraded one.
  session_id     TEXT,
  pack_id        TEXT NOT NULL,        -- 'storefront' | 'email-campaign' | 'social-media' | …
  origin         TEXT NOT NULL         -- 'session' | 'cron' | 'slack' | 'executor'
                   CHECK (origin IN ('session','cron','slack','executor')),

  -- What a human reads.
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL,        -- one line: what would change
  risk           TEXT NOT NULL CHECK (risk IN ('low','medium','high')),

  -- Where the staged content actually lives. The pack owns the ref format.
  substrate      TEXT NOT NULL         -- 'theme_branch' | 'repo_commit' | 'esp_draft'
                   CHECK (substrate IN ('theme_branch','repo_commit','esp_draft')),
  substrate_ref  JSONB NOT NULL,       -- {branch, preview_theme_id} | {repo, sha} | {klaviyo_campaign_id}

  -- How to render a preview without Reviews knowing what a pack is.
  preview        JSONB NOT NULL,       -- {kind:'url'|'image'|'diff', …}

  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','in_review','approved','rejected',
                                     'applied','superseded','failed')),

  -- Applying is an Action. This is the FK that keeps one write gate (§2.3).
  action_proposal_id UUID REFERENCES mos_action_proposals(id) ON DELETE SET NULL,

  created_by     TEXT NOT NULL DEFAULT 'agent',
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  applied_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mos_change_sets_open ON mos_change_sets (tenant_id, status)
  WHERE status IN ('draft','in_review');
CREATE INDEX idx_mos_change_sets_session ON mos_change_sets (tenant_id, session_id);
```

`preview` is the whole reason Reviews can stay pack-agnostic. Three kinds cover
everything shipped today:

- `{kind:'url', href}` — the storefront preview (`?preview_theme_id=…`), the
  email review room, the social contact sheet.
- `{kind:'image', src, alt}` — a rendered campaign or post creative.
- `{kind:'diff', files:[{path, added, removed}]}` — the executor's working-tree
  diff, or a repo artifact change.

A pack that needs a fourth kind adds a renderer once; it does not add a page.

### 2.3 The gate stays where it is

**A change set is never its own approval path.** Applying one creates an Action
proposal (`mos_action_proposals`) and executes through the existing gate:
single-use nonce, preview hash bound to what the approver actually saw,
`mos_action_audit` ledger including refusals. `action_proposal_id` is the
link.

This is the load-bearing constraint, and it is what the current review-links
doctrine already insists on (migration 008's identity warning, verbatim: *a
valid token proves possession of a link, not identity*). Change sets inherit it
exactly:

- **Anyone with a link** can preview a change set and leave notes.
- **Only an authenticated Shopify admin (embedded app) or a real Slack user id**
  can decide one.
- Notes are conversation about the artifact; they are never an approval, and
  `source` ('link' vs 'console') stays on the row so a future authenticated note
  lane can be trusted more without retroactively upgrading old rows.

## 3. Sessions and branches

The intuition — *a session is a feature branch* — is right, with one honest
correction.

**Where it holds.** A session that touches the storefront owns a working branch
`session/<short-id>` in `mos-tenant-<slug>`. The executor mounts that branch
instead of cutting a fresh `proposal/<id>`. Follow-up turns in the same session
commit onto it, so "actually make the headline shorter" amends the same line of
work instead of opening a second, conflicting proposal.

**Where it breaks.** Branch-per-session means change sets within a session are
*stacked*, and stacked changes cannot be approved out of order — approving the
second while rejecting the first is a cherry-pick, and cherry-picks conflict.
Pretending otherwise ships a merge-conflict bug as a feature.

So the rule is:

> Approvals are **sequential within a session** and **independent across
> sessions**. Approving a change set merges its branch up to that commit;
> rejecting one closes the session's branch from that commit forward and offers
> "start a new session from here".

That is what git gives cheaply, it is explainable in one sentence to a merchant
("this conversation's changes stack; approve them in order"), and it makes the
common case — one session, one change, approve — trivial.

Packs whose substrate is not the theme repo (email, social) use the same
sequencing rule against their own substrate: an email change set's "apply"
stages the Klaviyo draft, and two stacked change sets on one campaign apply in
order.

## 4. Presentation

### 4.1 Agent (renamed from Console)

Three panes, the shape everyone already knows:

- **Left — sessions.** Titles from Mastra, newest first, "New session" at top.
  Backed by `/api/conversations`; no new storage.
- **Centre — the conversation.** As today, plus inline change-set cards where
  the agent staged something: title, summary, status chip, Preview, and
  Approve/Reject for a store admin.
- **Right — this session's change sets.** The stack, in order, with the
  sequencing rule visible (approved ones checked, the next one live, later ones
  greyed as "after the one above").

### 4.2 Reviews → the inbox

Reviews stops being the storefront-proposal page and becomes the render of
`mos_change_sets WHERE status IN ('draft','in_review')`, grouped by pack, each
row carrying its origin ("from your session *Tuesday pricing*", "from the
weekly email cron"). Existing `Proposal` rows backfill as
`pack_id='storefront', substrate='theme_branch'`; the `Proposal` model stays as
the storefront substrate's detail table rather than being migrated away.

### 4.3 Home → an operating dashboard

The current home is a five-step setup checklist. Setup is a *state*, not a
permanent home page: once a store is connected the checklist is dead weight on
the most-visited screen. Proposed:

1. **Waiting on you** — open change sets, count plus the top three with
   preview links. The reason to open the app daily.
2. **Recent sessions** — three most recent, resume in one click.
3. **This week** — a small KPI strip from the semantic layer (sessions, orders,
   revenue, conversion) with the market footprint disclosed, exactly as chat
   answers disclose it.
4. **Finish setup** — the current checklist, collapsed to one card, shown only
   while something is unconnected.

## 5. Phasing

Each phase is independently shippable and independently useful.

| Phase | Scope | Schema | Notes |
|---|---|---|---|
| **P1** | Session sidebar on the Agent page; dashboard restructure using data that already exists | none | The conversations API is already built and deployed — this is a UI phase |
| **P2** | `mos_change_sets` + `upsertChangeSet` helper; backfill storefront proposals; Reviews reads change sets | migration 010 | Reviews becomes pack-agnostic here; the H4.2-style acceptance test lands here |
| **P3** | `session_id` binding; `session/<id>` branches in the executor; agent tools `changeset_open` / `changeset_stage` | none beyond P2 | The sequencing rule (§3) is implemented here, not before |
| **P4** | Email + social packs write change sets through the shared helper; their review rooms become change-set previews | none | Deletes two bespoke review lanes |

P1 is worth doing on its own even if P2–P4 are never built: it is a UI change
against a shipped API, and it fixes the "history dies with the browser" bug.

## 6. Invariants

1. **One write gate.** Applying a change set goes through `mos_action_proposals`
   and lands in `mos_action_audit`. No pack gets a second approval path.
2. **Links comment, identities decide.** Token-gated surfaces can preview and
   annotate; only an authenticated admin or a real Slack user id can approve.
3. **The DB indexes, the substrate owns.** A change set row never holds the
   artifact. Deleting every row loses the inbox, not the work.
4. **Pack-agnostic rendering.** Adding a pack adds zero lines to Reviews or the
   dashboard. If it doesn't, `preview` is wrong.
5. **Origin is not rank.** Cron- and Slack-raised change sets render identically
   to session-raised ones.

## 7. Open questions

1. **In-app approval of email sends.** WS4 OQ3 deliberately kept campaign
   approval Slack-only. Change sets make in-app approval mechanically trivial —
   which is exactly why the decision should be re-made on purpose rather than
   drift. Recommendation: allow in-app approval for `risk:'low'|'medium'`, keep
   `high` (anything that sends to a real list) Slack-only.
2. **Session ownership across users.** Sessions are keyed by shop today, so
   every admin on a store sees every session. Fine for a two-person store,
   wrong for an agency. Needs a `created_by` and a "mine / everyone" filter
   before multi-seat.
3. **Session branch lifetime.** When does `session/<id>` get garbage-collected?
   Proposal: on session delete, or 30 days after the last change set is
   decided, whichever is first.
4. **Superseded semantics.** If a session stages a change set and then the
   merchant changes the same asset by hand in Shopify, the stack is stale. The
   reconcile pass (D2, "branch from current reality") can detect this and mark
   `superseded` — but that needs a rule for what the agent says next.
5. **Does `Proposal` survive?** P2 keeps it as the storefront substrate's detail
   table. The alternative — fold `changedKeys`/`previewThemeId` into
   `substrate_ref` and drop the model — is cleaner but touches the one review
   loop that is definitely working today.
