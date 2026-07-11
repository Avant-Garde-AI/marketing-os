# 22 — Brand Soul: the `brand.md` Specification & the Brand Section

> **Status:** DRAFT — format seeded. **BS0 in progress 2026-07-10:** Garrett provided the "Arthaus Brand Definition & Direction Guide v1.0" (April 2026, 16 sections); the reference instances are hand-authored at `packages/brand-md/examples/arthaus/` (`brand.md` + Google-conforming `DESIGN.md`). The canonical section list below is now **derived from that real document**, not invented.
> **Depends on:** 20-CAPABILITY-SUITE (brand.md is the context every capability reads), 21-BRAND-CONVERSION-AGENT (the scorecard grounds in it), design-loop PRD §1 Phase A (`brandDefinitionAgent` — already in the hosted runtime), 13-CONSOLE-DESIGN-RETROFIT (the Brand section lives in the console).
> **External anchor:** Google Labs' **DESIGN.md** specification (open-sourced 2026-04-21, Apache 2.0, `github.com/google-labs-code/design.md`). `brand.md` is its deliberate sibling: DESIGN.md tells agents how the brand *looks*; brand.md tells agents who the brand *is*.

---

## 0. The thesis

Every outward agentic activity — ad copy, creative briefs, offer surfaces, theme changes, Slack replies, BCD audits — is only as good as the brand understanding underneath it. Today that understanding is scattered: a few lines in agent instructions, a `docs/` folder convention, whatever the model infers from the storefront.

**The Brand Soul** is the fix: a deep, refined, *owner-approved* marketing strategy sitting at the core of the platform, consulted by every agent before it creates anything. It is not a settings page. It is the single most valuable artifact a store produces with Marketing OS — and it must be:

1. **Guided into existence agentically** — an interview-and-propose co-creation (the `brandDefinitionAgent` pattern: draft a grounded first pass, walk the owner through it section by section, they have final say), never a blank form.
2. **Machine-readable and portable** — an open format (`brand.md`) any agent stack can consume, the way DESIGN.md made visual identity portable.
3. **Versioned with provenance** — every claim in the document knows where it came from (owner-stated, agent-derived, data-derived) and when it last changed. Brands evolve; the soul must too, without losing its history.

## 1. What exists already (honest inventory)

- **`brandDefinitionAgent`** (marketing-os-hosted-agents, live in the Mastra instance): conversational brand definition on Claude Sonnet, drafts via `draft-brand-design`, walks the owner through essence / persona / value prop / visual identity / voice / design principles / category context / conversion priorities / guardrails, commits `brand-design.md` on approval. **This is the guided-agentic vision, partially built.** What it lacks: a formal output spec, versioning, provenance, a console surface, and injection into every other agent's context.
- **design-loop Design Work Contract** (shipped): TaskSpec/WorkReport — the implementer that *consumes* design guidance.
- **BCD audit** (spec 21, live): evaluates brand expression but has no canonical brand document to evaluate *against* — today it infers the brand from the storefront. With brand.md it audits *expression vs. intent*.
- **Arthaus redesign materials** (Garrett to provide): the reference queries, prompts, and result document structures developed during the Arthaus redesign — the empirical seed for what sections and depth the format needs.

## 2. The `brand.md` format (proposal)

Modeled directly on DESIGN.md's proven shape — **YAML front matter for machine-readable tokens, markdown prose for rationale** — plus the two things DESIGN.md (still `version: alpha`) doesn't have: **versioning and provenance as first-class citizens.**

```markdown
---
spec: brand.md/v0            # format version (the spec itself is versioned)
name: Arthaus
version: 3                   # document version, monotonic; full history in git + ledger
updated: 2026-07-10
provenance-legend: [owner, agent, data]   # who asserted each claim
essence:
  promise: "Museum-grade art, personally yours"   # @owner
  category: "art & wall decor"                    # @data (Shopify)
  archetype: "curator"                            # @agent, owner-approved v2
persona:
  primary: "the intentional collector"            # @agent (NeuroGraph PDO ref: pdo_...)
  neurograph_ref: "persona/arthaus/collector-v2"
positioning:
  against: "mass-market print shops"
  wedge: "gallery-wall curation as a service"
voice:
  tone: ["assured", "warm", "unhurried"]
  never: ["urgency clichés", "discount shouting"]
conversion:
  priorities: ["PDP education", "gallery-wall bundles", "first-order trust"]
  guardrails: ["no dark patterns", "WCAG AA floor"]
design_ref: ./DESIGN.md      # the sibling document — looks, not soul
---

## Essence
The prose: why this promise, the founding story, what the brand refuses to be…

## Persona
## Positioning & Category
## Voice & Language
## Trust Architecture
## Conversion Philosophy
## Guardrails (non-negotiable)
## Provenance & Change Log
```

### Canonical sections — v0, derived from the Arthaus guide (BS0)

The Arthaus Brand Definition & Direction Guide (16 sections, owner-approved) is the empirical seed. Its structure maps to brand.md v0 as follows — see `packages/brand-md/examples/arthaus/brand.md` for the worked instance:

1. **Essence & North Star** — the one line + the *customer sentence* the brand engineers for (the north star as a quote, not a metric — its signals decompose into measurable claims).
2. **Mission, Vision & Purpose**
3. **Positioning & Promise** — the FOR/IS/THAT/UNLIKE/BECAUSE statement as structured front matter; the promise as named pillars.
4. **Audience Architecture** — personas with **weighted decision hierarchies** (0–100). The Arthaus guide's biggest lesson: a persona's ranked, numeric decision drivers are the single most machine-usable brand asset — every creative/merchandising agent can sort its choices by them.
5. **Voice & Tone** — voice essence + pillars, each with ✔/✘ example pairs (the examples ARE the spec for a generative agent); a `never` list; a **tone-modulation-by-context table** (homepage / PDP / email / ads / error states / AI concierge).
6. **Messaging Framework** — message hierarchy + funnel-stage messaging with example lines.
7. **Experience Principles** — ordered UX principles.
8. **Product & Merchandising Principles** — incl. pricing architecture.
9. **Brand Architecture** — multi-surface ecosystem with per-surface voice registers.
10. **Content & Editorial Strategy** *(optional)*
11. **Channel Guidelines** *(optional — P-Max/Meta/Pinterest/Email specifics)*
12. **AI & Personalization Voice** — explicit voice rules for AI interactions ("never reference the technology", "recommend 2–3, not 20"). Front-mattered as `ai_voice_rules` for direct per-turn injection into our own agents.
13. **Governance: Do's & Don'ts** — bright-line ✔/✘ table.
14. **Competitive Differentiation**
15. **Measurement & Brand Health** — metrics mapped to the promise; front-mattered as `health_metrics`, the natural `@data` re-derivation hooks into the semantic layer.
16. **Provenance & Change Log**

Visual identity (the guide's §7: palette, type, photography art direction) extracts to the sibling **DESIGN.md** — the guide's hex values, type directions, and visual do's/don'ts translate cleanly into Google-spec tokens + prose (`packages/brand-md/examples/arthaus/DESIGN.md`).

**v2 lessons (guide v2.0, distilled 2026-07-10 — the versioning mechanism's first live exercise):** the reference instance is now at `version: 2` with a change-log entry recording a genuine *strategy revision* (Voice Pillar 2: "room-forward, not art-forward" → "room-forward discovery, art-forward detail"). Two v2 sections earn canonical-candidate status for the format: (a) **Experience Architecture** — how discovery/detail surfaces map to persona modes (Arthaus: the two-tier Collections/PDP model, with a preserve-SEO-equity guardrail); (b) **Copy Formula Templates** — the brand's highest-volume copy type specified as a formula + banned-words list + an *AI generation system-prompt template* (Arthaus: the three-part art-description formula). The formula template is the single most directly agent-consumable asset in the document — front-mattered so generation pipelines (NeuroGraph, concierge, PDP copy) enforce it mechanically.

Format rules, inherited from DESIGN.md's conformance philosophy: canonical section order; unknown sections preserved, never errored; duplicate headings rejected; a linter with error/warning/info severities (`missing-essence`, `unowned-claim` — a token with no provenance tag, `stale-data-claim` — a data-derived claim past its freshness window, `broken-persona-ref`).

**Provenance model (the open-source differentiator):** every front-matter claim carries an origin tag — `@owner` (stated by the human, highest authority), `@agent` (proposed by the definition agent, owner-approved), `@data` (derived from the store's own connected analytics/commerce, carries a freshness window and re-derivation query), `@research` (externally researched — competitive/market claims carrying a citation and research date, produced by the definition pipeline's deep-research stage; stale research is re-runnable from the preserved brief). The change log section records each version bump with who/what/why. This is what makes the document *trustworthy enough* to sit under every creative act.

**Open-sourcing:** the spec, linter, and a reference parser ship in this repo (`packages/brand-md/`), Apache 2.0, mirroring DESIGN.md's positioning — with an explicit compatibility note that `design_ref` points at a conforming DESIGN.md.

## 3. The Brand Soul Manifest — the target outcome set

The pipeline's deliverable is not one document but a **versioned manifest of four artifacts** — the complete, portable brand core every store converges to (Arthaus's worked instances in `packages/brand-md/examples/arthaus/` are the reference):

| # | Artifact | Role | Produced by |
|---|---|---|---|
| 1 | `research-brief.md` (+ research output) | The research contract + the `@research` evidence base | Stage 1–2 |
| 2 | `brand.md` | The soul — versioned, provenance-tagged strategy | Stage 3 |
| 3 | `design-exploration-prompts.md` (+ selected candidates) | The visual discovery record — prompt pack + owner-selected reference captures | Stage 4 |
| 4 | `DESIGN.md` | The body — Google-spec visual system, every claim traceable to a selection | Stage 4 |

Each artifact versions independently but cross-references; the manifest as a whole is what the Brand console section renders, what exports on eject, and what the context engine distills from.

### 3b. The deliverables pair: brand.md + DESIGN.md

The Brand section produces **two portable artifacts**:
- **`brand.md`** — the soul: strategy, persona, voice, positioning, conversion philosophy.
- **`DESIGN.md`** — the body: a *fully conforming Google-spec* DESIGN.md (colors, typography, spacing, components, do's/don'ts) so any coding agent — ours or a third party's — renders the brand consistently. The existing `brandDefinitionAgent`'s visual-identity section migrates here.

The two cross-reference (`design_ref` / front-matter `description` pointing back). The BCD scorecard's "Visual & design system" category audits the live site against DESIGN.md; the brand categories audit against brand.md.

## 4. The definition pipeline: compose → deep research → iterate

How the Arthaus guide was *actually* produced — and therefore how the product must work. A brand soul isn't interviewed into existence from a blank slate; the real process had three stages, each now a pipeline stage:

**Stage 1 — COMPOSE.** The agent drafts a *deep research brief* from the store's category, goals, and an initial owner interview. The brief is itself a governed artifact with a derived template (worked example: `packages/brand-md/examples/arthaus/research-brief.md`): Context & Objective (position hypothesis + persona sketch) → tiered competitive set (direct / adjacent / intent-adjacent) with five per-competitor dimensions (positioning & voice, target customer, product & merchandising, technology & discovery, acquisition & growth) → aesthetic-adjacent brand benchmarking (the brands shaping the persona's taste baseline, not just competitors) → one category-specific strategic deep-dive (Arthaus: gallery-wall bundling) → AI/discovery tech landscape → content-commerce models → paid acquisition landscape → supply-side dynamics → a **demanded output format** (landscape summary, competitor profiles, positioning map, whitespace analysis, risk assessment, tactical recommendations) that the distiller can parse. The owner reviews/edits the brief before dispatch — it's the research contract.

**Stage 2 — RESEARCH.** Dispatch the brief to a deep-research agent. **Decision: wrap, don't build.** The Gemini Deep Research API is generally accessible (public preview, paid tier): `deep-research-preview-04-2026` (speed) and `deep-research-max-preview-04-2026` (comprehensiveness) via the now-GA Interactions API, priced at Gemini 3.1 Pro token rates — and it supports **MCP servers**, meaning the researcher can consult the store's own MCP/semantic layer mid-run (competitive claims grounded against our own numbers). This also stays inside the spec-16 Gemini/GCP decision — same key, same billing. Our differentiation is not the research harness; it's the **composer** (the brief template) and the **distiller** (below). A self-built Mastra multi-agent research harness (the BCD-audit pattern scaled up: planner → parallel searchers → synthesizer) remains the documented fallback if the preview API's limits bite — but it's not the starting point.

**Stage 3 — ITERATE.** The distiller parses the research output into `@research`-tagged evidence (positioning map, whitespace, risks — each with citation + date), and the `brandDefinitionAgent` runs the strategy-iteration session Garrett described: research-grounded proposals walked through with the owner section by section, tension-surfacing where research contradicts the owner's hypothesis, converging on the owner-approved brand.md. The brief and the research output are both preserved as pipeline artifacts — re-running research from the same brief months later is how `@research` claims refresh.

**Stage 4 — VISUAL EXPLORATION.** DESIGN.md is not typed in — it is *discovered* through diverse generation and owner selection (how the Arthaus "vision PDP" aesthetic was actually found). Worked example: `packages/brand-md/examples/arthaus/design-exploration-prompts.md`. The process:

1. **Compose the prompt pack** — the agent derives it from the converged brand.md: a *Context Brief* (brand north star, aesthetic north star, aesthetic references — the taste-adjacent brands from stage-2 research, e.g. Kinfolk/Aesop/Schoolhouse; the **two registers**; implementation constraints — platform, wordmark, mobile-first, SEO-preservation guardrails) + **per-surface prompts** over a standard surface set (PDP, collection/browse, AI-concierge micro-app, configurator, homepage, profile/personalization, editorial article, email system, component library, ad templates). Each prompt = structure + aesthetic direction + **exploration notes, which are the diversity axes** — the enumerated dimensions to vary so the fan-out produces genuinely different candidates, not ten of the same idea.
2. **Fan out generation** — many diverse candidates per surface, routed by fidelity: image generation (Gemini image models) for moodboard-level explorations; **the design-loop** (shipped) for real rendered storefront mockups — the "vision PDP" equivalent, render→see→refine on actual theme code; **NeuroGraph** for the ad-creative templates (its native job).
3. **Select & synthesize** — the owner reacts to candidates in the same co-creative session (never a blank form, never a single take-it-or-leave-it comp); the agent extracts the selected direction into **DESIGN.md tokens + prose**, and the winning candidates are preserved as the canonical reference captures DESIGN.md's prose points at.

The prompt pack and selected candidates are pipeline artifacts with the same provenance discipline: every DESIGN.md claim traces to an owner selection over a generated exploration. Re-running a surface's prompt with updated brand.md context is how the visual identity evolves without starting over.

**The two registers (generalizable DESIGN.md concept, from the Arthaus pack):** one brand, two visual densities sharing palette/type/material — an *editorial register* (PDP, collections, content, email: contemplative pacing, "parked in front of a piece") and an *interactive register* (concierge, configurators, tools: same warmth, denser, "walking through the gallery with a guide"). Encoding both in DESIGN.md keeps agent-built tools (our GenUI surfaces, the Slack cards, console panels) from defaulting to tech-forward density that breaks the brand.

## 5. The Brand section (console)

A new **top-level "Brand" section, near the top of the nav** (above Reports/Markets):
- **Soul view** — brand.md rendered beautifully (editorial-at-edges, spec 13), each claim showing its provenance chip and version.
- **Define / Refine** — launches the guided agentic session (the `brandDefinitionAgent` flow, surfaced in console chat and Slack). Re-runnable: refinement sessions diff against the current version and propose bumps, never overwrite.
- **Design view** — DESIGN.md rendered with live token swatches; export/download both files (portability is the point).
- **History** — version timeline with per-claim change attribution.

## 6. The context engine

brand.md is not a document that sits in a tab — it is **injected context**:
- The hosted runtime loads the tenant's brand.md at request time and prepends a distilled brand context to every agent turn (same seam as the store-identity system message in `/api/chat` and the Store Analytics Context merge — this is the third leg: identity, metrics context, **brand soul**).
- Skills declare what they read (spec 20): creative skills get voice + persona + guardrails; BCD gets everything; the design-loop gets DESIGN.md + guardrails.
- `@data` claims re-derive on their freshness windows via the semantic layer — the soul stays current without human re-entry.

## 7. Build phases

> **Build status 2026-07-11: END-TO-END LIVE ON ARTHAUS.** BS1 ✅ · BS2 ✅ · BS2b ✅ (generation fan-out + Slack gallery + selection) · BS3 ✅ (console Brand section, top-of-nav) · BS4 ✅ · BS5 pending (OSS cut). The full pipeline has executed in production: research-brief.md (seeded) → **a real Gemini Deep Research run** (dispatched by the agent from Slack, completed, **auto-saved by the D4 cron** as research-output.md v1 — cited, on-brief) → brand.md v1 governing every chat turn (4.4KB distilled injection, both lanes) → **4 real visual candidates generated** (gemini-3.1-flash-image; PDP hero + homepage, one exploration axis each — visually on-brand: parchment, serif, framed-with-shadow) → gallery cards in #arthaus with Select buttons → selection recorded for DESIGN.md synthesis. Fixes en route: image API is jpeg-only; /api/brand-image + /api/cron exempted from the hosted 403 guard; /api/chat maxDuration 60→120 for generation turns. Manifest: 5 docs live for Arthaus.

- **BS0 — Format + seed — DONE 2026-07-10.** Ingested the Arthaus Brand Definition & Direction Guide v1.0; derived the v0 canonical sections + front-matter schema (§2 above); hand-authored `packages/brand-md/examples/arthaus/brand.md` + Google-conforming `DESIGN.md`. Note: the Arthaus source guide is CONFIDENTIAL and is NOT committed — the brand.md instance distills it; whether the Arthaus instance itself stays in the eventual OSS cut (vs. a fictionalized example brand) is an open question (#5).
- **BS1 — Linter + parser** in `packages/brand-md/` (OSS scaffold, versioning + provenance rules).
- **BS2 — Definition pipeline v2.** Point `brandDefinitionAgent` at the v0 format and give it the full §4 pipeline: brief composer (template from the Arthaus example), Gemini Deep Research dispatch (Interactions API, `deep-research-preview-04-2026`; `-max` for the initial definition run), research distiller (`@research` evidence), and the refine/diff/version-bump iteration session. Surface in console chat + Slack.
- **BS2b — Visual exploration harness.** The stage-4 loop: prompt-pack composer (Context Brief + per-surface prompts with diversity axes, derived from brand.md), generation fan-out routed by fidelity (image gen → moodboards; design-loop → rendered storefront mockups; NeuroGraph → ad templates), candidate gallery for owner selection in the co-creative session, and the DESIGN.md synthesizer (tokens + prose + canonical reference captures). Depends on the shipped design-loop; no new render infra.
- **BS3 — Brand console section** (Soul/Define/Design/History views, top-of-nav).
- **BS4 — Context engine.** Per-turn brand context injection in the hosted runtime; skill-level read declarations; `@data` freshness re-derivation.
- **BS5 — Open-source cut.** Spec doc + linter + examples published; provenance/versioning positioned as the extension DESIGN.md alpha lacks.

## 8. Decisions (Garrett, 2026-07-10)

- **D1 — Manifest storage: the platform-managed store repo + DB index.** The hosted platform already creates and manages a per-store GitHub repo on sync (spec 11), used until the customer ejects. The manifest artifacts (research-brief.md, brand.md, DESIGN.md, design-exploration-prompts.md + captures) live there as files — canonical, git-versioned, eject-ready by construction. A `mos_brand_documents` DB table indexes them (tenant, artifact kind, version, provenance metadata, distilled context) for fast console reads, context-engine loads, and provenance queries. Files are truth; DB is the index.
- **D2 — Candidate gallery: Slack-first quick pass, console for the deep session.** Stage-4 candidates post to Slack as branded image cards with selection buttons (the spec-17 approval-card pattern); the console Brand section hosts the full-gallery deep review.
- **D3 — Definition agent runs on Gemini**, aligning with spec 16 (chat surfaces → Gemini/GCP). The v1 agent's Claude Sonnet model is replaced; no spec-16 exception.
- **D4 — Deep research is an async job**: fire the Interactions-API run, poll from cron, post to Slack on completion (the scheduled-reports shape).
- **D5 — Per-turn distillation: front matter only** (~2–3KB — voice, ai_voice_rules, copy formulas, guardrails, tone table). Prose sections load on demand via a tool when an agent needs depth.

## 9. Open questions

1. ~~**Distillation**~~ — resolved by D5 (front matter only per-turn; prose on demand).
2. **Authority conflicts** — when `@data` contradicts `@owner` (e.g. the stated persona isn't who actually buys), the agent should *surface* the tension in a refine session, never silently rewrite. Encode as a linter rule or agent behavior?
3. **NeuroGraph coupling** — persona claims can reference PDO personas (`neurograph_ref`); how hard should the format depend on it vs. degrade gracefully?
4. **Multi-brand stores** — one brand.md per store for v0; sub-brands later? (The Arthaus guide's §10 Brand Architecture suggests the v0 answer: one brand.md, with per-surface voice registers inside it — Marketplace/Easel/Academy are registers of one voice, not separate brands.)
5. **OSS example privacy** — the Arthaus reference instance distills a confidential strategy document. Before the BS5 open-source cut, decide: keep Arthaus as the public reference (with owner sign-off) or fictionalize an example brand and keep Arthaus's instance tenant-private.
