# Whole-post corpus extraction pilot

Status: local implementation in progress; GCS sign-in is waiting for a fresh
verification code. No claim of visual inspection or extraction is made yet.

The first question is whether re-acquisition is necessary. The September 1
handoff records a second, larger organic crawl: 504 artist handles, roughly 5.9k
images downloaded at the time of writing, and a periodic backup into the creative
corpus bucket. Those pixels may be stored separately from the 40-artist pilot
whose Instagram CDN URLs expired. Inventory the bucket root and all organic/field
prefixes before launching any Apify job. These are historical handoff figures,
not a verified current bucket inventory.

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
