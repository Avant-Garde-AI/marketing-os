# 14 — Storefront Surfaces & the Offer Agent

> **Status:** Draft for review · July 2026
> **Owner:** Marketing OS core
> **Depends on:** 11-HOSTED-PATH (platform app, App Proxy, pooled runtime), 13-CONSOLE-DESIGN-RETROFIT (approval widget, GenUI chat), design-loop (gates, capture, traces), 12-Store-MCP (semantic layer)
> **First target:** Arthaus (canary), then template default.

---

## 0. The thesis

Every Shopify store pays for some version of a pop-up tool — Privy, Wisepops, Justuno, OptinMonster, Klaviyo forms. The category is universally purchased and universally resented: template pop-ups, off-brand modals, fake-urgency mechanics, a tax on every storefront. It is also, structurally, the **lowest-hanging agent surface in commerce**: small, self-contained UI; a clear objective function (capture rate, incentive-attributed revenue); and a natural experiment container.

Marketing OS ships an **Offer Agent** as a default, out-of-the-box capability: an agent that *designs, deploys, tests, and retires* offers on the storefront — grounded in `brand-design.md`, gated by the design-loop's mechanical guardrails, approved by the merchant in the console, and measured end-to-end. The positioning is the anti-Privy: **offers as brand moments, not interruptions.** Our dark-pattern blocklist bans countdown timers and fake scarcity outright — this engine is *structurally incapable* of the sleaze the category runs on. That is the differentiator, not a constraint.

Beneath it, generalized: a **Storefront Surfaces framework** — the "simple, straightforward way we put apps into the storefront." Offers are the first surface. Announcement bars, quizzes, size guides, bundles, post-purchase moments are later surfaces on the same rails. One framework, many surfaces; build it once.

**Three strategic returns beyond the product itself:**
1. **The conversion anchor.** The design agent PRD's biggest open question (§10 Q1) was A/B wiring — "Shopify-native experimentation is weak." Offers are first-party experiments by construction: every offer ships as a test, and its realized lift becomes the ground-truth signal feeding measure-better traces and the skill-optimization loop. The offer engine *is* our experimentation substrate, arriving as a product instead of infrastructure.
2. **Design-loop live-fire.** The offer surface is a contained render target — one component, three viewports, finite states. It's the ideal first production run of the design-loop's capture → gates → conformance machinery against a real storefront, at 1% of the risk of full theme work.
3. **Two-plane economics, again.** The surface runtime + framework are OSS in the template (grow the network); offer strategy knowledge and optimization ride the hosted plane (capture the compounding). Same split as the design agent PRD §0.

---

## Part I — The Storefront Surfaces framework

### 1.1 Delivery: app embed + proxy-served manifest (no theme edits)

One **theme app extension (app embed)** on the platform Shopify app — the Shopify-native mechanism: merchant toggles it in the theme editor, no theme-code changes, survives theme updates, works on any theme, and it's the same install for hosted and ejected tiers.

The embed loads a single **surface runtime** script that:
1. Fetches the store's **surface manifest** through the existing App Proxy (subpath under the one proxy root: `/apps/<prefix>/surfaces` — one proxy per app, so surfaces ride the spec-12 proxy path, HMAC-verified at the edge router like everything else).
2. Renders active surfaces as **web components** (`<mos-offer>`, later `<mos-bar>`, …) into documented placement slots.
3. Emits **events** (impression, dismiss, engage, capture, code-copy) to a beacon endpoint on the same proxy.

Runtime contract — these are product requirements, not aspirations:
- **≤ 15 KB gzipped, zero dependencies, zero external requests** beyond the proxy (fonts inherit the theme's; styles are inlined from tokens).
- **Zero CLS** (surfaces never shift layout: overlay, corner, or reserved-slot only), `prefers-reduced-motion` honored, full keyboard/focus management, WCAG AA.
- **Fails invisible.** Any error → no surface, never a broken one. The storefront is sacred.
- Server-driven: the runtime is dumb. All decisions (which offer, which variant, which audience) are made server-side; config changes deploy **without any code deploy**.

### 1.2 The surface manifest (the contract)

```jsonc
{
  "version": "1",
  "surfaces": [{
    "id": "ofr_2091",
    "type": "offer",                       // the surface vocabulary
    "placement": "corner-card",            // corner-card | overlay | inline-slot | top-bar
    "trigger": { "kind": "delay", "seconds": 12,     // delay | scroll-depth | second-pageview | cart-add
                 "suppressAfterDismissDays": 14, "maxPerSession": 1 },
    "audience": { "newVisitorsOnly": true, "excludeSubscribed": true,
                  "pages": ["collection", "product"] },
    "experiment": { "id": "exp_88", "arms": ["control", "v1", "v2"],
                    "assignment": "hash" },          // deterministic hash(visitorId, expId); control = no surface
    "variants": { "v1": { "content": { /* copy, incentive, imagery ref */ },
                          "style": { /* brand-token values, baked server-side */ } },
                  "v2": { … } },
    "consent": { "capturesEmail": true, "marketingConsentText": "…" }
  }]
}
```

Frequency capping, dismissal memory (localStorage + suppression rules), and experiment assignment are **framework** concerns — every future surface inherits them. Events carry `{surfaceId, experimentId, arm, event, visitorId, page}`; capture events post the email to the proxy, which writes a **Shopify customer with explicit marketing consent** (native consent API — compliance is Shopify's rails, not ours).

### 1.3 Where state lives

Hosted-first: surface manifests, experiment state, and event aggregates live in the **platform DB** (tenant-scoped, alongside spec-12's tenant registry; H2's schema-per-tenant when it lands). The proxy endpoint resolves shop → tenant → manifest exactly as the MCP path does today. On **eject** (H5), the surfaces API is part of the agents deployment and state rides the tenant's own Postgres — same one-tree invariant as everything else.

### 1.4 Email destination

We replace the **capture + display** layer, not the ESP. Captured emails land as Shopify customers with consent; Klaviyo/Shopify Email/whatever syncs downstream natively. No sending infrastructure in scope, v1 or otherwise.

---

## Part II — The Offer Agent

### 2.1 What "offer" means here (wider than a discount)

The agent selects the **incentive type from the persona**, not from a template gallery. From `brand-design.md` §2/§6 (or the NeuroGraph PDO when connected): what DRIVES this buyer, what INHIBITS them.

| Persona signal | Offer the agent reaches for |
|---|---|
| Price-sensitivity drives | % / $ off first order (the classic — sometimes right) |
| Threshold anxiety ("is shipping free?") | free-shipping threshold offer |
| Provenance/craft drives (Arthaus) | early access to drops · the maker's story + first-print gift · collector's guide (content capture) |
| Trust inhibits | guarantee/returns-forward offer, no discount at all |
| Community drives | private-list access, "the Agent" digest signup |

A discount is one arm of a hypothesis, never the default. This is what "AI-oriented offer engine" means in practice — offer *strategy* selection, then design.

### 2.2 The loop (all existing machinery, composed)

```
brief (agent-initiated or merchant ask in chat)
  → generate 2–3 offer hypotheses  (persona × incentive × placement × copy, in brand voice)
  → render variants on the real storefront (preview)     ── design-loop capture
  → MECHANICAL GATES: dark-pattern blocklist · WCAG AA · token fidelity · CLS
  → ProposalCard in console chat: preview + hypothesis + gates readout
  → merchant approves            ── the approval widget, verbatim from spec 13
  → manifest deploys as an EXPERIMENT (control arm always present)
  → events → capture rate, incentive-attributed revenue (code redemption / email→order match)
  → agent reviews at significance (or bandit-shifts traffic), proposes: promote / iterate / retire
  → outcome trace (§6 measure-better): offer skill provenance × arm × realized lift
```

Notes that matter:
- **Every offer is an experiment.** There is no "just publish" path; control is always an arm. v1 = fixed-split A/B/n with a simple sequential test; bandit allocation is a v2 flag on the same assignment seam.
- **The gates are the brand promise.** Same deterministic blocklist as the design agent: no countdown timers, no fabricated stock, no confirmshame dismiss links ("No thanks, I hate saving money" is a firing offense), plus surface-specific rules: one surface per session, dismiss is one tap and remembered, overlay never before first scroll/12s.
- **Approval is the same widget** that shipped this week — offers arrive in chat as ProposalCards with the gates readout; Approve updates the manifest (no GitHub round-trip needed for surfaces — this is config, not theme code; the audit trail is the offer record + trace).
- **Reporting is the same GenUI charts** — `chart_offer_performance` joins the existing chart-tool family; the weekly digest playbook grows an offers section.

### 2.3 Skills (the execution vocabulary, Vol. 04–06)

`design-offer` (hypothesis → variants, brand-grounded) · `offer-experiment-review` (read results, propose promote/iterate/retire; scheduled like the weekly digest) · `offer-portfolio-audit` (what's live, fatigued, or missing across the funnel). These enter the skill library like every other skill — versioned, pinned, optimized by network traces. Offer outcomes are the *first skill-optimization signal with real conversion ground truth.*

### 2.4 Console

No new top-level section in v1: offers live in **Chat** (creation + approval), **Overview → Needs your review** (pending proposals), **Activity** ("Offer 'Collector's list' — In practice · capturing 3.1%"), and **Playbooks** (the three skills). A dedicated Offers view is earned later by usage, not shipped on spec.

---

## 3. Build phases (Arthaus first, template second)

| Phase | Deliverable | Size | Validates |
|---|---|---|---|
| **O0** | Surface runtime (web component, one type: `offer` corner-card + overlay) + manifest endpoint on the proxy + theme app extension; hand-authored manifest live on Arthaus | M | The framework rails, CLS/a11y/fail-invisible contract |
| **O1** | Events beacon + capture→Shopify-customer(consent) + attribution (code + email→order) + `chart_offer_performance` | M | The measurement spine |
| **O2** | Offer Agent skills (`design-offer`) + ProposalCard flow in chat → manifest deploy on approve | M | Agent-designed offers end-to-end |
| **O3** | Experiments: assignment, control arm, sequential significance, `offer-experiment-review` scheduled skill | M | **The conversion anchor** |
| **O4** | Design-loop integration: storefront capture of rendered variants → gates + conformance in the proposal readout; outcome traces emitted | S | **Design-loop live-fire + measure-better with real lift** |
| **O5** | Template/OSS packaging: framework + runtime into `templates/agents` + platform app extension; docs; Playbooks Vol. 04–06 | S | The default-on product |

O0–O2 is a demoable "agent designed this offer, I approved it, it's live on Arthaus." O3–O4 is where it becomes the flywheel.

**Open decisions (need Garrett):** D1 — v1 incentive scope (recommend: email-capture offers only — discount code, threshold, content/early-access; cart/checkout offers later). D2 — bandit in v1 or v2 (recommend v2; fixed-split A/B/n first, the seam is built in). D3 — does offer approval also file a git record for audit (recommend no; config + trace is the audit trail, git is for theme code).
