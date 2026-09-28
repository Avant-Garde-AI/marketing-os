# 34 — The Offer Design Harness: beat the popup they already have

> **Status:** Decided 2026-09-28 (H1–H4, §9). Build not started; OH0 + OH2 first.
> **Extends:** 32-OFFER-AGENT (pack, manifest, runtime, gate, the $15 wedge). Nothing in 32 is
> reversed; §5 of 32 (parity) and §8 (standing loop) are re-sequenced around this spec's harness.
> **Reuses:** 33-THE-STORYBOARD-HARNESS (concept → critique → bounded repair), `@avant-garde/design-loop`
> (Playwright capture, VLM critic, `checkDarkPatterns`, the refine loop), 20-CAPABILITY-SUITE (one gate),
> 22-BRAND-SOUL + 30-DESIGN-LIBRARY (brand tokens and components are store-owned).
> **Input:** the premium-popup research brief (2026-09-28) — its taxonomy is adopted where it holds,
> and §7 lists where it is refused and why.

---

## 0. The job, stated as the merchant experiences it

A free-tier merchant installs Marketing OS. Within the first session, without paying:

1. The agent finds the welcome popup they already run (Klaviyo form, Privy, Alia, Justuno, OptiMonk,
   Wisepops, or none), screenshots it on desktop and mobile, and grades it — plainly, with evidence.
2. It designs a **challenger** from their brand, and shows it to them **on their own storefront**
   through the signed preview link (already live, spec 32 OF3).
3. The card says one thing: *"Run this against your current popup. $15/month. Keep whichever wins."*

The upgrade is not argued on a pricing page. It is a preview of their own store, looking better,
with a fair fight attached. That is the no-brainer this spec exists to build.

Everything else here — the block catalog, the critics, the bandit — is in service of making step 2
reliably excellent and step 3 honest.

---

## 1. Where we already are (and the research's frame agrees)

Before listing gaps: much of what the research calls "next generation" is shipped architecture.

| Research claim | Status in Marketing OS |
|---|---|
| Declarative GenUI: agent emits schema, frontend renders a fixed component catalog; never raw HTML | **Shipped.** `OfferManifest` is compiled JSON, validated twice (pack + `api.offers.surfaces`), rendered by `surface-runtime.js`. The agent cannot emit HTML. |
| Shadow DOM encapsulation against theme CSS | **Shipped.** `:host{all:initial}`, runtime 0.5.0, ~11 KB gz. |
| Continuous optimisation, traffic reallocation | **Shipped (non-contextual).** Beta posteriors, Thompson reallocation, held-out control on every offer — which most of the category lacks. |
| Sticky teaser, exit intent, full-screen takeover, targeting, schedule | **Shipped** (OF3). |
| Brand-true visual design | **Shipped for one offer** (the Arthaus welcome takeover), by hand-directed agent work — **not yet a repeatable harness.** That is the gap. |

The real gaps are four, and they are the spec:

1. **No design harness.** Offers are authored in one pass by a tool call. Nothing renders them,
   looks at them, compares them, or repairs them before a merchant sees a card. (§3)
2. **No incumbent awareness.** We cannot see, grade, or fairly test against the popup the merchant
   already pays for — which is the only comparison that sells the upgrade. (§4)
3. **One step, one format.** No multi-step zero-party flow, no progress, no reward state; the block
   vocabulary is a fixed layout per placement. (§2 — this is spec 32 OF4, re-scoped.)
4. **The reward is shallow.** We optimise capture rate. The merchant cares about revenue net of
   discount. (§5)

---

## 2. The block catalog — manifest v2 **⟨BUILD⟩**

The research recommends declarative GenUI over open-ended generation; we agree and already are.
What changes is granularity: from *content fields on a fixed layout* to *a composition of primitives
across steps*, still validated, still rendered only by our runtime.

### 2.1 Shape

```ts
interface OfferManifestV2 {
  version: "2";
  id: string; type: "offer"; title: string;
  placement: "corner-card" | "overlay" | "takeover" | "bar";
  composition: CompositionId;          // layout skeleton, §2.3
  steps: Step[];                       // 1–3; the flow
  trigger: Trigger; audience: Audience; schedule?: Window; teaser?: boolean;
  experiment: Experiment;              // arms reference step/copy variants, §5
  consent: Consent; style: StyleTokens; // tokens compile from DESIGN.md, never free CSS
}
interface Step { id: string; kind: "hook" | "ask" | "reward"; blocks: Block[] }
```

### 2.2 Primitives (closed set — adding one is a runtime release, not an agent decision)

| Block | Notes |
|---|---|
| `eyebrow`, `headline` (with accent span), `body`, `points` | Copy. Dark-pattern gate runs over all of it. |
| `image` | Shopify CDN only (existing `safeImage`); `focus`, `caption`; mobile may drop it (§2.4). |
| `choice` | Binary or 2–4 options; the zero-party question. `answerKey` maps to profile property (§2.5). |
| `email` | The one PII field (SMS out, spec 32 D7). Posts to the hosted capture endpoint (D8). |
| `consent` | Required on any step containing `email`; plain-language, never pre-checked. |
| `progress` | "Step 1 of 2" / bar. Required when `steps.length > 1`. |
| `reward` | Code reveal (auto-applied via Shopify discount URL), or product picks keyed off `choice` answers. |
| `decline` | A neutral text link. Copy is gated (§7). |

### 2.3 Compositions

Named skeletons the renderer owns, e.g. `split-image`, `full-bleed-image`, `editorial-type`,
`card`, `bar-inline`. The agent picks one and fills slots; it never positions elements. This is
where "premium" lives — each composition is hand-built, responsive, and brand-tokenised once, and
reused by every store. **Adding compositions is the main lever for visual range**, and it is
engineering work, not generation.

### 2.4 Mechanical guarantees the compiler enforces (not the model)

- Touch targets ≥ 44×44 CSS px; mobile overlay ≤ 85% viewport width unless `takeover`.
- **Mobile takeovers become two-step by default** for visitors arriving from search: the runtime
  shows the teaser, and the takeover opens on tap or on exit intent. The merchant can override,
  and the card says what they are overriding. (Google treats intrusive interstitials on arrival
  from search as a page-experience negative; exit intent and user-initiated expansion are not
  that case.)
- Contrast AA for text on its actual background, computed on the rendered capture (§3.3), not
  on tokens.
- Zero CLS: overlays never shift layout; `bar` is server-rendered by the app-embed Liquid so it
  paints with the page instead of after it — the one surface where the research's
  light-DOM-first point applies. Triggered overlays load after idle and cannot affect LCP.

### 2.5 Zero-party answers go somewhere real

`choice.answerKey` → capture payload → Shopify customer metafield + Klaviyo profile property
(reusing the email pack's connection), and a `mos_offer_answers` rollup the email agent can read to
segment the welcome flow. This is spec 32 OF4, unchanged in intent; the answers are also the
context for §5.3.

---

## 3. The harness — concept, render, critique, repair **⟨BUILD⟩**

Same shape as the storyboard harness (spec 33 §1.1) and design-loop's refine loop
(`propose → implement → render → capture → conform → refine`), specialised to offers.

### 3.1 Brief

Inputs, all reads: `brand.md` (personas, voice, claims), `DESIGN.md` tokens + design library,
catalog + collections, current offer results, the incumbent audit (§4.1), and the merchant's goal
in plain language ("grow the list without discounting", "clear winter stock, protect 40% margin").

### 3.2 Concepts — diverse by structure, not by adjective

The agent proposes **N = 4–6 concepts**, each tagged with a structural archetype, and the harness
rejects a set that is not diverse on that axis (spec 33 §8 diversity policy):

| Archetype | Hook | Fits |
|---|---|---|
| `quiet-editorial` | Single step, image + claim, no incentive | Premium brands, high AOV |
| `zero-party-quiz` | Choice → email → personalised reward | Broad catalogs (Arthaus rooms, Pupford dog life-stage) |
| `learn-and-earn` | One factual choice about the product → reward | Education-heavy catalogs |
| `early-access` | Membership, drops, first look | Limited editions, launches |
| `threshold` | Free shipping / gift over X | Margin-protective incentive |
| `story` | Founder / mission, one line + email | New brands |

### 3.3 Render

Each concept compiles to a v2 manifest and is **rendered on the merchant's real storefront** via
the signed preview token, captured by design-loop's Playwright adapter at 390×844 and 1440×900,
per step. Captures are the evidence; nothing is judged from JSON.

### 3.4 Critics

| Critic | Kind | Fails on |
|---|---|---|
| Conformance | mechanical | §2.4 violations, broken image, overflow, focus trap, runtime error |
| Dark-pattern | mechanical | `checkDarkPatterns` (spec 32; permanent) |
| Brand | VLM on captures vs `brand.md` + `DESIGN.md` | off-palette, off-voice, generic stock feel |
| Persona | LLM with persona context | incentive or question irrelevant to the primary persona |
| Incumbent | VLM, pairwise vs incumbent captures | not clearly better on the rubric it was graded on (§4.1) |
| Novelty | embedding vs this store's past offers | a re-skin of something already tested |

### 3.5 Bounded repair and selection

Patch-only repair (spec 33 §8): a failing critic produces a targeted edit, re-render, re-score;
max 3 iterations per concept; failures are dropped, not shipped. The top 2 by critic score become
**arms**, and the card shows their captures side by side with the incumbent's, plus the preview
link. Approval still goes through the gate — no autonomous creative (spec 32 §11).

### 3.6 Where it runs

The render step needs a browser. design-loop's capture adapter already runs Playwright; the hosted
job orchestrator in `marketing-os-app` runs it as an async job (spec 20 async skills), results to
`mos_offer_artifacts` / the store repo per spec 32 D6. **OQ1:** confirm the worker host
(Vercel Sandbox vs the existing design-loop runner) before OH2.

---

## 4. The incumbent — audit, then a fair fight **⟨BUILD⟩**

### 4.1 Audit (free tier, read-only)

- **Fingerprint** the storefront for known vendors: script hosts and DOM markers for Klaviyo forms,
  Privy, Alia, Justuno, OptiMonk, Wisepops, Sleeknote, Omnisend, Shopify Forms.
- **Capture** the incumbent as a visitor sees it (desktop + mobile, first visit, fresh profile).
- **Grade** on a published rubric: time-to-show, arrival-from-search interstitial risk, touch
  targets, contrast, consent microcopy, image presence, step count, incentive type, dark patterns
  present, runtime weight added. Each line cites the capture.
- Output: an **Offer report card** artifact, readable in the console and in Slack.

This is useful on its own, it costs us one headless visit, and it makes the challenger's case
with evidence rather than adjectives.

### 4.2 Head-to-head (Starter)

A new arm kind: `{ key: "incumbent", vendor }`. For visitors assigned to it, the runtime renders
nothing and **observes**: it listens (capture phase, passive) for the vendor form's submit and
emits `impression`/`capture` for the incumbent arm. For visitors assigned to challenger arms, the
runtime **suppresses** the incumbent (vendor-specific hide/close hooks where they exist, a scoped
CSS hide otherwise). Control still exists: the no-offer arm.

Result: three-way, same traffic, same counters, same posteriors — *your current popup vs ours vs
nothing*. When the challenger wins, the card's move is "turn off {vendor}"; when it loses, we say
so, and the loss is a training signal for the next concept.

**Spike first (OH3a):** suppression and observation are per-vendor and brittle by nature. Ship
Klaviyo forms first (most common on our stores, and we already hold a Klaviyo connection to
cross-check captures against list growth), then add vendors one at a time. A vendor we cannot
cleanly observe is not offered a head-to-head — we fall back to a sequential test and say so.

---

## 5. What we optimise **⟨BUILD⟩**

### 5.1 Reward

Capture rate stays the fast signal. Add, per arm, from captures joined to Shopify orders
(`offerAttributionClient`): **first-order rate within 30 days, revenue, discount cost → net
revenue per visitor**. The bandit's objective becomes a merchant choice (H4).

### 5.2 Incentive ladder with a margin floor

Incentives are arms, not a constant: none / content / early access / free shipping threshold /
5–10–15%. The merchant states a floor ("never below 40% margin"); the compiler refuses arms that
would breach it given catalog cost data. Unique single-use codes are a Shopify discount **write**
— an Action through the gate, created once per approved arm, never by a tool.

### 5.3 Context, hierarchically — and honestly sized

Contextual Thompson sampling over coarse, non-sensitive cells: `device × new/returning ×
source class (search/social/email/direct)` plus zero-party answers once given. Child cells borrow
strength from parents (empirical-Bayes shrinkage of Beta priors) so a new cell starts at its
parent's belief, not at zero.

**Stated plainly:** at Arthaus's current volume (~4k offer impressions per variant per month, and
single-digit monthly captures on the old corner card) per-context learning will be data-starved
for months. For stores this size the win is design and format (§3) and a real incumbent test
(§4), not the algorithm. Deep RL/DDPG, as surveyed in the research, is out of scope for this
decade of our traffic. Cross-store priors (hosted, private per spec 32 D3) are the eventual
answer to cold start, and the reason the learning stays hosted.

### 5.4 Triggers as arms

Instead of a claimed ML trigger model we do not have data to train: trigger *policies*
(delay 8s, scroll 50% + 15s dwell, 2nd product view, exit intent) become an experiment dimension
under the same posteriors. Learned triggers wait for cross-store data.

---

## 6. Free → Starter, concretely

| | Free | Starter ($15) |
|---|---|---|
| Incumbent audit + report card | ✅ | ✅ |
| Challenger designed by the harness, preview on your store | ✅ (1 concept set / month) | ✅ unlimited |
| Go live | — | ✅ |
| Head-to-head vs your current popup | — | ✅ |
| Multi-step zero-party flows + Klaviyo sync | — | ✅ |
| Continuous redesign + weekly offer card (spec 32 OF5) | — | ✅ |

Today `offers` is gated `starter` end to end; this needs a free-tier `offers.audit` entitlement
(read-only tools + preview), wired through `requireFeature`.

---

## 7. What we take from the research, and what we refuse

Adopted: progressive commitment (hook → ask → reward), progress indicators, zero-party capture
with ESP sync, product imagery in lightboxes, privacy microcopy under the email field, sticky
teaser, exit intent, mobile two-step expansion, 44 px targets, declarative GenUI, shadow DOM,
contextual bandits with hierarchical priors.

Refused — mechanically, via `checkDarkPatterns`, per spec 32 §5 and D1:

- **Confirmshaming declines** ("No thanks, I'll pay full price"). The research recommends it; the
  FTC and EU DSA name it as a dark pattern. The decline is a neutral link.
- **Delayed close button.** Forcing a visitor to read before they may leave is the same pattern
  in time instead of text.
- **Fabricated scarcity / countdowns** ("Only 2 left!") — unless bound to live inventory, and even
  then not in a capture offer.
- **Spin-to-win and chance mechanics.** Permanently out.
- **Individually inferred price-sensitivity discounting.** Varying the incentive by coarse,
  disclosed context is fine; profiling a person's willingness to pay is personalised pricing, a
  live regulatory target, and not what a brand-safe tool does (H3).

Treat the research's headline numbers (57.7% top-decile conversion, the 43% imagery lift,
"40% more subscribers") as vendor-reported and unverified: fine as motivation, not for our
pricing page or marketing copy.

---

## 8. Phases

| Phase | Deliverable | Size | Exit |
|---|---|---|---|
| **OH0** | **Incumbent audit.** Vendor fingerprint, desktop/mobile capture, rubric, report card artifact; free-tier `offers.audit` entitlement. | M | Any install gets an honest grade of its current popup in the first session |
| **OH1** | **Manifest v2 + block catalog.** Steps, primitives, 4 compositions, compiler guarantees (§2.4), v1 manifests still render. Absorbs spec 32 OF4's runtime half. | L | A 3-step zero-party takeover renders on Arthaus at both breakpoints |
| **OH2** | **The harness.** Brief → diverse concepts → render via preview → six critics → bounded repair → top-2 arms → card with captures. | L | A free-tier store receives a challenger preview it did not ask for twice |
| **OH3** | **Head-to-head.** (a) Klaviyo-forms suppress/observe spike; (b) `incumbent` arm kind in runtime + posteriors + card copy; more vendors behind it. | M | A three-way test runs on one store with reconciled capture counts |
| **OH4** | **Zero-party → Klaviyo + answers rollup** (spec 32 OF4 data half), captures tab. | M | A quiz answer appears on the Klaviyo profile and segments the welcome flow |
| **OH5** | **Reward + incentives.** Order join, net revenue per visitor, margin floor, unique codes via gated Action. | M | The card reports revenue per visitor with discount cost netted out |
| **OH6** | **Contextual hierarchical bandit + trigger arms.** | M | Cells shrink to parents; trigger policy is a tested dimension |

OH0 + OH2 is the upgrade wedge and should ship first even with v1 manifests if OH1 slips:
a graded incumbent and a beautiful challenger on their own store is the whole pitch.

---

## 9. Decisions (Garrett, 2026-09-28)

- **H1 — Free tier gets the audit and a previewable challenger, not a live offer.** One concept
  set per month on free; going live is Starter. *(Audit-only free tier considered, rejected: the
  challenger on their own store is the pitch.)*
- **H2 — Head-to-head suppresses the merchant's other popup for challenger-arm visitors.** It
  touches another vendor's widget on the merchant's own store, with their approval, per arm.
  Klaviyo forms first, one vendor at a time; a vendor we cannot cleanly observe falls back to a
  sequential test and the card says so. *(Sequential-only considered, rejected as too weak.)*
- **H3 — Personalisation boundary:** incentive may vary by coarse disclosed context and by
  zero-party answers; never by inferred individual price sensitivity. *(Adopted as proposed.)*
- **H4 — Bandit objective: capture rate reallocates, net revenue decides.** Capture rate moves
  traffic day to day; net revenue per visitor (30-day lag, discount cost netted) declares winners
  and seeds the next concept set.

## 10. Open questions

1. **Render worker host** (§3.6) — Vercel Sandbox or the design-loop runner.
2. **Composition authorship** — who designs the four launch compositions; they are the ceiling on
   visual quality and deserve a designer's pass, not only the agent's.
3. **Vendor terms** — does suppressing a third-party widget on the merchant's store conflict with
   any vendor's ToS the merchant accepted? Check Klaviyo first.
4. **A2UI interop** — our manifest is already declarative; emitting A2UI as an export format is
   cheap if a partner surface wants it, and not worth adopting as the internal schema.
