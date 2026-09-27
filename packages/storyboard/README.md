# Storyboard harness

Renderer-independent story planning and critique for social creative (spec 33).

`planStoryboards(brief, context, model)` proposes three arcs, checks source and
asset bindings, runs independent narrative/novelty critiques and returns review
material with a content hash. It has no imagery or write capability. A hash is
not approval. `createVisualCritic` evaluates attached candidate images against the
whole arc and the per-beat brief. The runtime binds `StoryModel` to fresh,
tool-less Mastra agents; the template exposes `social_storyboard_plan`.

The planner reads a reviewed tenant-owned
`social/reference/storyboard-context.json`, validated by `planningContextSchema`.
It contains `brand`, `facts`, `patterns`, `priorPosts`, and `assets`. Brand is
refreshed from the current tenant on invocation. Set `STORYBOARD_MODEL` to an
operator-selected model supporting structured output and vision. Missing model,
context or brand is an explicit error, never a silent fallback.

Counted patterns retain whole-post exemplar refs and ordered beat/media evidence.
Research has sources, never counts. Missing visual support labels an arc a
hypothesis. Mockup input requires an asset declared bare artwork with a verification
source; a framed render may be used as-is or as an honest detail crop.

`exploreStoryboard` is a renderer-free candidate loop, **not an approved spend
dispatcher**. Its cap reserves candidate slots rather than dollars. Use only behind
the existing approval gate once dollar quoting and dispatch are integrated.
Missing judgments and incomplete candidate batches fail closed.

Implemented tests validate contracts and refusal behavior, not creative quality.
Live corpus extraction, dollar-budget dispatch, rendered-sequence critique and
human acceptance remain outstanding; see spec 33 §10. Nothing here imports a
renderer, attaches Atelier, or grants publish consent.
