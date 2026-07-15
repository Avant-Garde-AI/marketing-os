# 24 — Social Media Agent: Planning, Calendar & Governed Publishing

> **Status:** DRAFT — **D1–D4 resolved 2026-07-15 (§8); ready for build go.**
> **Depends on:** 22-BRAND-SOUL (the plan is derived from the soul — §10 Content & Editorial Strategy, §11 Channel Guidelines, the tone-modulation table, copy formulas), 20-CAPABILITY-SUITE (every publish is an Action), 23-DESIGN-SURFACES-PENPOT (post creative lives on Design Surfaces: agent composes via the file-first lane, human edits on the embedded canvas, exports feed the publish Action — this pack is the layer's first consumer), 19-SCHEDULED-REPORTS (cron shape + performance recaps), 17-RICH-SURFACES (plan/approval cards), 13-CONSOLE-DESIGN-RETROFIT (the calendar view's home).
> **First target:** Arthaus.

---

## 0. Thesis

Social is where most stores' brand expression is loudest and least governed — a person with a scheduler app, improvising. The social media agent runs it the way this platform runs everything else: **the agent plans from the Brand Soul, a human approves, the platform executes, and every artifact is versioned in the store's repo.**

This is not a Buffer/Later clone with an AI caption button. The differentiation is upstream of the scheduler: the calendar is *derived* — from brand.md's content strategy and channel guidelines, from what the semantic layer says is actually selling and being browsed, from the persona's decision architecture (NeuroGraph). The plan has provenance like every other brand claim. And the anti-Privy discipline from spec 14 applies verbatim: never generic engagement-bait disconnected from identity — every post serves the brand *and* a commercial intent.

## 1. The model: artifacts first

Spec 22 D1 pattern — **files are truth, DB is the index.**

**In the store repo** (`social/` alongside `agents/brand/`):
- `social/strategy.md` — the standing social strategy: channel roster with per-channel register (brand.md §9's per-surface voice registers, extended to social channels), cadence targets, content pillars mapped to brand.md's messaging framework, seasonal arcs. Versioned + provenance-tagged like brand.md; refined in the same co-creative session pattern.
- `social/calendar/{YYYY-MM}.md` — the month's plan: one row per planned post (slot, channel, pillar, intent, status). Human-readable, diffable, the thing a plan-approval approves.
- `social/posts/{id}/post.md` — the post spec: channel, scheduled time, copy (with the copy formula it instantiated), asset refs, target link (product/collection/editorial), provenance (`@agent` proposed / `@owner` edited / data claims cited), status trail.
- `social/posts/{id}/assets/` — the exported final renders (the spec 23 export contract delivers them here), plus generation lineage back to the run that produced the imagery.

**DB index** — `mos_social_posts` (tenant, post id, channel, scheduled_at, status, calendar month, design surface id, action nonce, published platform id + permalink): what the console calendar reads, what the cron scans, what performance readback joins on. Rebuildable from files.

**Post lifecycle:** `proposed → approved → asset_ready → scheduled → published → measured` (+ `declined`, `cancelled`, `failed`). Approval is per spec 20; `asset_ready` gates on the spec 23 export.

## 2. The agent: reads compose freely

The planning intelligence, all ungated:

- **Plan generation** — "plan next month" produces a calendar proposal: slots derived from `strategy.md` cadence, filled by composing brand pillars × semantic-layer signals (top movers, restocked bestsellers, seasonal traffic patterns — the same governed views chat uses) × NeuroGraph persona scenarios (which buyer scenario does this post speak to?) × the editorial register. Every slot carries its *why*.
- **Calendar mapping** — read/answer over the current plan ("what's going out this week?", "show me October's Pinterest posts"), gap detection, pillar-balance and register-drift checks (the copy-coherence-check discipline from spec 21, pointed at the queue).
- **Performance readback** — published posts join to the semantic layer (UTM-tagged links → sessions/revenue per post; platform metrics per channel connector where the API returns them). Feeds the next planning cycle: the agent proposes *more of what worked*, with the numbers cited. Recaps ride spec 19 as a saved "Social Recap" report.

## 3. Asset production: compose what's shipped

No new generation infra — the same reconciliation move as spec 21 §3:

```
post.md spec (copy formula + pillar + register + product refs)
  → imagery fan-out (BS2b harness: Gemini image models; NeuroGraph: ad-template renders)
  → spec 23 compose lane: brand template + tokens + payload → DesignSurface (kind social.post, bound to the post)
  → human pass (optional): "Open canvas" on the card → embedded Design Studio; live co-creative
    tweaks via the managed MCP while the canvas is open
  → exportSurface → social/posts/{id}/assets/ → asset_ready
```

Copy is generated under the brand's front-mattered copy-formula templates and the tone-modulation table's social registers — mechanically enforced (spec 22 D5 injection), not vibes. Calendar batches mint mechanically through the same compose lane — template stamping is file-first and headless, so a month of posts is a loop, not a gated Enterprise feature.

## 4. Writes: the Actions

| Action `kind` | What it does | Risk |
|---|---|---|
| `social.approve_plan` | Approves a month/week calendar proposal — batch-creates posts as `approved`. Card = the plan grid. | medium |
| `social.schedule_post` | Binds an `asset_ready` post to its publish time. Preview = the final rendered card: asset + copy + channel + time + link. | medium |
| `social.publish_post` | Immediate publish (also the cron's execute path for due scheduled posts). | medium |
| `social.cancel_post` | Pulls a scheduled post. `undo` for schedule while unpublished. | low |

**Approval semantics (D2):** approving `social.schedule_post` *is* consent to publish at time T — the cron executes without a second human touch. The spec 20 nonce protects the gap: any post-approval edit (copy change, a canvas edit after export — spec 23's `edited` webhook flag, time move) invalidates the nonce → status back to `approved` → card re-arms. What was approved is exactly what ships, or it re-asks.

**Publishing connectors.** No design tool publishes to social for us (the platform survey ruled it out everywhere), so execution goes direct to platform APIs: Meta Graph (Instagram Business + Facebook), Pinterest, TikTok Content Posting, X, LinkedIn — each a `provider_connections` row (bounded enum, OAuth per platform, Vault) with a thin `publish(post) → {platformId, permalink}` adapter. Rollout is per-channel and demand-driven (D1); the Action layer is channel-agnostic from day one.

## 5. Recurring execution & the planning ritual

- **`/api/cron/social`** (spec 19 shape: idempotent, `CRON_SECRET`-gated, self-limiting): finds `scheduled` posts due → verifies nonce still valid → executes publish → writes audit + platform permalink → card rewrite in the Slack thread ("Published ↗"). Failures mark `failed` + alert the channel; no silent retries past a bounded backoff.
- **The weekly ritual** (spec 20 A5 proactive shape): cron posts "next week on social" — the week's queue as a branded card with per-post status; gaps and `asset_ready`-but-unscheduled posts flagged. Monthly: the agent proposes the next calendar unprompted, seeded with last month's readback.

## 6. Surfaces

- **Console — Calendar view** (new "Social" section, spec 13 conventions: editorial at the edges, dense grid in the middle): month/week grid, posts as cards with status chips + asset thumbnails; click → post detail (copy, provenance, lineage, "Open canvas" into the embedded Design Studio, audit trail); filter by channel/pillar/status. Drag-to-reschedule later (it's just a re-armed `schedule_post`). The calendar and the canvas living in one console is the point — plan, edit, approve without leaving.
- **Slack (primary, as ever):** plan cards, per-post approval cards with an "Open canvas" link into the console (spec 23 OQ3 covers the Slack-side degradation), publish confirmations, the weekly ritual, recap reports.
- **Brand Portal tie-in (later):** published posts are brand expression — candidates for the portal's editorial surface.

## 7. Build phases

- **SM0 — Model + planning reads. ✅ scaffold 2026-07-15** (`packages/skills/social-media`, 44/44 tests): the three artifact formats round-trip (strategy/calendar/post), planning read tools (`social_plan_propose` with deterministic cadence + weighted pillar rotation, `social_calendar_read` with gap analysis, `social_post_read`) as runtime-agnostic definitions on a `SocialRepo` seam, spec 20 §5 package shape, instructions.md. Remaining for SM0 exit: hosted-runtime enable (bind SocialRepo to the store repo, wrap tools in Mastra), `mos_social_posts` migration apply, console calendar view (read-only). **Side quest, per D1: submit Meta app review now** (external — Garrett) so Instagram publishing clears by SM2. Exit: Arthaus asks "plan two weeks of Instagram + Pinterest", gets a provenance-carrying plan saved to the repo, sees it on the calendar.
- **SM1 — Asset pipeline.** post.md → imagery fan-out → compose lane → DesignSurface → export → `asset_ready`. *Depends on spec 23 DS2 (compose lane) for creation and DS1 for export; the human canvas pass gets richer as DS4/DS5 land but isn't a blocker — a composed surface can be approved unopened.*
- **SM2 — First publish.** Action set on the spec 20 framework + **both launch connectors (D1): Pinterest AND Instagram** + `/api/cron/social`. Meta app review starts at SM0 so IG lands with (or right behind) Pinterest; Pinterest's lighter API means it likely goes live first within the phase. Exit: a post goes plan → asset → approval card → scheduled → auto-published → permalink in the audit, on both channels. *Depends on spec 20 A0/A1 — a second reason, after spec 21 B2, to build the Action framework now.*
- **SM3 — The rituals.** Weekly queue card, monthly plan proposal, nonce-invalidation edge cases hardened.
- **SM4 — Readback.** UTM discipline on published links, semantic-layer join, "Social Recap" spec 19 report, readback-seeded planning.
- **SM5 — More channels + batch minting at calendar scale** (the compose lane in a loop; no plan gates).

## 8. Decisions (resolved 2026-07-15, Garrett)

- **D1 — Launch channels: BOTH Pinterest + Instagram in SM2.** One integration round; Meta app review kicked off at SM0 to absorb its lead time (§7, §10 OQ2).
- **D2 — Approval semantics: APPROVE-AT-SCHEDULE.** §4 as written — approving `social.schedule_post` is consent to publish at time T; nonce invalidation covers post-approval edits. Auto-approve policies remain spec 20 OQ1's problem.
- **D3 — Connectors: DIRECT platform APIs**, channel-by-channel — credentials stay in our Vault governance, no per-post middleman, clean audit. No aggregator.
- **D4 — Agent shape: SKILL PACK in the main agent** (spec 20 merge). The Slack coworker gains social capability; no separate persona.

## 9. Non-goals (v1)

- **No autonomous publishing** — every post traces to a human approval; the cron only executes approved, nonce-valid schedules.
- **Not an inbox** — community management (replies, DMs, comment moderation) is a different product with different risk; explicitly out.
- **No paid social** — boosting/ads belong to the ads capability line (NeuroGraph / google_ads / meta_ads skills), not the organic calendar. The readback may *suggest* "this post is worth boosting" — acting on it is that other pack's Action.
- **No follower analytics dashboard** — readback serves planning, not vanity reporting; spec 19 cards are the reporting surface.

## 10. Open questions

1. **UTM/attribution discipline** — per-post UTM conventions so readback joins are trivial; who owns the link-decoration step (the publish adapter, presumably)?
2. **Platform API review gates** — per D1, **Meta app review is an SM0 action item** (Instagram publishing must clear it before SM2 completes); TikTok's audit waits for its channel's turn. (The Penpot direction removed every *design-tool* review gate; the social platforms' own gates remain.)
3. **Story/video formats** — Penpot is static-only (spec 23 §6/DS6: MP4 = external render over exports) and NeuroGraph generates video prompts; statics prove the loop first, video is a fast-follow riding DS6.
4. **Multi-store workspaces** — spec 15 supports multiple stores per Slack workspace; the weekly ritual and calendar are per-store — does a multi-store agency want a cross-store social digest?
