# Reviewed generation carousels → Instagram

Implemented 2026-10-03. The temporary scene archetypes use the existing platform
gate and Vault/broker. No storyboard selection or corpus evidence is fabricated.

## Ownership and delivery

Core social pack: honest sequence provenance, destination, consent hashes,
lifecycle writes and retry semantics. Generated console: source/job/render
verification, public immutable assets, authenticated controls and runtime locks.
Store: artworks, scene recipes, ordered manifests, JPEGs, captions and credits.
Platform: existing proposals, nonce decisions, dispatch/audit and credentials.
No Arthaus account IDs or handles occur in generic code.

`renderedSequence` accepts legacy storyboard receipts or explicit
`origin: generation-delivery` (parent ID, manifest hash, one delivery hash per
ordered slide). Binding verifies master bytes, immutable input hashes, matching
finished broker jobs/repo, delivery placements, final JPEG hashes and 1080×1350
sizes. Captions preserve artist mentions and must fit 2,200 characters. Preview
never writes, generates media or spends credits. Execute pins reviewed bytes to
tenant-scoped public content-addressed JPEG URLs, creates the parent if absent,
and delegates to the existing publish/schedule lifecycle. It refuses differing
bound copy/material and never regresses a scheduled or published post.

## One page, one approval gate

Signed review links remain read/comment authority only. The same review displays
Publish/Schedule for a console user separately verified with Supabase `getUser()`.
Same-origin POSTs are required; decisions are scoped to that tenant's pending
carousel proposal, parent ID and reviewed manifest hash. Actor comes from the
verified session, never browser input. Hosted deployments refuse deployment-wide
console sessions; their operators retain the platform/MCP approval surfaces.

First click proposes `social.publish_carousel` or `social.schedule_carousel`;
Approve on that page decides through the existing platform gate. The complete
caption and ordered images are reviewed once; no extra artwork approval occurs.
The live Instagram ID/handle is displayed, enters consent material, and is
rechecked before submission. Any changed caption, sequence, destination or time
invalidates the approval. Local-time scheduling is stored as UTC; the existing
five-minute cron publishes at/after the approved instant, not at an exact second.

## Duplicate prevention and reconciliation

A tenant/post transaction-scoped Postgres advisory lock serializes gate and cron
executors, including transaction-pooler deployments. `publishAttempt: started`
is saved before contacting Instagram. Success records platform ID, permalink,
completion time and `completed`. Errors/unknown responses record `unknown`;
process loss leaves `started`. Both block automatic retries. Already-published
execution returns its saved result. The runtime executor allows 300 seconds;
provider requests are bounded.

Reconcile an unresolved attempt against gate audit and Instagram, matching
caption/order/assets/time. Restore a known platform result or clear a proven
non-publication through an operator-reviewed store artifact change. No
model-callable force-retry or token reset is exposed. A richer audited recovery
UI/container journal is follow-up work.

## Verification and rollout

Tests cover receipt compatibility, destination/order consent drift, durable writes
before submission, ambiguous retry blocking, published idempotency, session/CSRF
rejection, scoped decisions, verified actor, read-only preview and source/job/render
changes. Store readiness and the forest production smoke evidence live under
`agents/social/production/`. Moroccan/space remain unposted until approved.

Next: governed Reel adapter for existing loops; durable provider container journal
and reconciliation UI; corpus-backed archetype evolution and performance feedback.

Reference: [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
