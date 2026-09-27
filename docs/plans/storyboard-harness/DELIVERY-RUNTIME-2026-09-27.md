# Storyboard delivery runtime

Implemented in the open-core scaffold; Arthaus receives a reviewed runtime port.
No production social publishing is part of the implementation test.

## Operator path

1. Choose a store-owned content concept. Call `social_graph_storyboard_plan`
   with an enabled graph prefix and exact catalog subjects, or
   `social_storyboard_plan` with an operator-prepared context. The explicit
   `STORYBOARD_MODEL` must support vision and structured output. Each call is
   tool-less and output bounded; the planner/critics make at most four calls.
2. Open the returned narrative `reviewUrl`. Compare all alternatives and their
   elimination reasons, evidence status, beat changes, copy and source bindings.
3. Propose `storyboard.select` through the existing gate using `propose_action`
   from chat or the authenticated MCP endpoint. The authenticated
   human approves the exact review/candidate and agrees a real elimination
   reason. No public URL can perform this step. No image generation happens.
4. Author a proposed SocialPost through `social_post_upsert` with bound facts.
   Its caption and copy formula must match the accepted storyboard.
5. Inspect the source images and specify one layout per beat, in story order.
   Call `social_storyboard_realization_prepare`, then propose its returned
   `social.storyboard_realize` params. Explicit normalized crop coordinates,
   exact on-slide copy, matching dimensions and source hashes are checked.
6. Realization creates the editable surface and immutable JPEG sequence. Open
   the final social `review` URL and inspect every numbered slide plus caption.
   The calendar/index receives the existing post and first-slide thumbnail.
7. Scheduling/publishing remains a separate existing Action. The full sequence
   is approval material. Material edits invalidate consent and require review.

## Current boundaries

- Core: planning/critique contracts, durable review/selection, source-backed
  realization, sequence contract, channel consent, scaffold and review pages.
- Store: brand, active concepts, graph aliases, catalog, source classifications,
  research, proposal/exemplar records and actual posts under `agents/social/`.
- Corpus: reusable acquisition/extraction/admission schemas and vocabulary in
  `packages/storyboard-corpus`; scoped private source material remains private.
- Persona MCP and Creative Review outcome adapters remain empty/optional.
- Generated scenes, video, verified-master mockups, spend quotes, richer layout
  generation and visual candidate critics are subsequent adapters. This first
  adapter refuses them explicitly rather than substituting a generic image.
- Human corpus admission remains required. Likes and a proposed transition do
  not establish engagement lift, and research never acquires `evidence.n`.

## Validation

The full core suite and package typechecks passed. Added lifecycle tests verify
tenant/source/context drift and exact human-choice material. Realization tests
exercise real deterministic crops, immutable hash validation, board order,
retries and concurrent frozen-post changes. Social tests cover ordered approval
hashes, edits, unsupported adapters and mocked Instagram carousel flow.
Arthaus typecheck and production build pass. The production checkpoint is
recorded separately after deployment; it must distinguish live tool/page tests
from authenticated human selection and final publishing.
