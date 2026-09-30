# Themed scene carousels — owner correction, 2026-09-30

The three standalone scene pilots proved frame composition and source fidelity.
They did not prove the intended editorial format: they reused one botanical trio
in unrelated Moroccan, forest and space environments. The new unit is **one
cohesive post with three distinct, ordered lifestyle scenes**. Each world must
follow the selected artworks' theme and aesthetics. The magical series sits
beside separate approachable-home posts and artwork loops.

Default for the magical series: three distinct artworks, one hero per slide.
`collection-per-slide` remains a supported planning composition. This is a
creative default, not a platform requirement to put three frames in every image.

## Implemented in this change

The generic `productionRecipeSchema` adds optional `selection` and `carousel`:

- `selection.theme` names the concept. Every requirement must match at least one
  of its `anyOf` evidence keys on **each** selected work. Match before reuse
  ranking or shared-color clustering. A shortage keeps only eligible candidates
  and blocks the slot; unrelated artworks cannot fill the gap.
- `selectionEvidence` binds each key to source refs. Bare `groupingKeys`, artist
  names and prompted assumptions do not establish thematic membership.
- `carousel` contains exactly three ordered setup/turn/payoff briefs with
  different environment and placement directions, a visual-connection direction,
  continuity constraints and composition mode. The output binds subject handles
  to each ordered slide, with one caption for the complete post.
- A collection recipe labeled `outputKind: carousel` without these three briefs
  is blocked. The planner does not call one generated scene a carousel.
- The runtime reads current catalog collection handles (up to 50 per product)
  and tags and emits source-bound `collection:` and normalized `tag:` keys.
  Missing/truncated membership does not qualify. Reviewed inventory can carry
  other explicit evidence, but cannot override current collection/tag reads.
- Existing graph/visual facet receipts supply subject, palette, movement and
  mood keys. Collection membership is eligibility, not a taste verdict. A human
  or critic must still inspect how the actual work informs its scene.

These remain read-only planning contracts. They create no posts, spend no
credits, and give no publishing or scheduling authority. Existing input hashes,
paid job plans and final pilot receipts are unchanged. No renderer enters
`packages/storyboard`.

## Ownership

Core owns generic evidence matching, sequence structure and validation. The
store owns collection handles, theme requirements, imaginative settings, selected
artworks, verified masters and copy. The corpus owns measured/extracted examples
and admission evidence; this owner-directed series remains brand-derived with
zero counted corpus support. Do not label it engagement-proven.

Arthaus config uses Modern Tropical membership for Moroccan-inspired worlds;
space collection membership plus Collage catalog tags for cosmic worlds; and
observed botanical subjects for forests. A Collage tag does not establish a
specifically digital production method. Artist credits require their own
verification. The 12-slot editorial mix remains six loops, three approachable
home posts and three magical carousels (one per theme).

## Next implementation: generate and review an actual carousel

1. Acquire current candidates from the relevant catalog/graph theme, inspect
   full unframed sources and stage source hashes. Record the actual palette,
   motif or composition that connects each work to its proposed environment.
   Do not use framed catalog thumbnails or assume Print Only means raw artwork.
2. Add a versioned carousel parent containing one post ID/caption and three
   ordered child scene plans. Bind source/brief hashes, selected hero, output
   dimensions and per-slide/total credit ceilings. One explicit authenticated
   owner request may authorize the bounded group through the existing Action
   gate; no extra artwork preapproval. Public review links confer no spend.
3. Extend the current three-source/three-frame compositor and scene plan to a
   validated single-hero variant without weakening legacy receipts. Generate
   an empty-frame environment whose opening proportions match its actual source.
   Preserve exact artwork pixels. Frame localization and visual rejection must
   inspect each result; semantic difference cannot be proved by string inequality.
4. Keep the existing per-child submission journal. Resume completed children;
   reconcile unknown submissions; do not regenerate an entire group on retry.
   The parent stays partial until all three final, source-faithful slides exist.
5. Persist immutable final JPEGs and their hashes. Present all three slides in
   order under one token-scoped review, with one caption and artist credits.
   A month sheet shows one card per carousel, not three standalone posts.
6. Publishing approval binds the complete ordered sequence and caption. Missing
   slides, changed hashes, wrong theme or duplicate views hold publication.

Acceptance: the middle slide offers a new spatial/placement idea; the last is a
payoff in the same aesthetic world; each work belongs for a specific visible
reason; the art stays complete and readable. Human acceptance of framing in the
pilot does not accept its artwork selection or the full future carousel.

## Validation

Targeted core tests cover thematic exclusion despite a shared palette, all-of
requirements, evidence receipts, no unrelated fallback, ordered hero assignment,
collection-per-slide assignment, missing sequences and duplicate directions.
Runtime tests cover source-bound membership/facets, catalog reads and tenant
isolation. Store rehearsal uses current catalog reads and labels source gaps;
it is not a generated month or production deployment receipt.
