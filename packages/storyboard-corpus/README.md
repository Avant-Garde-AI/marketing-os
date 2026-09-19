# Storyboard corpus pilot

An offline whole-post extraction runner. It reads actual ordered pixels, captures
source/checksum/model/prompt provenance, and keeps failed attempts in a local JSONL
ledger. It does not cluster, emit a genome, write store artifacts or publish.

Build this package, then inspect a local manifest without making model calls:

```sh
node dist/cli.js --manifest /tmp/pilot.json --out /tmp/pilot-ledger.jsonl \
  --run-id pilot-001 --project arthaus-us --model YOUR_VISION_MODEL --max-posts 3
```

Add `--execute` only to run that bounded selection. The active gcloud account
supplies an in-memory token; signing into gcloud does not require ADC setup here.
The model must support Vertex multimodal `generateContent` at the global endpoint.
There is no mock fallback, automatic retry, or implicit full-corpus execution.

The manifest is a JSON array. Each post has a stable `postId`, `format`, optional
`caption`/`engagement`, and ordered `media` entries with `ref`, `sourceRef`,
`localPath`, `kind: image`, and `ordinal` beginning at zero. A carousel must contain
all of its slides; manifest preparation is responsible for checking that against
the source metadata. Video uses `kind: video-sample` with ascending timestamps in
`sampleTimeSeconds`; the pilot accepts decoded PNG/JPEG/WebP samples, not MP4 files.
Two timestamps prove sampled coverage, not inspection of everything between them.

Original pixels and local run ledgers belong outside Git. The runner loads local
files through an acquisition seam; GCS download and raw-record normalization are
separate tasks pending inspection of the actual corpus. Local readability does
not certify that an image contains the expected post: visually review the pilot.

Resuming a matching successful run skips model execution. Changing content,
caption, model, prompt or extractor version reprocesses the post. Failures retain
safe provider diagnostics and token usage where returned. A `retryable` flag is
information for the operator, not an automatic retry loop. Concurrent writers to
the same ledger are not supported; this pilot fixes concurrency at one.

Run `vitest run`, `tsc --noEmit`, and `tsup` using the package dependencies. Tests
use fake transports and fixture bytes; passing them is not evidence of visual
extraction quality. Real media review and a measured pilot must precede scale-out.
