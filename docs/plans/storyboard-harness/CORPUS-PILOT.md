# Whole-post corpus extraction pilot

For the full extraction v2, narrative modeling, research and delivery plan, see
the [core architecture](../../STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md).
This document remains the report of the measured v1 pilot.

Status: GCS access restored; three real single-image extractions succeeded on
2026-09-20 using `gemini-3.1-pro-preview` in project `arthaus-us`. Inputs and
observations were visually reviewed. No carousel/video arc has been extracted,
no production patterns emitted, and no full-corpus job launched.

As of 2026-09-23, `packages/storyboard-corpus/src/acquire/manifest.ts` supplies
the v2 pure acquisition contract: expected versus recovered ordered children,
canonical identity/occurrences, durable object checksums, and separate visual,
audio and transcript coverage. `recoverCarousel()` binds a normalized source
provider and media mirror, checks identity and order, and retains missing
children explicitly. It can classify a recovered post as ready, incomplete,
expired, failed or excluded without a model call. A live source provider and
mirror are still needed before the original 40-artist cohort can enter
whole-post extraction.
The first [24-carousel recovery slice](RECOVERY-SLICE-2026-09-23.md) is frozen
from the original source metadata, with expected child counts and acquisition
checks recorded before any provider run.

## V2 staged extraction calibration — 2026-09-23

The v2 code now separates a pixel-only observation pass from a narrative
annotation pass. The first pass receives real ordered image bytes and no caption
or engagement. The second receives the validated observations and caption as
labeled context, but no engagement. Schema and reference checks reject media
omitted relative to the supplied post input, changed order, unsupported beat
citations and invented claim references. Acquisition readiness must be checked
separately against the source snapshot before v2 is called.
Results remain `unreviewed` until a human checks both stages against the media.

A bounded local probe used `gemini-3.1-pro-preview` on the same three complete
single-image posts shown below. All three final outputs passed the v2 schema:

| Post          | Grounded observation                                      | Narrative annotation and review note                                                                                                                           |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DcfQ9hZm0bu` | Three comic covers within **one** static image            | Spatial catalog presentation, not three carousel beats. Small printed codes in the OCR still need careful human verification.                                  |
| `Dbg1Bb8SCIm` | Painted city street, pink sky, bare trees and pedestrians | Caption adds a seasonal reading. The inferred feeling is labeled as a hypothesis; an irrelevant audio limitation shows that semantic review remains necessary. |
| `DcWG8Bxxlcm` | Hand and stylus over tablet line art                      | A making-process presentation with caption-based promotional context, not a claim that unseen work stages or audience outcomes occurred.                       |

The strict initial prompt produced malformed or wrong-shaped JSON on three
attempts. An explicit response shape then yielded 3/3 schema-valid outputs;
these are calibration attempts, not a reliability rate. Provider-reported usage
for the final three outputs was 6,474 input, 1,755 output and 3,000 thinking
tokens across both passes. This is neither a price estimate nor a reconciled
invoice. The first local probe's resumable records stayed outside Git; the
snapshot-ledger CLI was added the following day. No recovered carousel or video was
available to test a real between-beat transition, and no cluster or pattern was
admitted. The next calibration must pair complete recovered carousels with
human judgments of what each adjacent slide actually changes.

### V2 snapshot-ledger run — 2026-09-24

`storyboard-corpus-v2` now runs the staged extractor from a `CorpusSnapshot v2`
manifest through a local, single-writer JSONL ledger. It checks source
completeness, local bytes against stored SHA-256 hashes, ordered refs and model
output. The dry run does not call a model or obtain an access token. A matching
successful input resumes without another model call; engagement-only metric
changes do not invalidate it. The v1 CLI remains available separately.

The three saved field-cohort single images above were wrapped in explicit
single-image snapshots with original source metadata and the existing GCS image
objects as durable references. The local manifest and pixels stayed outside
Git. The dry run found 3/3 complete and locally available. The executed run
wrote three ready rows and three extracted rows; each output held one grounded
observation, zero adjacent transitions and `review.state = unreviewed`. Running
the exact command again left the ledger at six rows, demonstrating cached
resume. Provider-reported usage for the executed three was 6,456 input, 1,814
output and 3,138 thinking tokens across both passes.

Two initial annotations still added irrelevant missing-audio caveats to static
images. A tightened annotation prompt was re-probed on those two images: 2/2
schema-valid and neither repeated that caveat. This small correction is not a
semantic accuracy rate. V2 has **not** run on a complete recovered carousel;
the provider adapter and durable child-media mirror still gate a real arc test.

## Direct inventory and correction

The bucket contains more than the original 40-artist pilot. Downloaded metadata
under `instagram-organic/2026-09-01/field-cohort/` verifies:

| Measure                                    |         Count |
| ------------------------------------------ | ------------: |
| Account metadata files                     |           504 |
| Post rows                                  |         6,958 |
| Unique shortcodes                          |         6,947 |
| Saved JPEG objects                         |         6,927 |
| Single-image rows / matching saved objects | 1,337 / 1,332 |
| Carousel rows / matching cover objects     | 3,020 / 3,006 |
| Video rows / matching poster objects       | 2,601 / 2,588 |
| Rows without a matching image object       |            32 |

Eleven duplicate rows are cross-account appearances of the same shortcode.
Also, 778 rows have negative like-count sentinels; treat these as unknown,
never as negative engagement or zero. The 32 missing images have no `imageFile`,
rather than a named object that disappeared. One saved JPEG is unreferenced by
the current field metadata.

Counts of matching rows are not unique evidence counts. The field includes
adjacent accounts, so relevance must be reviewed before admitting patterns.
Every field post has only one image reference; metadata has neither child slides
nor video streams. The original pilot sample retains `childCount` but no child
media. Saved carousel covers and video posters remain incomplete posts.

## Measured three-post pilot

The selection deliberately contrasts three treatments, rather than ranking by
engagement. Source images remained outside Git. All three were downloaded from
the field cohort, inspected directly, then supplied as image bytes to Vertex.

| Post                               | Visible input and reviewed extraction                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sweeney_boo / DcfQ9hZm0bu`        | Three comic covers on one canvas; extractor identified a comparison/catalog treatment, not three carousel beats.                   |
| `pascalcampionart / Dbg1Bb8SCIm`   | Pink sky between dark vertical buildings and small pedestrians; extractor retained color, scale, lighting and painterly treatment. |
| `margaretmoralesart / DcWG8Bxxlcm` | Angled tablet showing line art with hand and stylus; extractor retained the process context and foreground focus treatment.        |

Result: 3/3 schema-valid, complete single-image observations. Reported usage:
4,444 input tokens and 761 output tokens; no thinking-token field was returned.
This is reported provider usage, not a reconciled invoice. Six earlier attempts
failed locally obtaining a token because the worktree PATH omitted gcloud;
those failures remain in the ledger and are not counted as observations. A
subsequent resume returned all three cached observations without new model calls. Adding
the SDK bin directory to PATH resolved the issue without another login.

The pilot validates actual-pixel transport and basic treatment extraction. Its
short prose observations need a larger stratified calibration set before choosing
clustering features. It proves neither quality of multi-beat analysis nor a
relationship between treatment and engagement. No human approval of a storyboard
or creative rejection has yet been demonstrated.

The normalizer was also run over all 504 downloaded metadata files: it retains
1,332 remotely available single-image candidates, audits 5,599 incomplete
carousel/video rows, quarantines all 22 appearances of the 11 duplicated IDs,
and records five missing single-image references. Supplying only the three
actually downloaded filenames yields exactly three locally ready candidates.
Package validation: 28 tests, TypeScript typecheck and declaration build passed.

## Next execution batches

1. Deduplicate globally by Instagram shortcode and audit source provenance.
   Normalize complete single-image records only; retain excluded covers in an
   explicit coverage report. Check image paths and durable object membership.
2. Calibrate on a stratified set of art-relevant single images, including plain,
   repetitive and unusual posts. Review extraction disagreements, then cluster
   treatment observations with retained outliers. Keep engagement out of the
   vision prompt and join it only for descriptive, artist-relative comparisons.
3. Reacquire a small representative set of carousel child media in source order
   and real videos, using existing handles/post URLs. Preserve slide counts and
   video sampling times, mirror bytes durably, and audit completeness before
   extraction. Covers alone cannot enter the arc lane.
4. Review observed transitions, then expand through bounded, resumable batch
   execution. Version prompts and feature schemas; unique whole posts are the
   unit of evidence. Pattern admission remains reviewed, not automatic.

## Execution ownership

Use cheaper coding/execution agents for manifest normalization, acquisition,
runner implementation, schema checks and failure recovery. Keep architecture and
sample interpretation under review. This is independent of the model used to
inspect the pictures: a cheaper worker should not silently replace a frontier
vision model with caption heuristics or a mock provider.

`packages/storyboard-corpus` is the offline execution package. It does not import
Atelier or a renderer. The runtime's `packages/storyboard` remains the consumer of
reviewed, extracted patterns. The old static-ad pipeline is a reference for
checkpointing and quarantine handling, not the unit of execution for carousels.

## Pilot sequence

1. List GCS prefixes and object metadata; download only small metadata manifests
   until the real structure is known. Reconcile stable post IDs and handles.
2. Find durable images. Check that each selected carousel retains every slide in
   order, not merely its cover. Distinguish full videos from poster images.
3. Prepare a local post manifest with durable source refs and local media paths.
   Keep caption and engagement metadata, acquisition time, checksums, order and
   timestamps. Third-party pixels remain outside Git and are never post assets.
4. Start with a small mix of complete carousels and single images across artists.
   Do not select only the highest engagement posts; include weak/ordinary examples
   so the extractor cannot mistake correlation for a recipe. Sampled video is a
   separate validation slice and must retain timestamps and coverage limits.
5. Dry-run the manifest. Explicitly choose the project, model and post cap before
   any execution. The provider must receive actual image bytes, in order.
6. Run the bounded pilot. Inspect every successful observation against its pixels.
   Check what beat two adds, whether treatment was retained, and whether the
   extracted transition is observed or merely inferred from the caption.
7. Review ledger failures and costs before expanding. No automatic retries,
   silent model downgrades, or hidden quarantine. A changed input checksum,
   caption, model, prompt or extractor version invalidates cached extraction.
8. Only after the extraction survives review, cluster visual treatment and
   narrative-transition features. Retain outliers. Count unique whole posts,
   never frames. Do not emit a production pattern library from the pilot by
   default.

## Cost shape

The local pilot uses synchronous Vertex calls so each output can be inspected.
The runner fixes concurrency at one and requires an explicit post cap in its CLI.
An output-token cap and timeout bound each call; failed calls may still consume
tokens, so usage must survive alongside failure status whenever the provider
returns it. This is a work cap, not an invoice-level dollar cap.

For validated scale-out, Google supports multimodal batch requests from GCS JSONL
and advertises batch pricing at 50% below real-time inference. Check the chosen
model's current availability and prices before creating the actual job; do not
infer cost from old layout-synth run logs. Sources:
[batch input contract](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage),
[batch behavior](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference),
[model pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

## Authentication and authority

The CLI uses the active gcloud account; it captures a short-lived access token in
memory and passes it only to Google's Vertex endpoint. `gcloud auth login` and
Application Default Credentials are distinct, so this pilot does not assume that
signing into gcloud populated ADC. Never print or persist the token.

Outputs are local research artifacts. They do not update store context, genome,
posts or publish consent. Reviewed pattern admission and merchant-facing writes
continue through their existing governed paths.
