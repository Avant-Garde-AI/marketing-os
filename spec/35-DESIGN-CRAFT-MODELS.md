# 35 — Design Craft Models: the DTC craft vocabulary, perception model, and decision model

> Status: **P1 BUILT** · **P2 in progress: semantic merge built** (2026-11-19) · MVP defined 2026-11-18
> Owner project: `marketing-os/` (open core). Hosted serving + outcome data live in `marketing-os-app/`.
> Origin: the "stroke-level decision model" idea, 2026-11-18.
> Builds on: spec 21 (Brand Conversion Design Agent), the shipped `packages/design-loop` executor, spec 22 (brand.md), spec 23 (Design Surfaces), spec 20 (Action gate).

## 1. Thesis

The open-source design executor (`packages/design-loop`, delegated to by a Claude
Code orchestrator through the Design Work Contract) is meant to be **the agent
built specifically for visual DTC execution**. Today it pairs a general LLM
implementer with a general VLM critic. That's capable but undifferentiated.

The differentiated version makes design decisions at the **stroke level**: one
named craft decision at a time, drawn from an ontology extracted from the
best DTC storefronts, chosen by a model that has learned what converts in the
store's category across the Marketing OS network.

This takes three assets, built in order:

1. **The DTC craft vocabulary.** An ontology of named design axes (e.g.
   `pdp-gallery-behavior`, `offer-framing`, `social-proof-density`) whose values
   are *extracted from real storefronts* and admitted only when they recur across
   distinct brands.
2. **The perception model.** Screenshot → craft facets. Labels any rendered page
   against the vocabulary.
3. **The decision model.** (brand, category, page state) → ranked next strokes.
   Trained first on public preferences, then tuned on network outcomes per
   category.

### 1.1 Prior art we are porting (Arthaus portfolios harness)

The method is proven for artist portfolio sites in
`Arthaus-Inc/portfolios` (`scripts/harness/`, `docs/harness/`):

| Arthaus piece | Ported as |
|---|---|
| `library/vocabulary.json`: ~40 axes, glossed values | The DTC vocabulary store (same shape, new content) |
| Three registers: HARD facets / PROSE / OPEN `(axis, value, gloss)` | Same three registers in the labeler output |
| Admission gate: value recurs across ≥3 distinct artists; axis recognized at ≥3 | Same gate, where support = **distinct brands (store domains)** |
| Specificity floor + near-duplicate folding | Ported verbatim (token overlap now, embeddings later) |
| `de-artist.mjs`: finished builds → shared structure vs parameters | **de-brand**: finished storefronts → axis decisions (label the outcome, since we can't observe other brands' edit history) |
| The shelf (trajectory store) | Label dataset + design-loop traces |
| `ORACLE_IS_SELF_REFERENTIAL.md` | **The binding constraint on P4.** The vision judge swung 1.67 points on reference choice alone, and `rewardCoverage` stayed 0. Reward is fixed before any decision-model training |

**The Arthaus vocabulary is method, not content.** No Arthaus axis value is
imported. Axes that recur in DTC (accent economy, section seams, ground texture,
type voice) must re-earn admission from the DTC corpus.

## 2. MVP definition

The MVP is done when **a store's design-loop run picks its next design move using a
category-aware decision model served by Marketing OS, and that run measurably beats
the current LLM implementer on the bench.**

Concretely, all of:

| # | MVP criterion | Measured by |
|---|---|---|
| M1 | A DTC craft vocabulary with ≥20 recognized axes and ≥100 admitted values, earned from ≥60 distinct storefronts across ≥4 categories | `design-craft vocab report` |
| M2 | An open label dataset (labels, not pixels) covering the corpus, with a datasheet | `design-craft dataset export` + `DATASHEET.md` |
| M3 | A perception model with ≥0.75 per-axis agreement against held-out human labels, distilled to an open VLM servable on an OpenAI-compatible endpoint | `design-craft eval perception` |
| M4 | A reward pipeline with nonzero, stable coverage: rotated multi-reference pairwise judgements + action-gate approve/reject + tenant outcomes | reward coverage ≥0.5 of labeled runs, judge reference-swap drift ≤ noise floor |
| M5 | A base decision model + at least one category-tuned layer, wired into design-loop as an `Implementer`/`CriticProvider` | `design-loop-bench`: fewer iterations-to-pass and fewer tokens at equal-or-better judged quality |
| M6 | Hosted serving: the model is available to a tenant's Claude Code / build process through the store MCP, tenant-scoped | a live Arthaus design-loop run through the hosted endpoint |

**Out of MVP:** per-brand adapters, continuous corpus re-extraction, an embedding-based
near-duplicate merge, Penpot (spec 23) integration, any public-facing UI beyond a
console read view.

## 3. Architecture

```
                    ┌────────────────────── open core (marketing-os, MIT) ──────────────────────┐
 corpus.json ─▶ capture (Playwright) ─▶ PerceptionLabeler ─▶ LabelRecord ─▶ de-brand ─▶ vocabulary.json
 (URLs, category)     screenshots          (VLM endpoint)     (dataset row)   (observe)   (HARD/SOFT/OPEN)
                      stay local                                   │
                                                                   ▼
                                                     dataset export (labels only)
                                                                   │
            design-loop ◀── StrokeImplementer / StrokeCritic ◀── DecisionModel (base, open weights)
                 │                                                 ▲
                 └── traces + bench ───────────────────────────────┘
                    └──────────────────────────────────────────────────────────────────────────┘
                    ┌────────────────────── hosted (marketing-os-app) ─────────────────────────┐
                    │ category-tuned decision model ◀── tenant outcomes (approvals, offer/email/│
                    │ served behind store MCP (mos_ token)   theme-edit results, consented)     │
                    └──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Package: `@avant-garde/design-craft` (new, `packages/design-craft/`)

Open-source and MIT, same as design-loop. Pure logic with injected I/O, following
design-loop's logic-vs-adapters rule:

| Module | Responsibility |
|---|---|
| `vocabulary` | Store shape, `observe()` admission + axis gate, specificity floor, near-dup folding, `validateFacets()` (HARD), `softPrior()` (SOFT), reward fields. Storage-agnostic: pure functions on a store object |
| `ontology` | DTC seed **axis prompts**: named dimensions + descriptions used only as the soft "recurring dimensions" prior. No seeded values |
| `corpus` | Corpus manifest schema: store URL, category, selection rationale, page set (home / collection / PDP / cart) |
| `labels` | `LabelRecord`, the dataset row and open-dataset contract |
| `labeler` | `PerceptionLabeler` interface, prompt builder, strict response parser (applies HARD + OPEN registers) |
| `debrand` | Folds label records into the vocabulary (support = brand domain) and returns admission events |
| `dataset` | Export labels to JSONL + a generated datasheet. Never exports pixels |
| `adapters/openai-vision` | Labeler over any OpenAI-compatible vision endpoint (frontier VLM now, our hosted open model later) |
| `adapters/playwright-capture` | Lazy optional dependency. Captures a page set at desktop + mobile |
| `cli` | `design-craft capture`, `label`, `vocab`, `dataset` |

### 3.2 Three registers in a `LabelRecord`

| Register | Field | Enforcement |
|---|---|---|
| HARD | `facets: Record<axis, value \| null>` | Coerced against admitted values. Unknown → `null` + recorded rejection |
| PROSE | `notes` | Free text, never load-bearing |
| OPEN | `proposals: {axis, value, gloss}[]` | Specificity floor → pending pool → admitted at ≥N distinct brands |

`origin: 'earned'` (admitted on sight) is reserved for **human-confirmed** labels.
It's the DTC analog of Arthaus's "shipped, build-green code". Model proposals
are always `origin: 'proposed'`.

### 3.3 Decision model layering

```
open base model   (public preference data, open weights)
  └─ category layer (network outcomes per category; hosted)
       └─ brand layer (brand.md / DESIGN.md adapter; hosted, post-MVP)
```

- **Action space** = admitted `(axis, value)` pairs. A stroke is "move axis A to
  value V on page P". The design-loop implementer turns a stroke into code.
- **Minimum-support rule for category layers**: a category gets its own tuning only
  when ≥K distinct stores contribute outcomes (K starts at 5). Below that it falls
  back to the parent category, then the base model. No single store's results can be
  read back out of a category model.
- **Guardrails stay deterministic**: WCAG, token fidelity, and the dark-pattern
  blocklist run as design-loop gates, never as learned scores. Strokes resolve inside
  the tenant's DESIGN.md tokens. The model chooses *which* axis to move, and the brand
  decides *where* it can land.

## 4. Open source & commercial shape

| Open (OSS) | Hosted (Marketing OS subscription) |
|---|---|
| Vocabulary + admission tooling (`design-craft`) | Hosted inference via store MCP + design-loop provider, tenant-scoped (`mos_` token) |
| Label dataset (labels, URLs, capture dates, derived features) | Category-tuned decision models trained on network outcomes |
| Perception model weights | Per-brand adapters (post-MVP) |
| Base decision model weights | Bleeding-edge tier: newest checkpoints, continuous re-extraction, ahead of OSS cadence |

- **The moat is outcome data, category coverage, and freshness, not the weights.**
- **Dataset licensing**: we never redistribute third-party storefront screenshots.
  Rows carry URL + capture date + labels. Screenshots stay on the capturing machine.
- **Tenant data** trains category layers only under explicit subscription terms,
  aggregated under the minimum-support rule, and never ships in an OSS release.

## 5. Phases

Each phase leaves something useful behind, even if later phases slip.

### P1 — Vocabulary engine + perception labeling pipeline (open core) · IN PROGRESS
- `packages/design-craft`: vocabulary (ported admission logic), ontology seed
  prompts, corpus/label schemas, labeler interface + OpenAI-compatible adapter,
  de-brand, dataset export, Playwright capture adapter, CLI.
- Unit tests for every gate (specificity floor, near-dup folding, value admission,
  axis recognition, HARD coercion, parser robustness, dataset never carries pixels).
- **Exit:** CLI runs capture → label → de-brand → export end to end on a 5-store smoke
  corpus with a frontier VLM endpoint.

**P1 result (2026-11-19):** exit met. 5 stores × 2 pages × 2 viewports = 20/20 captured and
labeled by `gemini-3.1-pro-preview` (D1 resolved: Gemini teacher, pinned id),
199 observations, **16 axes recognized** (most named by all 5 brands), **0 values admitted**,
189 pending. Dataset export verified pixel- and path-free. Findings that changed the code:

1. *Seed examples leak as values.* Example phrases in seed-axis descriptions came back nearly
   verbatim ("stark-white", "hard-color-cuts"). Seeds are now example-free questions, and the
   system prompt's format example comes from an unrelated field. Both are test-enforced.
2. *Cold-start facets were being dropped.* With an empty vocabulary the teacher answers in
   `facets`, which all coerce to null. Unadmittable facet answers now feed the open register.
3. *Token-overlap merging is unsafe.* The Arthaus Jaccard merge folded opposites
   (`two-column` → `four-column`, `white-canvas-with-tinted…` → `tinted-canvas-with-white…`), and
   that produced all three of the first run's admissions. It's now conservative: function words
   ignored, opposition groups, role-swap guard, ≥0.6. A missed merge is recoverable and a wrong one
   corrupts. Values didn't recur verbatim across 5 brands (the Arthaus long tail), so admission
   at scale depends on semantic merging. **That is P2's first task.**
4. *Season.* All captures are Black Friday creative, which skews offer and hero axes. The datasheet
   records the capture range, and P2 spreads capture dates.

### P2 — DTC corpus + first vocabulary
- **First: semantic value merge.** Embed `value + gloss` and fold above a tight threshold (the
  Arthaus KG pattern, ~0.92), with an LLM adjudicator for the band between retrieval and merge.
  Opposition and role-swap guards still apply. Re-run on the P1 smoke labels: synonyms such as
  `strikethrough-and-pill-tag` / `strikethrough-with-value-badge` should fold, and
  `two-column` / `four-column` must not.

  **Built 2026-11-19 (`merge.ts`, `design-craft merge`).** Calibration changed the design. On
  `gemini-embedding-2`, `two-column-uniform` / `four-column-uniform` scored **0.946**, higher than the
  true synonyms `strikethrough-price-with-highlight-tag` / `strikethrough-and-pill-tag` (0.939). No
  threshold separates them, so **embeddings only retrieve** (cosine ≥0.85, top-3), deterministic
  guards veto (oppositions incl. negation and type families, role swap, reviewer block list), and a
  **judge model decides every merge** (`gemini-3.1-pro-preview`, "when unsure, DIFFERENT"). Clustering
  never chains A≈B≈C. Every merge records score, judge, reason and the support it brought.
  The cheap in-`observe` merge is now **exact rewordings only** (same content words, any order).
  Overlap merging also folded broad names into narrow ones (`inline-links` → `centered-inline-links`)
  and `monospace` → `sans`. The undo is to block the pair and replay from labels (labels are the source
  of truth, and the vocabulary is derived).

  Smoke result (v2 labels): 182 values → 5 rewording merges + 20 judged merges (≈90% look right
  on manual review), 3 values admitted, 17 axes recognized.

- **Prompt finding: any example leaks.** The off-domain format example added in P1 ("architecture")
  leaked its whole register into the labels: `frieze-band-carousel`, `centered-text-colonnade`,
  50 occurrences across 20 labels. The labeler prompt now carries no example values at all
  (test-enforced) plus a plain-design-review-language rule. Re-label: 0 occurrences.
- **Corpus resolved 2026-11-19:** `corpus/dtc-v1.candidates.json` (84 draft candidates) →
  `design-craft corpus` (browser pass reads each home page's own links, fetch pass fills from
  `/products.json`) → `corpus/dtc-v1.json`: **72 stores with full page sets** (apparel 18, beauty 16,
  home 13, food-bev 10, accessories 6, wellness 5, pets 3, outdoor 1), 7 tagged `needs-pages`,
  5 dropped (403 to automated browsers). Rationales are drafts pending human review.
- **Capture waves (decided 2026-11-19).** Wave 1 = Black Friday week (2026-11), captured now.
  Wave 2 = mid-January 2027, same corpus, so every axis sees sale and non-sale creative
  before any model trains on it. The datasheet breaks brands down by capture month. P3 training waits
  for wave 2.
- Curate `corpus/dtc-v1.json`: ~80 stores across ≥4 categories (apparel, beauty,
  home, food & bev, art/décor), selected for visual distinctiveness + public
  reputation. The selection rationale is recorded per store.
- Run labeling. A human review pass confirms a stratified sample (`origin: earned`)
  and creates the held-out gold set for P3.
- `design-craft vocab report`: recognized axes, admitted values, pending pool, ontology health
  (hit rate, emergence rate, convergence. Arthaus `ontology-history` analog).
- **Hook into design-loop now (no training needed):** the vocabulary's `softPrior()`
  feeds the LLM implementer, and `validateFacets()` labels its output. Exit = M1, M2.

### P3 — Perception model
- Teacher = frontier VLM labels. Student = small open VLM, fine-tuned on (screenshot,
  facets) pairs. Training code lives in `marketing-os-agents/` (Python).
- Eval against the human gold set. Serve behind an OpenAI-compatible endpoint
  (hosted GCP; also runnable locally from open weights).
- Swap the `openai-vision` adapter's endpoint from teacher to student. Exit = M3.

### P4 — Reward
- Pairwise judge with **rotated multi-reference sets**: never self-reference, with reference
  identity randomized. Measure swap drift against the noise floor before trusting
  any score (the Arthaus lesson).
- Outcome capture from the action gate (`marketing-os-app`): approve/reject on design
  proposals, plus offer/email/theme-edit result readback, keyed to the strokes that
  produced them.
- Reward coverage tracked as a first-class metric. Exit = M4.

### P5 — Decision model (base + category) and design-loop integration
- Base model trained on public pairwise preferences over the label dataset.
- `StrokeImplementer` (proposes N strokes → the LLM writes each) and `StrokeCritic`
  (per-stroke deltas in `flags`) as optional design-loop providers.
- Category layers trained on network outcomes under the minimum-support rule.
- Bench vs the current implementer. Exit = M5.

### P6 — Hosted serving + subscription
- Serve category models behind the store MCP (`marketing-os-app`), tenant-scoped via
  broker-issued credentials. design-loop picks up the endpoint from config.
- Entitlement + metering in the platform app. First live tenant: Arthaus. Exit = M6.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Judge bias distilled into the decision model | P4 gates P5. Swap-drift measurement is mandatory |
| Vocabulary sprawl (Arthaus KG produced ~4 concepts/category at n=3) | Distinct-brand admission + axis gate + specificity floor + near-dup folding |
| Copying brands instead of learning moves | Action space is axis values, not layouts. The implementer refusal stays. Bench near-duplicate check against corpus captures |
| Screenshot/ToS exposure | Labels-only dataset. Captures never leave the capturing machine |
| Category models leaking one store's results | Minimum-support rule (K distinct stores) |
| "Top performing" unobservable for outside brands | Corpus selected on distinctiveness. Performance comes only from our own network outcomes |

## 7. Open decisions

- ~~**D1** Teacher VLM~~ **Resolved 2026-11-19:** Gemini, pinned `gemini-3.1-pro-preview` via the
  OpenAI-compatible endpoint. Labels record the pinned id, so a teacher change is visible in the data.
- **D2** Should the Arthaus artist vocabulary and the DTC vocabulary share one
  domain-agnostic axis schema (spec 23's "packs are consumers" stance), or stay as siblings?
- **D3** Student VLM base model family and size for P3.
- **D4** Category taxonomy: Shopify's product taxonomy top level vs our own.
