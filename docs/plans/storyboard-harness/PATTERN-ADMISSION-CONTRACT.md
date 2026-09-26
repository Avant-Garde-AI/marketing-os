# Transition-pattern proposal, review and retrieval contract

Implemented checkpoint: 2026-09-26. This is a small layer-C bridge from extraction
outputs to reusable narrative moves, not a completed learned taxonomy or library
service. Exported as `@avant-garde/storyboard-corpus/library` to keep extraction
and admission entry points separate. It imports no renderer, graph database,
provider client or publishing capability.

## Lifecycle

`proposeTransitionPattern()` normalizes selected complete still-carousel v2
transitions. Each exemplar retains original post/account, snapshot/input/analysis
hashes, transition ID, adjacent observation IDs and presentation ordinals, media
refs, visible source descriptions, observable change, separate interpretation and
limitations. The proposal contains a scope, ID/revision, abstract move and
hypothesized rationale. It issues no count and asserts no admission or efficacy.
The caller acquires source account identity and verified media from upstream
snapshots; this compiler validates relationships, not remote media authenticity.
The in-memory empty byte buffers used for locator validation are not pixel
inspection. Correct source/extraction artifacts remain the upstream truth.

`patternProposalHash()` canonicalizes the normalized proposal. Revisions to
wording, interpretation, scope or exemplars invalidate existing review binding.
A digest never supplies review authority by itself.

`compileTransitionLibrary()` accepts proposals and separately owned review
records with a required `verifyReview` capability. That capability must check an
existing authenticated/approved record; this package supplies no permissive
production verifier. Reviewer names or model-created receipts are insufficient.
Each admitted exemplar must have confirmed visible change, interpretation and
domain fit. Partial support can be admitted; uncertain, rejected or unreviewed
members are excluded. The compiler counts unique posts and source accounts,
not transitions, and holds proposals without support. It rejects foreign scope,
stale/duplicate reviews, foreign exemplar decisions and conflicting source
account attribution. Source inspection and interpretation agreement do not
establish performance for a store.

`retrieveTransitionPatterns()` selects at most six explicit pattern IDs from a
fresh authority-compiled library of the requested scope. The compiled object is
deep-frozen and process-marked. Deserialized/model-supplied JSON cannot be served
as a trusted library; owned artifacts must be recompiled with the authority
capability. This is a bounded in-memory seam, not semantic search or a database.
No implicit cross-tenant or domain-to-tenant fallback exists.

The selected output matches the current planner's counted transition shape.
Its legacy `fromBeat`/`toBeat` fields carry source **presentation ordinals**;
these do not infer one narrative beat per image. Counts remain derived from
unique inspected posts. Single-image treatment, sampled video and researched
claims are deliberately outside this initial transition-only contract. A
future per-move support contract must preserve their separate semantics.

## Three ownership layers

- A: the base planner remains independent. No corpus acquisition/import is
  added to the core agent or runtime entry point by this checkpoint.
- B: actual proposal JSON, source identity records and review decisions live in
  the owning store's `agents/social/reference/storyboard/` (or a separately
  scoped domain library). Store recipes and named subjects are not defaults.
- C: the generic schemas, normalization, hash/review checks, admission compiler
  and retrieval port live in `packages/storyboard-corpus/src/library.ts`.

The companion Arthaus PR stages two distinct transition proposals from the
latest validated exhibition and book sequences. It resolves source owner
identity against the recovery manifests, retaining the distinction between a
source artist/coauthor and the owning account. No cluster membership is claimed
merely because both examples change context. There are no review decisions, so
its serialized library snapshot contains **zero admitted entries**. It is an
inspectable artifact; it is not yet consumed by the deployed social agent.

## Verification and remaining work

Five contract tests cover unreviewed refusal; exact hash/authenticated authority
binding; partial support with correct post/account counts; scope, uncertainty and
rejection; foreign locators/reviews; and refusal of deserialized trusted libraries.
The complete corpus suite has 91 passing tests; typecheck and build pass.
Real-source normalization generated the two held proposals without additional
model, scraper or imagery calls.

Still required: source-media review and corrections; production authenticated
review adapter; store-owned artifact loader and planner-context wiring; broader
relevant exemplars; graph/search projection; per-move single/sequence support
migration; creative baseline and multi-subject archetype evaluation. The missing
reviewer decision is not inferred from elapsed time or a model pass. No pattern,
concept or post is automatically activated by a successful extraction or build.
