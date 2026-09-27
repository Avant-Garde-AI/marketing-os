# 32 — The Offer Agent: consolidation, the pack, and the $15 wedge

> **Status:** decisions closed 2026-09-15 · **OF0 (consolidation) + OF1 (nav) + OF2 (artifacts/Actions, code-only) built 2026-09-16** — PRs open, not merged. OF2's migration is drafted, not applied. OF3-OF7 not started.
> **Amends:** spec 14 Part II (the Offer Agent) and §2.4 (console placement). **Spec 14 Part I — the Storefront Surfaces framework — stands unchanged** as the runtime layer beneath this.
> **Corrects:** spec 28 §3 (the hosted port it describes as pending has since landed).
> **Companions:** 20 (Actions), 22 (Brand Soul), 23 (Design Surfaces), 24 (the pack pattern this follows), 25 (blocks + pack-owned schemas), 27 (change sets / Reviews), 28 (playbooks, the open-core line), 30 (design library), 31 (the ejected store contract).
> **First target:** Arthaus, then template default.

---

## 1. Why revisit

Spec 14 was right about the thesis and right about the rails. Two things have happened since
that make its *product* shape wrong, and one commercial fact has hardened.

**1. The pack pattern was invented after offers, and proved twice.** Email
(`packages/skills/email-campaign`) and social (`packages/skills/social-media`) are versioned
packs: `metadata / requires / tools / actions / instructions`, a repo seam, file-first
artifacts, an enable gate, an Action set the platform executes. Offers predates all of it and
has none of it — three loose tool files in the console template
(`templates/agents/src/mastra/tools/offer-{design,review,performance}.ts`), no package, no
artifacts, no repo provenance.

Worse, it now exists in **three copies across three repos**:

| copy | where | what it is |
|---|---|---|
| template | `marketing-os/packages/marketing-os/templates/agents/src/mastra/tools/offer-*.ts` | the MIT authoring tools, self-host path |
| pooled runtime | `marketing-os-hosted-agents/src/mastra/tools/offers.ts` + `lib/offers/` | the port spec 28 said was pending; it landed |
| governance | `marketing-os-app` (`extensions/surfaces`, `api.offers.*`, `offer-posteriors.server.ts`) | runtime, surface store, gate, posteriors |

Spec 31 §2.1 names this exact pathology for the email pack — *"a capability shipped to one copy
is invisible in another, and the symptom is always 'it works when I test it and not when you
use it'"* — and says do not create a fourth axis of divergence. Offers is already the third.

**2. Spec 14 §2.4 declined a console section** ("A dedicated Offers view is earned later by
usage, not shipped on spec"). It was earned — `/surfaces` exists and works. But it shipped
under the framework's name, not the product's, and that name now collides with **Design
Surfaces** (spec 23, Penpot) sitting two rows below it in the same nav. "Surfaces" is an
architecture word that leaked into the navigation. The merchant does not have surfaces. The
merchant has offers.

**3. The commercial frame is now explicit — and already wired.** `entitlements.server.ts`
already reads `offers: "starter"`, and Starter is the $15 managed-pricing plan
(`plan.server.ts`: *"$15 is Starter and nothing else"*). The offer engine is *already* the
first paid step; `skill-packs.server.ts` says so in a comment. **The bundling is not the work.
The work is making the $15 swap credible** — a merchant paying Alia or Wisepops has to be able
to cancel it, not merely admire ours.

So this spec does three things: consolidate the console vocabulary, package the agent the way
every other capability is packaged, and close the parity gap that stands between a demo and a
cancelled subscription.

---

## 2. Consolidation: **Offers** is the section, **Surfaces** is the layer

### 2.1 The vocabulary rule

| Word | Means | Where it may appear |
|---|---|---|
| **Offer** | the merchant-facing product — a thing that appears on the storefront and asks for something | nav, chat, Slack, docs, the listing, pricing page |
| **Surface** | a framework slot on the storefront (manifest `type`, runtime web component, SDK registration) | code, manifest, `docs/SURFACES-SDK.md` — **never in the UI** |
| **Design Surface** | a Penpot file (spec 23) | inside Design Studio only |

One rule, enforced by review: *if a merchant reads it, it says Offer.*

### 2.2 The nav

```
  Overview   Chat   Brand   Playbooks   Calendar   Email   Offers   Design Studio   Social   Skills   Activity
                                                            ▲
                                                   was "Surfaces"
```

`Surfaces` → `Offers`, `Layers` icon → `Megaphone` (or `BadgePercent`), `/surfaces` → `/offers`
with a permanent redirect so existing deep links and the empty-state chat prompts keep working.

### 2.3 What the section holds

Today `/surfaces` is one page: live offers, arms, posteriors, a verdict line. That is the
**Live** tab of four. The other three are what a popup-vendor replacement actually needs, and
the second one is the one merchants log in *for*:

- **Live** — running offers: creative as deployed, the experiment funnel, the decision read,
  and the two seams into chat. Today's page, re-titled. *(exists)*
- **Captures** — what the offers actually collected. Email, timestamp, offer, arm, and — once
  §5 lands — the **zero-party answers as columns**. Export CSV, ESP sync status per row. This
  is the artifact the incumbents sell and we currently do not show at all. *(new)*
- **Drafts** — proposed-but-unapproved offers. Does **not** duplicate the approval inbox: it
  links into spec 27 Reviews, which is the one place staged work is approved. *(new, thin)*
- **Setup** — app-embed status (the one switch no agent can flip — spec 28 OQ4), placement
  defaults, consent text, ESP destination, global frequency caps. *(new)*

### 2.4 What happens to the framework

Nothing. `extensions/surfaces`, the manifest schema, `window.mos`, `docs/SURFACES-SDK.md`, the
`StorefrontSurface`/`SurfaceMetricDaily` tables all keep their names. Spec 14 Part I remains the
spec for the layer. This is a renaming of the *product surface*, not the *substrate* — and the
substrate is about to carry a second and third surface type (§5), which is precisely why it
should keep the general name while the nav takes the specific one.

---

## 3. The pack: `packages/skills/offers`

Same shape as `email-campaign` and `social-media`, per spec 20 §5 — which already reserves a
`surfaces` field for exactly this.

```ts
export const metadata    = { id: "offers", name: "Offer Agent", category: "Storefront", version };
export const requires    = { providers: ["shopify"], optional: ["klaviyo"] };
export const tools       = createOfferTools({ repo, platform });   // repo+client-bound factory
export const actions     = [offerActivate, offerPause, offerRetire, offerReallocate];
export const instructions = "…";
export const surfaces    = [offerSurface, barSurface];             // spec 20 §5's reserved field
export const reports     = [offerWeeklyRecap];                     // spec 19
```

**The seam is `OfferRepo`**, mirroring `EmailRepo` / `SocialRepo`: the pack never touches a
database or a credential. It reads and writes artifacts through the seam and declares Actions
the platform gate executes. That is what makes one implementation servable from the template,
the pooled runtime, and an ejected console without a fourth copy.

**Migration is a move, not a rewrite.** The three template tool files become the pack's
`tools.ts`; `marketing-os-hosted-agents/lib/offers/*` becomes the hosted *binding* of the seam,
not a second implementation; the template and the pooled runtime both take a dependency. The
`marketing-os-app` half (runtime, surface store, posteriors, the gate) stays where it is and
stays private — see §7.

**Plug-in story.** Because `offer-engine` is already an installable row in the plugin catalogue
with `feature: "offers"` and a real enablement gate (`mos_skill_enablements`), packaging it
costs nothing at the install seam. An ejected or self-hosted store does
`npm i @avant-garde/skill-offers`, binds an `OfferRepo`, and gets the identical agent.

---

## 4. Artifacts: files are truth, the manifest is compiled **(D2)**

Spec 14 D3 said no git round-trip on offer approval, and it was right about the *latency*, not
about the *record*. Offers is the only capability with no diffable history of what was tried,
no provenance back to the brand section that justified an incentive, and nothing to carry
across an eject. The resolution keeps D3's speed:

**In the store repo** (`offers/`, alongside `email/` and `social/`):

- `offers/strategy.md` — the standing offer strategy: which incentives this brand will and
  won't run and why (from `brand.md` §2/§6 persona signals), placement policy, consent
  language, frequency posture, the explicit dark-pattern stance. Versioned + provenance-tagged
  like `brand.md`, refined in the same co-creative session pattern.
- `offers/{id}/offer.md` — the offer spec: hypothesis, persona signal it answers (cited to the
  brand section), incentive type, per-arm copy, placement, triggers, audience, consent text,
  status trail, provenance (`@agent` proposed / `@owner` edited).
- `offers/{id}/results.md` — appended at each review: the posteriors as of that read, the
  decision taken (promote / iterate / retire), and the reasoning. This is what makes "why did
  we stop running that" answerable a year later.

**In the DB** — `StorefrontSurface` (the compiled manifest, the thing the runtime serves) and
`SurfaceMetricDaily` (per-arm counters). Both are **projections**, both rebuildable: the
manifest is a pure compile of `offer.md`, and a reconcile job can rebuild the surface store
from the repo. That is also what makes ejection work (§6).

### 4.1 The write lane — mirrored from email, not invented **(D6)**

The email agent already solved this, and offers should not solve it differently.
`templates/agents/lib/store-repo/` is a `StoreRepo` seam with **three modes** set by
`STORE_REPO_MODE`:

| mode | behaviour |
|---|---|
| `db` *(default)* | artifacts in `mos_*_artifacts` (shop + path → markdown). Nothing changes for a store that hasn't opted in. |
| `mirror` | **git is truth, the DB is kept in step.** Reads prefer git, fall back to the DB. Writes go git-first, then DB. A failed commit falls back to the DB with a loud log. |
| `git` | git only. The end state. A failed commit fails the write — there is nowhere else for truth to live. |

Offers binds the same seam with the same modes and the same
`scripts/backfill-artifacts-to-git.ts` (dry-run by default, idempotent, reports conflicts
rather than resolving them) run with `--prefix offers/`. No new migration machinery.

**Write order, therefore, is git-first** — the same order and for the same reason email uses
it: *the index lying about truth is the worse failure, and the harder one to notice.*

```
offer.activate.execute():
  1. compile offer.md → manifest; re-validate mechanically (dark-pattern gate, weights, consent)
  2. WRITE offers/{id}/offer.md through StoreRepo        ← truth (git-first per mode)
  3. WRITE the surface store (StorefrontSurface)         ← the deploy. live within seconds.
  4. UPSERT mos_offers + mos_calendar_items              ← the index
```

**This reverses what an earlier draft of this spec proposed**, and it is worth saying why.
Spec 14 D3 ruled out "a git round-trip on offer approval" — and it was right, because at the
time the only git lane was a **PR round-trip with human review latency**. `commitFile()` through
the GitHub App is not that; it is an API call on the order of the database write beside it — the
`brand.md` write path has been running it live since 2026-07 (`src/mastra/tools/brand-design.ts`).
D3's constraint was never about the milliseconds, it was about not putting a second human
approval behind the first one. Git-first preserves that and gets the audit trail too.

**Correction, checked while building OF2 (2026-09-16):** the claim in an earlier draft of this
paragraph — "the email agent has been running \[the git lane] in a live write path since
2026-08-31" — is **wrong for the pooled runtime**. `templates/agents/lib/store-repo/` (the
`STORE_REPO_MODE` seam this section describes) exists only in the OSS template; reading
`marketing-os-hosted-agents/lib/email/repo.ts` directly confirms it has never imported it —
`email/*.md` is DB-only there (`mos_email_artifacts`), exactly like every other artifact. A
project memory independently records the same fact ("repo.ts is DB-backed with the git lane
deferred; `commitFile()` in `brand-design.ts` is the proven path to promote"). So: the git-first
*ordering* in this section is correct and is what OF2 built, and it is real, tested capability in
the **template** (a self-hosted or ejected store on `mirror`/`git` mode gets it today). For the
**pooled runtime** — where Arthaus and every non-ejected tenant actually run — `offers/*.md`
lands in `mos_offer_artifacts` today, same as `email/*.md` lands in `mos_email_artifacts`,
because that seam has not been ported there for either pack. Porting it is shared, not
offers-specific, follow-up.

Step 3 is still the deploy and is still what makes the offer live; a store on `STORE_REPO_MODE=db`
(the template's default) or on the pooled runtime (which has no other mode yet) gets the
identical externally-visible behaviour spec 14 shipped — the write just lands in a table instead
of a commit until the seam is ported.

### 4.2 The index tables — mirror `007_email_and_calendar.sql` **(D6)**

Offers' two existing tables are the odd ones out in the platform: `StorefrontSurface` and
`SurfaceMetricDaily` are **Prisma models keyed by `shop`**, while every pack shipped since lives
in **Supabase `mos_*` migrations keyed by `tenant_id`**. That difference is why offers has no
calendar presence, no approval-proposal link, no lifecycle events, and no `repo_path` back to
truth — none of it was withheld, it just was never on the lane that provides them.

`010_offers.sql` adopts the email lane's conventions line for line:

| Email convention (`007`) | Offers |
|---|---|
| `tenant_id TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE`, `PRIMARY KEY (tenant_id, id)` | same, replacing the `shop`-keyed Prisma PK |
| `repo_path TEXT NOT NULL` — the file that is truth | `offers/{id}/offer.md` |
| `action_proposal_id UUID REFERENCES mos_action_proposals(id)` | same — links the offer to the approval that armed it |
| `design_surface_id UUID REFERENCES mos_design_surfaces(id)` | same — offer creative composes on spec 23 |
| `readback JSONB` — rollup + basis | `posteriors JSONB` — per-arm Beta state + the basis it was computed from |
| `ALTER TYPE event_type ADD VALUE` per lifecycle transition | `offer.proposed / approved / activated / reallocated / paused / retired / failed` |
| `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM authenticated, anon` | same. App writes as owner. |
| `update_updated_at()` trigger | same |
| writes through the shared `upsertCalendarItem` into `mos_calendar_items` | same — an offer with a `schedule` window becomes a calendar item with `pack_id: "offers"`, `channel: "storefront"` |
| `mos_email_artifacts` (shop + path → markdown) | `mos_offer_artifacts`, identical shape |

Tables: **`mos_offers`** (the offer index) and **`mos_offer_metrics_daily`** (per-arm daily
counters, carrying `SurfaceMetricDaily`'s unique index shape forward). The Prisma models are
migrated with a backfill and then dropped; `shop → tenant_id` is a lookup the platform already
does on every proxy request.

The payoff is not tidiness. It is that **an offer appears on the shared calendar, links to its
approval, emits lifecycle events into the same audit stream as email and social, and points at
the file that explains it** — four capabilities offers is missing today purely because it sits
on the wrong lane. And `mos_calendar_items`' acceptance criterion from `007` (*"a third channel
renders with zero calendar-component changes"*) finally gets tested by a third channel.

## 5. Parity: what has to be true before a merchant cancels Wisepops

The honest test is not "is ours nicer." It is: *can they turn the other one off?* Today they
cannot — we ship one placement, one step, one trigger kind, and captures that land as a Shopify
customer and are never shown back. Scope for v1, per **D1**:

| Incumbent capability | v1 stance | Work |
|---|---|---|
| **Full-screen takeover** (Pupford, FringeSport shape) | **IN** | New `placement: "takeover"` in the runtime. Focus trap, scroll lock, `Escape` + one-tap dismiss, reduced-motion, still zero-CLS. The format merchants point at. |
| **Multi-step zero-party capture** | **IN** | Manifest `steps[]` (question → choice → email). Answers ride the capture event and land as customer metafields + ESP profile properties. Alia's actual moat; also the richest possible input to every other agent we run. |
| **ESP sync beyond Shopify customer** | **IN** | Klaviyo first, reusing the email pack's existing connection: list/segment subscribe + answers as profile properties. Shopify-customer-with-consent stays the floor, not the ceiling. Reverses spec 14 §1.5. |
| **Announcement bar** | **IN** | Second surface type `bar`. Cheapest widening of "replaces my popup app" into "replaces my bar app too". |
| **Exit intent** | **IN** | A trigger kind, not a dark pattern. Desktop mouse-out; mobile uses scroll-velocity/history heuristics, never a history-trap. |
| **Teaser / minimized state** | **IN** | The small re-open tab after dismiss. High parity value, ~40 lines, and strictly *less* aggressive than re-showing the modal. |
| **Targeting: geo / device / referrer / UTM / new-vs-returning** | **IN** | Extends the existing `audience` block. Evaluated client-side from data the runtime already has; no extra request. |
| **Campaign scheduling windows** (BFCM) | **IN** | Manifest `schedule: {from, to}`. Trivially, and it is the seasonal ask every year. |
| **A/B testing** | **already better** | Control arm always held out, Beta posteriors, bandit-native. Most incumbents ship split-only with no control. Say this in the marketing copy. |
| **Analytics dashboard** | **already better** | Offers → Live, plus the agent can be *asked*. |
| **SMS capture** | **OUT (D7)** | A TCPA-compliant double-opt-in is a compliance surface, not a feature, and it drags in a provider, a consent ledger, and a quiet-hours regime. Out of v1 and out of the $15 tier. Revisit as its own spec if demand is real. |
| **Multi-language / Shopify Markets** | **OQ1** | Per-market copy in the manifest. Deferred, flagged. |
| **Spin-to-win, wheels, scratch cards** | **OUT, permanently** | Gamified fake-chance mechanics. |
| **Countdown timers, fabricated stock, confirmshame** | **OUT, permanently** | Blocked mechanically by `checkDarkPatterns`, not by policy. |

The last two rows are not a gap, they are the pitch. Every competitor's template gallery leads
with a spin-to-win wheel. **We are structurally incapable of shipping one**, and that is the
sentence the brand-conscious merchant buys.

**The honest gaps at v1:** SMS (deliberately — D7), multi-language, cart/checkout offers (still deferred per spec 14
D1), and a template gallery — we generate offers from the brand rather than offering 200
templates, which is a better product and a worse demo. Name it rather than hide it.

---

## 6. The ejected store: offer stats behind the store's own MCP

Spec 31 §5.5 says the contract generalises beyond email. Offers is the next one, and it is
currently in a *worse* state than email was, because the asymmetry runs the other way.

**Today**, for every tier, the storefront event beacon goes through the platform App Proxy and
lands in `SurfaceMetricDaily` in the **platform** database. The console template's own sink
(`app/api/surfaces/events/route.ts`) is still the O0 placeholder — a `console.log` — and
`app/surfaces/page.tsx` fetches its numbers from `MARKETING_OS_API_URL`. So an ejected store
owns its email and social state but **rents** its offer state, and reads it back over an API
key rather than through the governed layer.

That is a second convention in a system that spec 31 just finished reducing to one. The fix,
applied in the same tiering:

**On eject, offer state moves with everything else:**
- the event beacon posts to `{agentsUrl}/api/surfaces/events` (the proxy handoff already
  verifies there — `verifyProxyHandoff` is built), and that route becomes a **real counter
  store** in the store's own Postgres instead of a log line;
- captures land in the store's own DB and its own ESP connection;
- `offers/*.md` artifacts are already in the store's repo per §4.

**And the store exposes them over its MCP endpoint**, so the hosted/pooled analytics agent
reads them the way it reads email — no second code path, no silent fallback:

| Tier | Tools |
|---|---|
| **1 — Measure** | `offer_performance` as a **semantic view** (per-arm exposures/impressions/captures/rate, credible intervals, P(best), attributed orders/revenue), reachable through the existing `query` / `explain_query` / `describe_field` envelope. The same move that made `email_performance` a view on 2026-09-09 — after which email results flowed through Tier 1 with no additional work. |
| **2 — The work record** | `offer_read` (the offer spec + status trail), `offer_strategy_read`, `offer_experiment_read` (arms, allocation history, posteriors as of now), `offer_captures_read` — **aggregates and zero-party answer distributions only.** No email addresses, ever (D8). |
| **3 — Propose, never execute** | `propose_offer` and `offer_strategy_upsert` may be served — they write the store's repo and create proposals. **`offer.activate` / `pause` / `retire` / `reallocate` never are.** A connector token proves possession of a token, not a human. Spec 20's invariant, no exception. |

### 6.1 Captures and PII never ride MCP **(D8)**

Stats eject; **personal data does not**. A capture — the email address, the consent record, the
zero-party answers attached to a person — POSTs from the storefront to a **hosted Marketing OS
endpoint** on every tier, ejected included, and is stored and synced to the ESP there.

The reasoning is the same one that keeps the Action gate hosted: consent capture is a compliance
surface with a legal record behind it, and one governed implementation of it is worth more than
per-store copies that drift. It also keeps PII off the MCP transport entirely — a connector token
proves possession of a token, and that is not a basis on which to hand an agent a customer list.

So the split is clean, and each half goes where it belongs:

| | Ejected store's own DB, exposed over MCP | Hosted stack, over a POST endpoint |
|---|---|---|
| per-arm counters, exposures, captures **as a count** | ✅ | |
| posteriors, allocation history, experiment verdicts | ✅ | |
| answer **distributions** ("62% chose 'gift'") | ✅ | |
| the email address, consent text + timestamp, the per-person answers | | ✅ |
| ESP sync (Klaviyo list + profile properties) | | ✅ |

Raw capture rows are readable in the console behind an authenticated session, and exportable as
CSV by the merchant. The agent reasons over distributions, which is all it needs to design the
next offer.

And spec 31 §5.3 applies verbatim: **for a tenant with `agentsUrl` set, the pooled runtime must
not answer offer questions from platform storage.** Either the store's MCP answers or the agent
says the store is unreachable. A confident "no offers are running" against a store running three
is the §1 failure of spec 31 wearing a different hat.

**The pooled tier is unaffected** — same tables, same platform, same answers.

Spec 14 §1.3 already stated the intent (*"on eject, the surfaces API is part of the agents deployment and state rides the tenant's own Postgres"*). It was never built — the
template's event route is still the O0 log line — and the MCP exposure that makes the
hosted analytics agent able to *read* that state is new here. This section is that
intent, finished, under spec 31's tiering.

---

## 7. Open core **(D3)** and the $15 argument

| Layer | Where | Licence |
|---|---|---|
| The pack — tools, Actions, artifact formats, instructions, `OfferRepo` seam | `marketing-os/packages/skills/offers` | **MIT** |
| The surface runtime, web components, `window.mos` SDK, manifest schema | `marketing-os-app/extensions/surfaces` → **extract to `@avant-garde/surface-runtime`** | **MIT** |
| The dark-pattern gate | `@avant-garde/design-loop` (`checkDarkPatterns`) | **MIT** (already) |
| The analysis spine — Beta posteriors, sequential test, bandit reallocation | `marketing-os-app/offer-posteriors.server.ts` | private |
| Multi-tenant surface store, credential broker, Action gate, the managed app embed | `marketing-os-app` | private |
| Cross-store benchmarks and skill-optimisation traces | hosted | private |

**You can self-host a working offer engine. You cannot self-host the learning.** The gate is
MIT on purpose — "we refuse dark patterns" is only credible if anyone can read the blocklist.

Extracting the runtime to its own MIT package is new work this spec adds, and it is the one that
makes the OSS claim true rather than technically-true: today the authoring half is open and the
thing that renders on the storefront is not, so "open source popup engine" overstates it.

### The $15 argument

Already wired (`offers: "starter"`), so this is positioning, not plumbing:

- It replaces a line item the store already pays monthly — the swap is net-negative cost on day
  one. *(Competitor price points move; verify current published pricing before any of this goes
  on a pricing page.)*
- Every offer ships as an experiment with a held-out control. Most of the category ships
  split-tests without one.
- It refuses dark patterns mechanically. Brand-safety argument to the owner, defensible
  position publicly.
- It gets better with the brand artifact the merchant already produced in playbook volumes
  01–02 — so the first-run sequence sells the upgrade rather than a pricing page doing it
  (spec 28 §4).
- And the offer is the **only** surface where the agent gets ground-truth conversion feedback on
  a design decision — which is what makes "continuously upgrades your offers" a mechanism rather
  than a claim.

---

## 8. The standing loop — what "continuously optimises" actually means

Today the agent is request-driven: you ask for an offer, it proposes one. That is not a product
that justifies a subscription. It needs a ritual, the way social has a weekly queue card.

- **The weekly offer ritual** (cron, spec 19 shape, idempotent, `CRON_SECRET`-gated): reads the
  posteriors, and posts one branded card — what is running, what the evidence says, and the
  recommended move. When an experiment concludes it arrives with the *next* hypothesis already
  drafted, not just a verdict.
- **Reallocation inside an approved experiment is not a new approval.** The merchant approved
  *the experiment* — arms, creative, consent — not a fixed split. Moving weight among approved
  arms is the engine doing what was approved. **Any new creative, new arm, or copy edit is a new
  approval**, and invalidates the nonce per spec 24 D2. That line is what lets this be automatic
  without violating spec 20, and it should be stated in the approval card so the merchant knows
  what they are consenting to.
- **Design upgrade, not just copy rotation.** Offer creative composes on Design Surfaces (spec
  23) from the store's published design library (spec 30), the same lane email and social
  creative use. "Continuously upgrade the design" means new variants drawn from the library and
  tested against the incumbent — with conversion ground truth, which no other design decision in
  this platform gets.
- **Portfolio view.** `offer-portfolio-audit` (spec 14 §2.3, never built): what is live, what is
  fatigued, what stage of the funnel has no offer at all. This is what turns one popup into an
  offer *program*, and it is the upsell path from Starter.

---

## 9. Build phases

| Phase | Deliverable | Size | Exit |
|---|---|---|---|
| **OF0** | **De-duplicate.** `packages/skills/offers` with the `OfferRepo`/`StoreRepo` seam; template + pooled runtime bind it (vendored the way email is — see OQ4); the three-copy problem is closed. | M | One canonical implementation, tests green in all three repos |
| **OF1** | **Console consolidation.** `/offers` + redirect, nav + icon, vocabulary sweep, Live tab re-titled, Drafts linking into Reviews, Setup with app-embed status. | S | A merchant never reads the word "surface" |
| **OF2** | **Artifacts + the lane (D6).** `offers/strategy.md` / `offer.md` / `results.md` formats; the four Actions, git-first (§4.1); `010_offers.sql` mirroring `007` — **✅ built 2026-09-16, code-only**. Still open: applying the migration, backfilling `StorefrontSurface`/`SurfaceMetricDaily` into it, dropping the Prisma models, wiring `mos_calendar_items`, and the OQ6 executor cutover — bundled as one production checkpoint, not split across separate PRs. | L | An offer is diffable, appears on the shared calendar, and links to its approval |
| **OF3** | **Parity I — the runtime.** `takeover` placement, exit-intent + teaser, extended targeting, scheduling windows. | M | A merchant can rebuild their current Wisepops setup |
| **OF4** | **Parity II — the data.** Multi-step zero-party capture, the hosted capture POST endpoint (D8), Klaviyo sync with answers as profile properties, the **Captures** tab + CSV export. | M | The thing they log in for exists |
| **OF5** | **The standing loop.** Weekly ritual cron, in-experiment reallocation under one approval, concluded → next-hypothesis, `offer-portfolio-audit`. | M | It optimises without being asked |
| **OF6** | **Ejection contract.** Real event counters in the template, `offer_performance` semantic view, Tier-2 offer tools on the store MCP, no-silent-fallback enforcement. | M | Spec 31 §5.5 satisfied for offers |
| **OF7** | **Publish.** Extract `@avant-garde/surface-runtime` (MIT), `bar` surface type, README + SDK docs refresh, playbook Vol. 04 rewritten, listing + pricing copy. | S | "Open source offer engine" is true without an asterisk |

OF0–OF2 is the consolidation the nav change implies. **OF3–OF4 is the phase that earns the
$15** — everything before it is hygiene and everything after it is compounding.

---

## 10. Decisions (Garrett — D1–D5 2026-09-11, D6–D8 2026-09-15)

- **D1 — Parity scope: all four, plus the cheap triggers.** Full-screen takeover, multi-step
  zero-party capture, ESP sync beyond Shopify customer, announcement bar — plus exit-intent,
  teaser, extended targeting and scheduling windows, which are small and complete the swap.
  Gamified chance mechanics stay permanently out.
- **D2 — Hybrid artifacts: files are truth, the manifest is compiled.** Repo artifacts carry
  hypothesis, copy, provenance and history; the deployed manifest and the index row are both
  projections, rebuildable from the file. Write order is **git-first**, per D6 and §4.1 — spec
  14 D3 ruled out a *PR round-trip*, not a `commitFile()`.
- **D3 — Open core: the whole pack plus the runtime are MIT; the optimisation engine is
  hosted.** Analysis spine, bandit, benchmarks, multi-tenant store and the Action gate are the
  service.
- **D4 — Nav: `Offers` replaces `Surfaces`.** The framework keeps its name in code and the SDK;
  `Design Surfaces` keeps its name inside Design Studio. The merchant-facing vocabulary is
  Offer, everywhere, with no exceptions.
- **D5 — Ejected stores own their offer *stats*** and expose them through the store MCP under
  the spec 31 tiering, with no silent fallback to platform storage.
- **D6 — Instrumentation mirrors the email agent exactly, not a new design.** The `StoreRepo`
  seam with its `db` / `mirror` / `git` modes and git-first write order (§4.1), the
  dry-run-by-default backfill script, and a `010_offers.sql` Supabase migration following
  `007_email_and_calendar.sql` convention for convention (§4.2). The two `shop`-keyed Prisma
  tables migrate onto that lane. **Where email and offers could differ, they don't.**
- **D7 — SMS is out.** Not deferred-with-a-wink: out of v1 and out of the $15 tier. A
  TCPA-compliant double-opt-in is a compliance surface — consent ledger, quiet hours, carrier
  rules, a provider relationship — and shipping a thin version of it is worse than shipping
  none. If demand is real it earns its own spec.
- **D8 — PII goes to the hosted stack over a POST endpoint, on every tier.** Email addresses,
  consent records and per-person answers never ride MCP and never eject; counters, posteriors
  and answer *distributions* do (§6.1). One governed implementation of consent capture beats
  per-store copies that drift.

## 11. Non-goals

- **No autonomous creative.** New creative always re-arms the approval. Only weight moves
  automatically, only among approved arms.
- **No cart/checkout offers in v1** — spec 14 D1 stands; upsell/post-purchase is a different
  risk profile and a different spec.
- **No template gallery.** Offers are generated from the brand. This loses a demo and wins a
  product; do not quietly grow a gallery to close the gap.
- **No sending infrastructure.** We replace capture and display. Klaviyo/Shopify Email keep
  sending.
- **No second approval path.** Drafts links into Reviews (spec 27); it does not reimplement it.

## 12. Open questions

1. **Multi-language / Shopify Markets.** Per-market copy in the manifest is mechanically easy
   and editorially expensive — who writes the German version, and what does the brand voice mean
   there? Probably waits for `brand.md` to have an answer.
2. **App-embed enablement.** Spec 28 OQ4, still open and now load-bearing: an offer that cannot
   render because a theme switch is off is the single most likely first-run failure, and no agent
   can flip it. Does Setup detect the embed state reliably, and what does the weekly ritual do
   when it is off — stay silent, or lead with it?
3. **Does the bar surface need its own approval semantics?** An announcement bar is persistent
   rather than triggered, so "one surface per session" and the frequency model read differently.
   Probably a different default, possibly a different card.
4. **Vendoring vs. dependency.** The email pack is *vendored* into `templates/agents/lib/email/`
   with a header naming `packages/skills/email-campaign` canonical — a mechanical copy, not an
   npm dependency. Offers should mirror it (D6), which means the three-copy problem in §1 becomes
   a *one-canonical-source, two-mechanical-vendors* problem. Better, but only if the vendoring is
   scripted and CI-checked. Today it is neither, for any pack. Worth fixing once, for all three.
5. **When does `STORE_REPO_MODE` flip for offers — and for the pooled runtime, at all?** Per
   §4.1's correction: the `STORE_REPO_MODE` seam is template-only today; `marketing-os-hosted-agents`
   has no git lane for *any* pack, email included. Porting it there is a prerequisite for offers'
   git-first ordering to mean anything beyond "which table" for a pooled tenant — and it is shared
   infrastructure, not something offers should build first on its own.
6. **`offer.activate`'s executor: `app` or `agents`?** OF2 declared the Action in the
   `executor: 'agents'` shape (dispatched to the tenant's own runtime, matching email) because
   that is the only shape that can reach a `StoreRepo` to satisfy §4.1's git-first write.
   `marketing-os-app`'s existing `offer.activate` is `executor: 'app'` — a direct Prisma mutation
   with no repo access, registered and live today. OF2 registered the pack's version as *reachable*
   (`register-actions.ts`, wired into `/api/actions/execute`) without touching `marketing-os-app`'s
   registration or rerouting `propose_offer` to use it — moving a proposal's approval routing for
   a live production Action is a coordinated, two-repo cutover and belongs with the OF2→production
   checkpoint (migration apply + backfill + Prisma drop), not inside a code-only PR. The
   `onDecline` semantics also do not carry over automatically: today a declined `app`-executor
   proposal auto-retires the staged surface (`decideAction`'s `onDecline` hook); `agents`-executor
   declines have no equivalent hook today. Generalizing decline-dispatch to `agents`-executor
   actions (or accepting that a declined-but-never-activated offer just sits PAUSED, which never
   renders either way) is part of this same decision.
