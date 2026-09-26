# From storyboard research to finished posts in the existing review room

Delivery checkpoint: 2026-09-26. New storyboard-generated posts are not yet on
the deployed review page. The live rehearsal produced plans and advisory
judgments; it did not compose, export, persist or publish a final post. The
implementation stack remains open/draft and is not deployed.

The immediate product path is:

```text
store concept + graph/catalog subjects + bounded reviewed pattern context
  -> competing storyboards
  -> durable human selection
  -> ordered Design Studio boards
  -> rendered slide assets + visual/claims checks
  -> linked SocialPost + calendar/index projection
  -> existing /review/social/{groupId} with every slide and final caption
  -> existing authenticated schedule/publish approval
```

## What is already available

The shared planner/critics, graph/catalog read seam and transition proposal/review
contracts exist in open PRs. A live core rehearsal produced three hypothesis
boards; one survived advisory critique and two failed brand-copy checks. Two
source transitions are staged separately in the store; neither is admitted.
No offline judgment establishes engagement efficacy.

The existing runtime already supports `compose_design_surface` with multiple
named boards, editable Studio files, board-specific exports using `?board=...`,
`social_link_design`, post/calendar indexing, signed review links, reviewer notes
and the existing schedule/publish Action gate. Keep those seams.

The current review page calls `postThumbnailUrl()` once per channel variant and
shows one image. `socialAssetUrl()` supplies one export URL; the Instagram adapter
publishes one image. Multiple composed boards therefore do **not** currently
mean an end-to-end supported carousel. Rendering and publishing a whole sequence
requires an ordered asset contract, sequence-aware review and channel adapter.
The public review link can collect notes/display state; possession of that link
is not authenticated approval. Selection and publishing decisions retain their
existing authority path.

## Delivery milestones, in priority order

| Milestone | Implementation | Acceptance |
| --- | --- | --- |
| 1. Land the usable runtime and durable story review | Review/consolidate the relevant PR stack, port canonical/template behavior to the store, configure an explicit production model/capability path, persist run/context revisions and expose alternatives plus selection through the existing review/authority surfaces | A real store request returns alternatives in a persistent review record; the selected revision, rejections and decision survive reload; missing sources fail visibly |
| 2. Realize the selected board | Add a thin storyboard-to-Design-Surfaces adapter, deterministic catalog-asset/crop handling, board ordering, final copy and a versioned render manifest; export each slide and run visual/claims checks | One selected arc becomes an editable file plus ordered rendered slides, with every beat accounted for and no silent missing slide. Catalog renders never become bare-artwork mockup inputs |
| 3. Put the finished sequence in the existing review room | Extend post binding/projection with ordered assets and originating run/selected-story refs; add a slide viewer per channel variant, captions/links, revision/status and existing notes; update after edits | `/review/social/{groupId}` shows the exact complete rendered sequence, final caption and destination link after reload; notes/revisions point to the right artifact |
| 4. Preserve approval for the complete post | Extend preview/publish material hashes to ordered assets and copy; add sequence-aware Instagram publishing behind the same gate; invalidate consent on any slide/copy/order change | Approval binds every final slide in order. Safe container-only checks precede publishing. No post ships without existing authenticated approval |
| 5. Scale useful variation | Admit inspected patterns through verified authority; test several distinct reader arguments over multiple subjects; compare with current-agent baseline, then measure governed live outcomes | A first batch contains meaningfully different series and subject instances; repetition and outcome results update store knowledge without turning inferred effectiveness into counted evidence |

The first reviewable carousel does not require full-corpus backfill, graph
projection, learned rankers or optional NeuroGraph/Creative Review implementations.
Pattern evidence must remain explicitly qualified; to meet the original
corpus-supported acceptance gate, admit a genuinely inspected applicable move.
Render reuse permits a deliberate first pilot without synthetic rooms or
mockups; mockup series still require verified bare masters/geometry.

## First concrete delivery target

One complete still-image carousel in the existing review room: a selected,
source-grounded story; all ordered slides built and exported; final caption/link;
a visible critique trace; editable Studio binding; reviewer notes; no publishing
without consent. Then expand to a small batch across distinct archetypes and
subjects. The first milestone is an actual final-post review URL, not another
local JSON or research HTML comparison.

## Ownership and verification

Core owns portable run/selection/realization/asset contracts and template UI/tool
behavior. Marketplace owns actual concepts, subject choices, run artifacts,
rendered post bindings and outcome records. Corpus packages own reusable source,
pattern and admission contracts; scoped reference data remains with its owner.
New core/template behavior lands before store/hosted ports. Preserve tenant
routing, broker credentials and the existing governed write paths.

Verify durable revision/decision binding; selection-to-slide coverage; ordered
export and full-sequence display; edit/review-note behavior; image/claims checks;
complete consent hashing and fail-closed dispatch. Test an actual deployed
review URL end to end. Existing unit passes are not that acceptance test.
