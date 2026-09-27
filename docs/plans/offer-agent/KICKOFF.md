# Offer Agent — implementation kickoff (spec 32)

You are implementing **`spec/32-OFFER-AGENT.md`** end to end. Read it fully before writing
code; it carries decisions D1–D8 that are closed and must not be relitigated. Also read
`spec/14-OFFER-SURFACES.md` Part I (the framework, still authoritative), `spec/20` §5 (pack
shape), `spec/31` (the ejected store contract), and `spec/28` §3 (the open-core split).

## The one-sentence brief

The offer engine works but was built before the pack pattern existed, so it is three diverging
copies in three repos with no artifacts, no provenance, the wrong DB lane, a nav name that
collides with Design Surfaces, and a feature set a merchant cannot swap Wisepops for. Make it
the fourth capability pack, mirroring the email agent exactly, and close the parity gap that
stands between a $15 plan row and a cancelled competitor subscription.

## Repos in play (all local siblings under `~/dev/avant-garde/platform/`)

| repo | role | licence |
|---|---|---|
| `marketing-os` | the monorepo: specs, `packages/skills/*`, the console template | MIT |
| `marketing-os-app` | Shopify app: surface runtime extension, surface store, posteriors, Action gate, entitlements | private |
| `marketing-os-hosted-agents` | the pooled multi-tenant runtime | private |

**Read `spec/31` before assuming where data lives.** The recurring failure in this codebase is
reading the wrong database and getting a confident wrong answer. When a number looks off, ask
*which database* before debugging the query.

## Ground truth to read first (do not skip — these are the templates you are copying)

1. `marketing-os-app/supabase/migrations/007_email_and_calendar.sql` — the migration convention
   you will mirror in `010_offers.sql`. Note: `mos_*` naming, `tenant_id REFERENCES "Tenant"(id)`,
   `PRIMARY KEY (tenant_id, id)`, `repo_path`, FKs to `mos_action_proposals` / `mos_design_surfaces`,
   `ALTER TYPE event_type ADD VALUE` per transition, RLS on + `REVOKE ALL FROM authenticated, anon`,
   `update_updated_at()` trigger, and `mos_calendar_items` as the one cross-channel projection.
2. `marketing-os/packages/marketing-os/templates/agents/lib/store-repo/index.ts` — the
   `db` / `mirror` / `git` mode seam and its deliberate git-first write order + per-mode failure
   posture. Read the header comment in full; it explains the reasoning you must preserve.
3. `.../templates/agents/scripts/backfill-artifacts-to-git.ts` — dry-run-by-default, idempotent,
   reports conflicts instead of resolving them. You are adding `--prefix offers/` usage, not a
   new script.
4. `marketing-os/packages/skills/email-campaign/` and `packages/skills/social-media/` — the pack
   shape: `metadata / requires / tools / actions / instructions`, a repo seam in `types.ts`,
   `actions.ts` declaring `Action<P>` with deterministic `previewHash`.
5. `.../templates/agents/lib/email/repo.ts` — how a pack's canonical logic is **vendored** into
   the template with a header naming the canonical source.
6. The three current offer copies: `.../templates/agents/src/mastra/tools/offer-*.ts`,
   `marketing-os-hosted-agents/src/mastra/tools/offers.ts` + `lib/offers/`, and
   `marketing-os-app/{extensions/surfaces,app/routes/api.offers.*,app/offer-posteriors.server.ts}`.

## Phases — ship in order, each independently mergeable

Do **not** start a phase before its predecessor is merged and verified. Each phase gets its own
branch and PR against `main` in the repo(s) it touches.

### OF0 — De-duplicate into `packages/skills/offers`
Create the pack in the email/social shape with an `OfferRepo` seam (extending `StoreRepo`). Move
the template's three tool files in as canonical logic. Bind it from the template (vendored, per
`lib/email/repo.ts`'s pattern, with the canonical-source header) and from the pooled runtime
(`marketing-os-hosted-agents/lib/offers/*` becomes a *binding*, not a second implementation).
Declare Actions `offer.activate / pause / retire / reallocate` with deterministic preview hashes.
**Exit:** one canonical implementation, three bindings, tests green in all three repos, and no
behaviour change visible to a merchant.

### OF1 — Console consolidation
`Surfaces` → `Offers` in `components/app-shell.tsx`; route `/surfaces` → `/offers` with a
permanent redirect; icon `Layers` → `Megaphone`. Live tab is today's page re-titled. Add thin
**Drafts** (links into Reviews — do **not** reimplement approval) and **Setup** (app-embed status,
placement defaults, consent text, ESP destination, frequency caps) tabs. Then sweep every
merchant-visible string per the §2.1 vocabulary rule: *if a merchant reads it, it says Offer.*
Leave `extensions/surfaces`, the manifest schema, `window.mos`, and `docs/SURFACES-SDK.md`
untouched — those keep the framework name.
**Exit:** a merchant never reads the word "surface"; every old deep link still resolves.

### OF2 — Artifacts + the lane (the big one, D6)
Artifact formats `offers/strategy.md`, `offers/{id}/offer.md`, `offers/{id}/results.md` with
round-trip parse/serialize tests, provenance tags, and citations back to the `brand.md` section
behind each incentive choice. `010_offers.sql` mirroring `007` convention for convention
(§4.2's table is the checklist). `mos_offer_artifacts` in the `mos_email_artifacts` shape.
Migrate `StorefrontSurface` + `SurfaceMetricDaily` off Prisma onto the `mos_*` lane **with a
backfill**, then drop the Prisma models. Wire `upsertCalendarItem`, `action_proposal_id`, and the
lifecycle `event_type` values. Implement the §4.1 write order exactly as written.
**Exit:** an offer is diffable in git, appears on the shared calendar, links to the approval that
armed it, and emits lifecycle events into the same audit stream as email. `mos_calendar_items`'
acceptance criterion from `007` — *"a third channel renders with zero calendar-component
changes"* — is now actually tested; if you have to touch the calendar component, you got the
projection wrong.

### OF3 — Parity I: the runtime (`marketing-os-app/extensions/surfaces`)
Add `placement: "takeover"` (focus trap, scroll lock, Escape + one-tap dismiss, reduced-motion,
zero-CLS), exit-intent trigger (desktop mouse-out; mobile via scroll-velocity — **never** a
history-trap), teaser/minimized re-open state, extended targeting (geo/device/referrer/UTM/
new-vs-returning, evaluated client-side from data the runtime already has — no extra request),
and `schedule: {from, to}` campaign windows.
**Hard constraints, non-negotiable:** ≤15 KB gzipped, zero dependencies, zero external requests
beyond the proxy, zero CLS, WCAG AA, fails-invisible. If the budget is at risk, say so and stop
— do not silently exceed it.
**Exit:** a merchant can rebuild their current Wisepops setup.

### OF4 — Parity II: the data
Multi-step zero-party capture (`steps[]` in the manifest: question → choice → email). The hosted
capture POST endpoint per **D8** — PII goes to the hosted stack on *every* tier, with the consent
record. Klaviyo sync reusing the email pack's existing connection: list/segment subscribe plus
answers as profile properties. Customer metafields on the Shopify side. The **Captures** tab with
answers as columns and CSV export.
**Exit:** the thing merchants log in for exists.

### OF5 — The standing loop
Weekly offer ritual cron (spec 19 shape: idempotent, `CRON_SECRET`-gated, self-limiting) posting
one branded card — what's running, what the evidence says, the recommended move, and when an
experiment concludes, the *next hypothesis already drafted*. Implement the §8 approval line:
**reallocation among approved arms needs no new approval; any new creative, arm, or copy edit
does** and invalidates the nonce (spec 24 D2). Say which is which on the approval card. Build
`offer-portfolio-audit`.
**Exit:** it optimises without being asked, and never ships creative nobody approved.

### OF6 — The ejection contract (spec 31 applied to offers)
Replace the template's O0 `console.log` sink in `app/api/surfaces/events/route.ts` with a real
counter store in the store's own Postgres. Add `offer_performance` as a **semantic view** (the
move that made `email_performance` flow through Tier 1 for free on 2026-09-09). Expose Tier-2
`offer_read / offer_strategy_read / offer_experiment_read / offer_captures_read` on the store's
MCP endpoint — **aggregates and distributions only, never PII (D8)**. Enforce spec 31 §5.3: for a
tenant with `agentsUrl` set, the pooled runtime must not answer offer questions from platform
storage. Unreachable must surface as *"the store's data is unreachable"*, never as *"no offers"*.
Never expose `offer.activate / pause / retire / reallocate` over MCP — Tier 3 is propose-only.
**Exit:** an ejected store owns its offer stats and the hosted agent reads them correctly.

### OF7 — Publish
Extract the runtime to `@avant-garde/surface-runtime` (MIT) — this is what makes the open-source
claim true rather than technically-true. Add the `bar` surface type. Refresh README +
`docs/SURFACES-SDK.md`. Rewrite playbook Vol. 04 against the new shape. Draft listing + pricing
copy, leading with the control arm and the mechanical dark-pattern refusal.

## Invariants — violating any of these is a bug, not a tradeoff

1. **One canonical implementation.** After OF0, a behaviour change lands in `packages/skills/offers`
   and propagates. If you find yourself editing the same logic twice, stop.
2. **Every offer is an experiment with a held-out control arm.** There is no "just publish" path.
3. **The dark-pattern gate is mechanical and runs twice** — in the pack at propose time and
   platform-side at activate time. Never trust the first one alone.
4. **No countdown timers, fabricated stock, confirmshame dismissals, or spin-to-win. Ever.** This
   is the product's position, not a configurable default.
5. **The storefront is sacred.** Fails-invisible: any error means no offer, never a broken one.
6. **Execution never rides MCP.** A connector token is possession, not identity. Approval needs a
   human (spec 20).
7. **PII never rides MCP and never ejects** (D8).
8. **Git-first write order** (§4.1), with per-mode failure posture copied from
   `lib/store-repo/index.ts` — the index lying about truth is the worse failure.
9. **No silent fallback to platform storage for an ejected tenant** (spec 31 §5.3).
10. **Where email and offers could differ, they don't** (D6).

## Working agreement

- **Verify before you assert.** Spec 28 confidently said the hosted port hadn't happened; it had.
  Check the code, not the doc, and correct the doc when it's stale.
- **Tests alongside, not after.** Artifact formats get round-trip tests; Action previews get
  hash-determinism tests; the runtime gets size + a11y assertions in CI.
- **Migrations are reversible and backfilled.** The OF2 Prisma→Supabase move touches live tenant
  data; dry-run first, report conflicts, never resolve them by guessing.
- **Ask when a decision is genuinely open** — the five open questions in §12 are real and
  unanswered. Don't invent answers to them silently; flag them and proceed with the rest.
- **Report honestly.** If a phase is half-done, say which half. If the 15 KB budget breaks, say so
  before merging, not after.

## Definition of done

A merchant on the $15 Starter plan can, without leaving the console: have the agent design an
offer grounded in their brand, approve it, watch it deploy to a live storefront as an experiment
with a held-out control, see the captures and the zero-party answers it collected, have those
answers land in Klaviyo, get a weekly card telling them what the evidence says and what to do
next — and cancel Wisepops.
