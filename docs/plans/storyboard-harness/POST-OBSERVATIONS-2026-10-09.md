# Post quality and outcome observations

First implementation slice from the [October 9 roadmap](ROADMAP-REFRESH-2026-10-09.md): expose actual frame diagnostics and Instagram outcome snapshots on post details, loop/group review and bound carousel review. The agent can read the same records through `social_post_observations`. This is evidence readback, not a new approval or generation path.

## Delivered contract

`social/observations/{postId}/{recordHash}.json` is an immutable, versioned sidecar, separate from `post.md`, its consent and calendar projection. The social pack owns validation, media/content identity, measurement and provider response normalization; the template owns token binding, offline capture and display. Store-owned observations pass through a reviewed repository PR; the capture script never writes to the runtime repo, channel, database or schedule.

- Media identity hashes the exact video digest or ordered carousel digests. Copy/date edits preserve matching motion diagnostics. Media replacement or slide reordering invalidates them.
- Creative identity includes post, account, caption, target and media. Outcome display requires matching creative identity and actual platform publication ID. A caption edit or republication cannot silently reuse earlier outcomes. Moving a release date does not rewrite media quality or measured content identity.
- Content-addressed records, timestamps and post identity are validated on reads. Older/different revisions remain historical; corrupt/unverifiable records are counted visibly. Explicit tenant context travels into review-side reads.
- A metric is either available with a nonnegative scalar, including a measured zero, or unavailable with a reason. Unsupported, denied, missing and failed reads never become zero.

## Capture and interpretation

From a client-owned `agents/` checkout:

```sh
npx tsx scripts/inspect-social-post.ts --post <post-id> --out /tmp/social-observations
npx tsx scripts/inspect-social-post.ts --post <published-post-id> --insights --out /tmp/social-observations
```

Load existing credentials through the environment/Node env-file support; never put a token in an argument. Readback resolves the live account through the existing broker source, verifies the recorded destination and exact published ID/caption, and makes only Graph GET calls. It uses existing Graph version configuration and isolates metric failures. The implemented endpoint was exercised on all seven current Arthaus publications; permissions remain tenant-specific and future provider changes can make metrics unavailable. [Meta's Instagram reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/) is the provider contract; successful Arthaus captures prove this account/version only.

Video capture verifies the content-addressed MP4 bytes and declared dimensions/duration, then decodes grayscale samples with installed ffmpeg/ffprobe at six frames per second and 160-pixel width. It records mean/max adjacent change and first/last sampled change. A mean below 0.25% is a configurable-in-record **review hint**, not a calibrated universal quality threshold. Compression, drift, camera motion and brightness changes affect this statistic. A small endpoint difference does not prove a seamless loop; a moving video does not prove a useful story or faithful artwork. No record carries a quality pass, publish consent, pattern admission or counted-corpus claim.

The console shows captured lifetime totals and the post age at capture. Current snapshots are at different ages; do not rank them as a controlled experiment. Average Reel watch time is retained as the provider-reported metric, not converted into a completion rate or clamped to clip duration. No completion metric is inferred from views.

## Current delivery and remaining work

Arthaus's first batch has seven captured publication snapshots, three diagnostics for earlier published loops and a diagnostic for the approved October 10 replacement. Earlier loop mean frame change spans approximately 0.09–0.16%; the replacement is approximately 4.47%. Those values support reviewing the near-still versus visible-motion difference. They do not establish narrative quality or improved engagement. Exact observations and capture ages live in the store repo.

The outdated store concept availability flag is corrected independently of admission: video realization is available subject to verified masters/budget/review; its evidence remains brand-derived, `n: 0`, and draft.

Next reliability work: governed scheduled collection at fixed observation windows, durable recovery and credential/failure alerts. Next creative work: typed human/sequence judgments for beat gain, fidelity and loop return, followed by the operator brief/three-direction/scoped-revision workbench. This slice adds neither automatic metric jobs nor autonomous repair, and it does not change already approved releases. Pooled hosted runtime parity remains a separate port.
