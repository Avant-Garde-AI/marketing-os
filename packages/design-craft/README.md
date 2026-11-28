# @avant-garde/design-craft

The DTC design-craft vocabulary, perception labeling pipeline, and open label
dataset behind Marketing OS's stroke-level design models.
Spec: [`spec/35-DESIGN-CRAFT-MODELS.md`](../../spec/35-DESIGN-CRAFT-MODELS.md) (this package is phase P1).

```
corpus.json ─▶ capture ─▶ label (VLM) ─▶ debrand ─▶ vocabulary.json ─▶ dataset (labels only)
```

- **Vocabulary**: named design axes (`pdp-gallery-behavior`, `offer-framing`, …) whose
  values are earned from real storefronts. A model-proposed value is admitted only once it
  recurs across **3 distinct brands**, and an axis is recognized once 3 brands name it.
  Human-confirmed labels admit on sight. Method ported from the Arthaus portfolios harness.
- **Three registers per label**: HARD `facets` (coerced against admitted values, unknown → null),
  OPEN `proposals` (`axis, value, gloss` triples that feed admission), PROSE `notes`.
- **Seed axes** (`src/ontology.ts`) are dimension prompts only. No values are seeded.

## Run

```bash
pnpm --filter @avant-garde/design-craft build
D=packages/design-craft; node $D/dist/cli.js <command>

# 1. Capture (Playwright, optional dep). Screenshots stay in --out; never commit them.
#    Keep --out durable (the gitignored .captures/ here, not a temp dir): P3 trains on these pixels,
#    and storefront creative can't be recaptured once it changes.
design-craft capture --corpus corpus/smoke.json --out .captures

# 2. Label with any OpenAI-compatible vision endpoint (teacher VLM now, our open model later).
DESIGN_CRAFT_API_KEY=… design-craft label --captures .captures/manifest.jsonl \
  --vocab vocabulary.json --out labels.jsonl --base-url <endpoint>/v1 --model <id>

# 3. Fold labels into the vocabulary (idempotent: support is a set of brands).
design-craft debrand --labels labels.jsonl --vocab vocabulary.json

# 3a. Fold synonym AXES first: same retrieve → judge shape, emergent axes only (seeds are never
#     absorbed), directional ("is every value of FROM an answer to INTO's question?"), repeated
#     until a pass merges nothing. Later labels under a folded name land on the canonical axis.
design-craft merge-axes --vocab vocabulary.json --base-url <endpoint>/v1 [--dry-run] [--block axis-block.json]

# 3b. Fold synonym values: embeddings retrieve candidates, guards veto, a judge model decides each merge.
#     --block reviewed.json lists pairs a reviewer rejected; they are never merged again.
design-craft merge --vocab vocabulary.json --base-url <endpoint>/v1 [--dry-run] [--report merge.json]
#     --cached-only replays from .embeddings-cache.json / .verdicts-cache.json with no network:
#     uncached axes are skipped and uncached pairs stay unmerged (the safe default).

# 4. Group each axis's admitted values into families (decisions): one model call per axis,
#    validated to partition the values exactly, cached for replay. --block takes reviewer overrides
#    [{axis, value, family, label?, why?}].
design-craft taxonomy --vocab vocabulary.json --out taxonomy.json --base-url <endpoint>/v1 [--cached-only]

# 5. Category benchmarks: brands per value and per family, per category (≥5 brands) and viewport.
#    --season marks a single-sale-season corpus, so promotional conventions are reported, not suggested.
design-craft benchmarks --vocab vocabulary.json --labels labels.jsonl --taxonomy taxonomy.json --out benchmarks.json [--season black-friday-2026]

# 6. Inspect (M1 criteria, stage coverage, emergence), then export the open dataset (no pixels).
design-craft report --vocab vocabulary.json --labels labels.jsonl
design-craft dataset --labels labels.jsonl --vocab vocabulary.json --out release/ --taxonomy taxonomy.json [--season …]
```

The conversion layer (`conversion.ts`) maps every axis to a purchase-path stage and lever, builds
the benchmarks, and ranks strokes (`suggestStrokes`). `@avant-garde/design-conversion-mcp` serves it
over MCP.

`label` is resumable: it skips captures already present in `--out` (by sha256).

## Capture notes

- Each page is shot twice per viewport: the first screen before scrolling (`*.fold.png`, the
  true sticky chrome and a full-resolution hero) and the full page capped at 6000px. Both go to
  the labeler, first screen first.
- Consent banners and entry popups are dismissed best-effort (accept/close buttons + Escape).
- **Season matters.** A corpus captured during a sale (e.g. Black Friday) is dominated by
  promotional creative and will skew axes like `offer-framing`. Spread capture dates for P2.

## Rules this package enforces

- The dataset never carries pixels. Rows reference captures by sha256, and export strips unknown keys.
- Model output is never trusted: unparseable replies fail the record, they don't produce empty labels.
- Prompts carry no example values in any domain. Examples leak verbatim, or leak their register.
- Merges are judged, never assumed from similarity. Labels are the source of truth: to undo a merge,
  block the pair and replay `debrand` + `merge`.
- API keys are passed by the caller and never written to records or logs.
