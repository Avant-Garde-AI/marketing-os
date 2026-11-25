# Datasheet: dtc-craft-labels v0.2.0

Design-craft labels for DTC storefront pages (Marketing OS spec 35).

## Composition

- Records: 450 (0 human-confirmed)
- Brands: 79
- Labelers: model:gemini-3.1-pro-preview
- Captured: 2026-11-19 to 2026-11-20. Storefront creative is seasonal (sale periods skew offer and hero axes).

| Category | Brands |
|---|--:|
| accessories | 8 |
| apparel | 20 |
| beauty | 16 |
| food-bev | 12 |
| home | 13 |
| outdoor | 2 |
| pets | 3 |
| wellness | 5 |

| Capture month (wave) | Brands |
|---|--:|
| 2026-11 | 79 |

| Page type | Records |
|---|--:|
| collection | 148 |
| home | 158 |
| product | 144 |

## Vocabulary at export

- Recognized axes: 27 · axes with admitted values: 23
- Admitted values: 296 · pending: 2491
- Semantic merge: 491 judged merges across 25 of 27 recognized axes.
- No judged value merges (not run, or none accepted): promotional-overlay, sub-category-navigation
- Axis merge: sticky-buy-behavior ← sticky-cta-behavior, secondary-buy-action, sticky-element-behavior; sub-category-navigation ← subcategory-navigation, category-navigation; promotional-overlay ← promotional-drawer-treatment; secondary-nav-treatment ← sub-navigation-treatment

## What is NOT included

- **No screenshots or page content.** Each row references its capture by sha256 only.
  Recapture from `url` + `capturedAt` if pixels are needed; storefront imagery belongs to its owners.
- No performance or conversion data. Selection was on visual distinctiveness and reputation, not observed outcomes.

## Known limitations

- Model-labeled rows (`confirmed: false`) carry teacher-model bias. Train and evaluate on confirmed rows where it matters.
- Labels describe a page at `capturedAt`. Storefronts change.
