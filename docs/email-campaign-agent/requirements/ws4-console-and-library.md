# WS4 — Console Surfaces & Library Hardening

> **Objective:** the human-facing read/review layer — the unified cross-channel calendar, campaign detail with provenance and preview, the skills enable page — plus the platform hardening the two-agent pair forces (05 H1/H3/H4/H8), delivered template-first and landed on Arthaus via an upgrade PR.
>
> **Grounding docs:** 05-AGENT-LIBRARY-HARDENING.md (the requirements this WS implements), 02-ARCHITECTURE.md §6/§7, spec/13 (console conventions: light-primary, editorial at the edges), spec/22 upgrade-workflow rule (console edits ONLY via template→upgrade PRs), memory note *arthaus-console-true-source* (the live Arthaus console deploys from Arthaus-Inc/marketplace `agents/`, CLI-deployed — NOT hosted-agents).

## In scope
Shared calendar (index + component), campaign detail view, approval-review UX in console, skills enable/config page, Klaviyo connect settings UI, migrations applied (`mos_email_campaigns`, `mos_calendar_items`, the unapplied `mos_design_surfaces`/`mos_social_posts`), preview route, template packaging + Arthaus upgrade PR.

## Out of scope
Slack surfaces (spec 17 plumbing, exercised by WS3's cards), DS4 embedded canvas (spec 23's phase — "Open canvas" uses the full-window degradation until it lands), drag-to-reschedule, cross-store agency digests.

---

## WS4-R1 — Calendar index + migrations *(marketing-os-app)*

Apply as one migration set: `mos_email_campaigns` (02 §3), `mos_calendar_items` (02 §6 / 05 H4.1), and the drafted-but-unapplied `mos_design_surfaces` + `mos_social_posts` (PRD §7). Ship the `upsertCalendarItem` helper both packs write through; social backfills its projection from `social/` files (the rebuildable-from-files doctrine exercised, 05 H4.3).

**Acceptance:** migrations applied to prod Supabase; projection rebuild script produces identical rows from files alone; both packs' writes land calendar items; tenant isolation verified (the spec 11 two-tenant bar).

**Dependencies:** WS3-R2 shapes stable. **Coordinate:** touches the same migration space as social SM0's remaining items — one combined change, not two.

## WS4-R2 — The cross-channel calendar view *(template → store repos)*

The console calendar per 05 H4.2: month/week grid over `mos_calendar_items` only; channel + status chips, surface thumbnails, backlog lane for planned-but-unscheduled; filters by channel/status; click-through resolves `detail_ref` via the owning pack's detail route. Spec 13 conventions. Channel-agnostic by acceptance test: a synthetic third channel renders with zero component changes.

**Acceptance:** Arthaus sees August's email campaigns and social posts on one calendar; filters work; the synthetic-channel test passes; component lives in `packages/marketing-os/templates/agents/` first.

## WS4-R3 — Campaign detail + preview *(template + hosted-agents route)*

Campaign detail view: subject/preview + copy with provenance chips, section list with board thumbnails, "Open canvas" (full-window Design Studio link until DS4), **assembled HTML preview** in a sandboxed iframe served by the hosted preview route (02 §7 — guarded like `/api/design-surfaces/export/[fileId]`; decision recorded: our route, not Klaviyo's render endpoint, so previews work pre-draft), audience + estimated size, status trail + audit records, pending Action cards surfaced (console renders the same Actions as buttons — spec 20 §6).

**Acceptance:** the full Arthaus demo campaign is reviewable end-to-end in the console; preview matches the golden assembly byte-for-byte; audit trail lists every Action with approver + time. Also close the REVISIT console-renderer gap while here: design-surface exports render through the gallery renderer, not raw JSON directives.

## WS4-R4 — Skills page + Klaviyo connect settings *(template + marketing-os-app)*

05 H1.4: the Skills page (packs, enable/disable, requires-status, version, config form — email's config: conversion metric, default from-address) + Klaviyo connection settings (OAuth connect button / key paste per WS1-R2, connection health, disconnect). Enablement writes `mos_skill_enablements` (05 H1.1 — build fully here if WS3-R7 shipped the minimal gate).

**Acceptance:** disabling the pack removes email tools from the tenant's agent within one request cycle; enabling without a Klaviyo connection is blocked with a pointing-hand to connect (05 H1.2); config edits reach the pack via the enablement row.

## WS4-R5 — Reports registration *(hosted-agents, rides spec 19)*

"Email Recap" as a spec 19 saved report (the pack's `reports` export): per-campaign performance vs the store's trailing baseline, attribution basis stated, delivered on the existing report cron/cards.

**Acceptance:** `/mos report save`-equivalent flow schedules it; a recap card with real Arthaus numbers lands in Slack on schedule.

## WS4-R6 — Template packaging + the Arthaus upgrade PR *(marketing-os → Arthaus-Inc/marketplace)*

Batch every template change from this module (calendar, detail, skills page, settings, gallery-renderer fix, WS2 compose-template mirroring) into **one template minor bump** (v0.15.0 by current numbering — confirm against main at build time), mirrored byte-identical per the vendoring precedent. Open the Arthaus upgrade PR (the PR #26 pattern: surgical apply — the store's `agents/` carries custom console work; tsc + next build clean; pnpm-lock updated with the package.json). Document required env additions in the PR body.

**Acceptance:** upgrade PR merges; Arthaus console redeployed via `vercel deploy --prod --cwd agents` from a verified checkout (deploy-source-verification practice); everything in R2–R4 live on www.arthaus.cloud.

**Dependency/risk:** `marketing-os upgrade --yes` is not non-interactive (05 H8.2) — either fix it inside this WS (recommended if >1 store exists by then) or hand-drive the PR as before. Decide at WS4 start.

---

## Open questions (human)
1. 05 H8.2 — fix the upgrade CLI's `--ci` path in this WS, or defer while Arthaus is the only store?
2. Calendar write-backs from the console (drag-to-reschedule = re-armed schedule Action) — v1.1 or in-scope here? (Position: v1.1; the grid is read + click-through for MVP.)
3. Approval in console vs Slack-only for v1 — spec 20 §6 says both render Actions; is console approval (with the same nonce discipline) required for the MVP demo, or is Slack the only approve surface initially? (Position: Slack-only approve for MVP; console shows state.)
4. Preview iframe sandboxing policy for assembled HTML (it contains remote images from Klaviyo's CDN) — confirm CSP posture with whoever owns console security headers.
