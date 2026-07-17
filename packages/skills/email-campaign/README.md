# @avant-garde/skill-email-campaign

The Email Campaign Agent skill pack (docs/email-campaign-agent — Klaviyo-first), the platform's second creative-channel pack and the social pack's deliberate sibling.

**The agent plans from the Brand Soul, drafts on the store's own email design system, and nothing reaches an inbox without a human approval through the spec 20 Action gate.** This package ships the model (the `email/` artifact formats), the ungated planning + Klaviyo read intelligence, and — unlike social's SM0 — declares its Actions from day one (they are **inert until the spec 20 A0/A1 runtime gate exists**).

## What this version covers

1. **Artifact formats** (02 §3 + 06 — files are truth, DB is the index), all under `email/` in the store repo:
   - `email/strategy.md` — audience roster (`{key, klaviyoRef, cadenceCap}`), campaign archetypes (`{name, messagingRef → brand.md, weight}`), send-day/time preferences, seasonal arcs, guardrails (weekly caps, quiet periods).
   - `email/calendar/{YYYY-MM}.md` — the month's plan: `| slot | audience | archetype | intent | campaignId | status |`.
   - `email/campaigns/{id}/campaign.md` — the campaign spec: audiences with size snapshots, subject candidates, sections (surface boards + html blocks), skeleton ref, UTM, Klaviyo ids, provenance, lifecycle `proposed → approved → drafted → scheduled → sent → measured` (+ declined/cancelled/failed).
   - `email/templates/skeletons/{id}/skeleton.md` (+ `.html`) — ingested skeleton provenance.
   - `email/registry.json` — slug → Klaviyo template id (PATCH-not-duplicate; the Arthaus `emails/` precedent, 06).
2. **Planning reads** — `email_plan_propose` (pure, deterministic, no clocks: cadence layout × weighted archetype rotation × audience rotation under cadence caps × quiet periods), `email_calendar_read` (+ gap analysis incl. audience-contact pressure), `email_campaign_read`.
3. **Klaviyo reads** over the pack-owned `KlaviyoClient` interface — `klaviyo_audiences_read` (live lists/segments + strategy-roster cross-check), `klaviyo_templates_read` (universal content inlined — 03 §3), `klaviyo_performance_read` (normalized stats, attribution basis always stated).
4. **`instructions.md`** — merged into the agent when the pack is enabled (sync-tested).

## The two seams (factories over bindings)

```ts
import { createEmailTools, type EmailRepo, type KlaviyoClient } from "@avant-garde/skill-email-campaign";

const tools = createEmailTools(repo, klaviyo);
```

- `EmailRepo` = the shared `StoreRepo` from `@avant-garde/skill-kit` — hosted runtime binds the tenant's store repo; tests bind `createMemoryRepo()`.
- `KlaviyoClient` — **the interface is defined here**; the hosted runtime implements it against broker-issued credentials (revision `2026-07-15` pinned, per-tenant rate budgets); tests use fakes. The pack never sees a credential.

No `@mastra/core` dependency — plain `SkillToolDefinition`s; the runtime wraps with `createTool` at merge time (see the social pack README for the wrap).

## Actions (spec 20)

| kind | risk | what |
|---|---|---|
| `email.approve_plan` | medium | plan → approved; authorizes **drafting only** — each send still gates individually |
| `klaviyo.create_campaign_draft` | medium | CODE template (assembled HTML, images uploaded) + campaign + message + assignment; 3-step idempotent execute, registry-disciplined |
| `klaviyo.schedule_campaign` | **high** | approval = consent to send at T (spec 24 D2); Klaviyo executes; cron reconciles |
| `klaviyo.cancel_send` | low | cancel/revert before send |

Nonce discipline: any post-approval change (copy, canvas `edited`, audience, time, skeleton re-ingestion) invalidates the nonce and re-arms the card.

## Develop

```bash
pnpm --filter @avant-garde/skill-email-campaign test       # vitest (48 tests)
pnpm --filter @avant-garde/skill-email-campaign typecheck
pnpm --filter @avant-garde/skill-email-campaign build
```
