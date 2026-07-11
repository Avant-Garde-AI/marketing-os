# brand.md

**An open format for describing a brand's soul to agents.**

[Google's DESIGN.md](https://github.com/google-labs-code/design.md) gives coding agents a persistent, structured understanding of a *visual identity* — how a brand **looks**. `brand.md` is its deliberate sibling: a persistent, structured understanding of who a brand **is** — strategy, personas, voice, positioning, conversion philosophy, guardrails — in a format both humans and agents read natively.

A brand.md file is YAML front matter (the machine-readable brand core) plus markdown prose (the full depth and rationale):

```markdown
---
spec: brand.md/v0
name: Arthaus
version: 2
essence:
  line: "Art that lives where you do."        # @owner
personas:
  primary:
    name: "The Modern Nest Curator"           # @owner
    decision_hierarchy:                       # 0–100 weights — sortable by any agent
      room_first_visual_fit: 98
      curated_sets_discovery: 92
voice:
  pillars: [curatorial-confidence-not-gatekeeping, ...]
  never: ["vague superlatives (stunning, breathtaking)", ...]
ai_voice_rules:
  - "Never reference the technology"
  - "Recommend 2–3 options, never 20"
guardrails: ["no dark patterns", "WCAG AA floor"]
design_ref: ./DESIGN.md
---

## Essence & North Star
…prose sections carry the full depth: voice pillars specified as ✔/✘
example pairs, messaging frameworks, experience architecture…
```

## What brand.md adds over DESIGN.md's model

1. **Versioning** — the document version is monotonic; every bump appends to a `Provenance & Change Log` section recording what changed and why. Brands evolve; the soul keeps its history.
2. **Per-claim provenance** — every front-matter claim carries an origin tag as a YAML comment:
   - `@owner` — stated by the human; highest authority
   - `@agent` — proposed by a definition agent, owner-approved
   - `@data` — derived from the brand's own analytics; carries a freshness window and a re-derivation query
   - `@research` — externally researched (competitive/market claims); carries a citation and research date

   Provenance is what makes the document trustworthy enough to sit underneath every automated creative act.

## Library

```ts
import { parseBrandMd, distillBrandContext, lintBrandMd } from "@avant-garde/brand-md";

const doc = parseBrandMd(raw);          // front matter + sections (provenance-preserving)
const ctx = distillBrandContext(doc);   // the compact per-turn subset for agent instructions (~3KB)
const findings = lintBrandMd(doc);      // missing-essence, unowned-claim, duplicate-heading, …
```

The distilled context is designed to be injected into an agent's system prompt on every turn — voice, AI interaction rules, copy formulas, guardrails, and the primary persona's weighted decision hierarchy — with the full prose loadable on demand.

## The worked example

[`examples/arthaus/`](./examples/arthaus/) contains a complete Brand Soul manifest produced by the definition pipeline (compose research brief → deep research → owner-iterated strategy → generative visual exploration):

| File | Role |
|---|---|
| `research-brief.md` | The competitive deep-research contract |
| `brand.md` | The soul (v2 — includes a real version bump with change log) |
| `design-exploration-prompts.md` | The visual-discovery prompt pack (per-surface prompts + diversity axes) |
| `DESIGN.md` | The body — a conforming Google-spec DESIGN.md |

## Status

`brand.md/v0` — draft, extracted from a production pipeline (Marketing OS). The spec will move fast; expect breaking changes before v1. Apache-2.0.
