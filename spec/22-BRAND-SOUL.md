# 22 — Brand Soul: the `brand.md` Specification & the Brand Section

> **Status:** DRAFT — vision + format proposal. Awaiting Garrett's Arthaus-redesign reference materials (queries, prompts, result document structures) to seed the canonical sections.
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

Format rules, inherited from DESIGN.md's conformance philosophy: canonical section order; unknown sections preserved, never errored; duplicate headings rejected; a linter with error/warning/info severities (`missing-essence`, `unowned-claim` — a token with no provenance tag, `stale-data-claim` — a data-derived claim past its freshness window, `broken-persona-ref`).

**Provenance model (the open-source differentiator):** every front-matter claim carries an origin tag — `@owner` (stated by the human, highest authority), `@agent` (proposed by the definition agent, owner-approved), `@data` (derived from connected analytics/commerce, carries a freshness window and re-derivation query). The change log section records each version bump with who/what/why. This is what makes the document *trustworthy enough* to sit under every creative act.

**Open-sourcing:** the spec, linter, and a reference parser ship in this repo (`packages/brand-md/`), Apache 2.0, mirroring DESIGN.md's positioning — with an explicit compatibility note that `design_ref` points at a conforming DESIGN.md.

## 3. The deliverables pair: brand.md + DESIGN.md

The Brand section produces **two portable artifacts**:
- **`brand.md`** — the soul: strategy, persona, voice, positioning, conversion philosophy.
- **`DESIGN.md`** — the body: a *fully conforming Google-spec* DESIGN.md (colors, typography, spacing, components, do's/don'ts) so any coding agent — ours or a third party's — renders the brand consistently. The existing `brandDefinitionAgent`'s visual-identity section migrates here.

The two cross-reference (`design_ref` / front-matter `description` pointing back). The BCD scorecard's "Visual & design system" category audits the live site against DESIGN.md; the brand categories audit against brand.md.

## 4. The Brand section (console)

A new **top-level "Brand" section, near the top of the nav** (above Reports/Markets):
- **Soul view** — brand.md rendered beautifully (editorial-at-edges, spec 13), each claim showing its provenance chip and version.
- **Define / Refine** — launches the guided agentic session (the `brandDefinitionAgent` flow, surfaced in console chat and Slack). Re-runnable: refinement sessions diff against the current version and propose bumps, never overwrite.
- **Design view** — DESIGN.md rendered with live token swatches; export/download both files (portability is the point).
- **History** — version timeline with per-claim change attribution.

## 5. The context engine

brand.md is not a document that sits in a tab — it is **injected context**:
- The hosted runtime loads the tenant's brand.md at request time and prepends a distilled brand context to every agent turn (same seam as the store-identity system message in `/api/chat` and the Store Analytics Context merge — this is the third leg: identity, metrics context, **brand soul**).
- Skills declare what they read (spec 20): creative skills get voice + persona + guardrails; BCD gets everything; the design-loop gets DESIGN.md + guardrails.
- `@data` claims re-derive on their freshness windows via the semantic layer — the soul stays current without human re-entry.

## 6. Build phases

- **BS0 — Format + seed.** Ingest Garrett's Arthaus reference materials; finalize brand.md v0 sections + front-matter schema; hand-author Arthaus's brand.md + DESIGN.md as the reference instances. (No code beyond a schema.)
- **BS1 — Linter + parser** in `packages/brand-md/` (OSS scaffold, versioning + provenance rules).
- **BS2 — Definition agent v2.** Point `brandDefinitionAgent` at the v0 format; add refine/diff/version-bump; surface in console chat + Slack.
- **BS3 — Brand console section** (Soul/Define/Design/History views, top-of-nav).
- **BS4 — Context engine.** Per-turn brand context injection in the hosted runtime; skill-level read declarations; `@data` freshness re-derivation.
- **BS5 — Open-source cut.** Spec doc + linter + examples published; provenance/versioning positioned as the extension DESIGN.md alpha lacks.

## 7. Open questions

1. **Distillation** — the full brand.md may be large; what's the per-turn distilled form (front matter only? per-skill sections?) and who maintains the distillation?
2. **Authority conflicts** — when `@data` contradicts `@owner` (e.g. the stated persona isn't who actually buys), the agent should *surface* the tension in a refine session, never silently rewrite. Encode as a linter rule or agent behavior?
3. **NeuroGraph coupling** — persona claims can reference PDO personas (`neurograph_ref`); how hard should the format depend on it vs. degrade gracefully?
4. **Multi-brand stores** — one brand.md per store for v0; sub-brands later?
