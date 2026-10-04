# Social production milestone and remaining research

The temporary full-artwork loop and themed three-slide scene recipes now reach final media, caption/artist credits, authenticated review, existing-gate approval and shared calendar scheduling. The generic implementation lives in the social skill pack and generated console template; Arthaus-specific source artwork, concepts, receipts, media and calendar live in `Arthaus-Inc/marketplace/agents/social/`.

Arthaus's runtime is deployed at `www.arthaus.cloud`. One forest carousel was published through the gate on October 3. A 14-post batch is approved for October 4–17, daily at 10:00 America/Chicago, alternating seven Reels and seven carousels. Before the first due send on October 4, live checks confirmed all 14 scheduled artifacts and valid consent, recurring successful cron requests, connected Instagram credentials and reachable next-post media. The first actual automatic Reel publication remains unverified at this checkpoint. Scheduler HTTP success and an inert `FINISHED` container are not publication receipts.

## What is shipped

- Source/job/render-bound generation receipts and immutable public JPEG/MP4 delivery.
- Instagram carousel and Reel adapters, destination rechecks and durable post-level publish attempts.
- Authenticated Publish/Schedule controls using the existing gate; signed review links remain read-only.
- Shared email/social calendar, intended times distinct from approved schedules, timezone display and file-to-index reconciliation.
- Batch review, exact pending-proposal resumption across devices, material/date consent and automatic due-post execution.

Core implementation and Arthaus runtime ports are merged. Store-owned paid generation and final assets for this batch are complete; publication needs no new generation spend. This is an operating social pipeline milestone, not a claim that the temporary recipes have statistically proven engagement or completed the storyboard research program.

## Remaining work

| Work | Current boundary |
| --- | --- |
| Automatic-send acceptance | Record the first real scheduled Reel result after its due time; then verify the first scheduled carousel. Do not publish early or infer success from cron HTTP 200. |
| Operational recovery | Existing journal blocks ambiguous automatic retries. Provider container journaling, richer reconciliation UI and proactive failure alerts remain follow-up work. |
| Repeatable larger batches | Use the implemented planning/generation/binding/review seams; the prepared 14-day inventory does not prove unattended monthly generation. |
| Corpus-backed archetypes | Continue complete-media recovery, extraction, pattern admission and comparative evaluation under the core plan. Temporary recipes remain explicitly separate from counted corpus evidence. |
| Outcomes and client adapters | Performance feedback and optional MCP persona/Creative Review integration remain separate work; their empty extension seams are intentional. |

The operating runbook and timestamped evidence belong to the store repo:
`agents/social/production/SOCIAL-OPERATIONS.md` and
`agents/social/production/SOCIAL-CLOSEOUT-2026-10-04.json`.
The [architecture plan](../../STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md)
remains the research roadmap; [calendar scheduling](CALENDAR-SCHEDULING.md)
and [carousel publishing](CAROUSEL-PUBLISHING.md) describe the shipped contracts.
