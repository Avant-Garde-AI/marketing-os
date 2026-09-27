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

The `normalizeFieldCohort` API audits raw field metadata and separates complete
single-image candidates from incomplete carousel/video covers. Normalize unknown
engagement honestly and deduplicate by shortcode before counting evidence.
See `docs/plans/storyboard-harness/CORPUS-PILOT.md` for the live pilot findings.

`CorpusSnapshot v2` is the acquisition boundary for the next extraction version.
It records expected and recovered media, verified source order with an evidence
reference, durable
object/checksum evidence, and separate visual/audio/transcript coverage. The
pure `assessSnapshot()` helper derives readiness without hiding incomplete,
expired, failed, or excluded source rows. Known child counts can be held before
the provider supplies child identities. A carousel cover or video poster
therefore remains ineligible for whole-post extraction. The contract does not
scrape Instagram or invoke a model.

`recoverCarousel()` binds a normalized provider and durable media mirror to
that contract. It checks exact post identity, child order and expected count,
then retains failed child mirrors as explicit gaps. A source provider adapter
and durable blob writer are still required for a live recovery run.

`analyzePostV2()` is the staged extraction contract for media supplied from a
complete snapshot. The caller must first verify acquisition readiness; the
analyzer checks the supplied ordered media against the supplied post input,
not against Instagram itself.
The pixel pass receives ordered media without caption or engagement; the
interpretation pass receives grounded observations and the caption as labeled
context, still without engagement. It keeps visible observations, adjacent
changes, transition readings and narrative beats separate, with exact source
references and unreviewed status. `createVertexV2Stages()` sends actual decoded
image bytes to the first pass and uses a text-only second pass. The v2 adapter
has bounded request size, output and time, and safe provider diagnostics.
The original CLI still runs v1, and v2 has not yet run on a recovered carousel.
The [v2 calibration findings](../../docs/plans/storyboard-harness/CORPUS-PILOT.md)
cover three complete single-image posts only.

The `storyboard-corpus-v2` CLI now accepts a JSON array of
`{ snapshotRef, snapshot, caption? }`, where `snapshot` is a complete
`CorpusSnapshot v2` and every actual child has a durable `objectRef`, SHA-256
checksum and readable local mirror path. It verifies readiness against the
snapshot, then verifies every file checksum before a model call. The ordinary
dry run checks local file presence, not checksum; `--execute` writes the JSONL
ledger and performs full verification. For example:

```sh
node dist/cli-v2.js --manifest /tmp/ready-snapshots.json \
  --out /tmp/v2-ledger.jsonl --run-id v2-pilot-001 \
  --project arthaus-us --model YOUR_VISION_MODEL --max-posts 3
# Add --execute to run the bounded selection.
```

The v2 ledger resumes successful exact inputs without another model call.
Engagement-only metric edits do not invalidate extraction; a caption, media
checksum, coverage or prompt change does. The runner is still local and
single-writer. It accepts complete still-image singles and carousels, not mixed
media or video yet; those are separate acquisition and annotation slices.
The source provider and durable carousel mirror remain to be implemented.

The executable needs `gcloud` on its inherited PATH. In environments where the
shell finds it but child processes do not, prepend the SDK `bin` directory to
PATH before starting the CLI. Do not repeat OAuth sign-in for a PATH error.

Original pixels and local run ledgers belong outside Git. The runner loads local
files through an acquisition seam; GCS download remains an explicit operator
step, separate from metadata normalization. Local readability does
not certify that an image contains the expected post: visually review the pilot.

Resuming a matching successful run skips model execution. Changing content,
caption, model, prompt or extractor version reprocesses the post. Failures retain
safe provider diagnostics and token usage where returned. A `retryable` flag is
information for the operator, not an automatic retry loop. Concurrent writers to
the same ledger are not supported; this pilot fixes concurrency at one.

Run `vitest run`, `tsc --noEmit`, and `tsup` using the package dependencies. Tests
use fake transports and fixture bytes; passing them is not evidence of visual
extraction quality. Real media review and a measured pilot must precede scale-out.
