# Fortnightly social autopilot

Implementation dated 2026-10-25. Deployment and activation require separate live
receipts. Tests and a checked-in policy alone do not mean automation is enabled.

The independent `/api/cron/social-autopilot` clock runs every five minutes. One
unique tenant/window key and an eight-minute lease prevent concurrent or
 overlapping fortnights. Each invocation advances at most eight bounded steps.
It creates each fortnight seven days before its first publication. The initial
recovery window may start sooner, but never skips the review lead time.

The authenticated Social → Production backlog page enables the ordinary
`social.autopilot.grant` Action using the signed, real console user. The gate
records the actual owner and an immutable policy. Models and deployment keys
cannot approve a standing grant. A replacement supersedes previous authority.

## Durable steps

- **Prepare:** rotate the store-owned `social/autopilot/recipes.json` pool of
  verified masters and thematic concepts. The canonical template creates seven
  artwork loops and seven three-slide carousels. Sonnet writes fourteen captions
  from supplied facts; artist handles and imagined-scene disclosure are required.
  Drafts and immutable generation inputs become files through a gate Action.
- **Generate:** reserve all ceilings before the first submission: 21 × 3 + 7 × 8
  = 119 credits, below the approved 125-credit fortnightly cap. Exact quotes must
  fit those limits. Existing jobs are reused; failed and unknown submissions keep
  their reservations. The existing generation Actions and `decideAction()` own
  every paid provider submission. No replacement generations or automatic rerolls.
- **Realize:** vision locates a single unobstructed frame opening and its outer
  corners. Strict confidence, geometry and safe-area checks precede the existing
  deterministic compositor. Near-frontal frame adjustment preserves the original
  artwork without an added mat. A credential-free media sandbox exports loops to
  1080×1920 Reels and 1080×1350 feed variants. A forward/reverse timeline closes
  the seam; a motion check rejects static-looking clips. All delivery receipts
  and final bytes bind to the exact generation input and job.
- **Bind:** gate Actions bind verified final media to the frozen captions. Machine
  checks are not represented as human creative review or evidence of engagement.
- **Notify and schedule:** confirm and persist Slack delivery before arming any
  schedule. Require at least 24 hours plus an hour of margin before the first
  release. Then schedule the finished posts immediately through the existing
  `social.schedule_post` Action, so they appear on the calendar during review.
- **Publish:** the existing publishing cron checks the schedule consent hash and
  current standing authority under its existing post lock. The grant must remain
  active, the Slack/review deadline must be satisfied, the exact schedule must
  have executed through the gate, and the post must not be held. Pause prevents
  already-scheduled automatic posts from publishing. Manual posts are unaffected.

## Controls and failure handling

The authenticated backlog page shows active/paused status, actual production
phase, scheduled count, Slack receipt and attention detail. It supports pause,
resume, holding a post and advancing production now. Slack Pause/Resume controls
operate on the same grant. There is no second approval or credential authority.

Unknown paid submissions, lost transform or Slack outcomes, failed localization,
changed inputs, higher prices, revoked connections and missed review deadlines
stop visibly in `attention`. Reconciliation must retain the frozen material and
reservations before explicitly resuming the correct phase. Nothing marks absent
media ready, reports unsent Slack notices as delivered or publishes late.

The initial store pool uses already-inspected Arthaus masters. Each window
produces fresh media and captions. Open-ended catalog discovery, performance
learning and the deferred NeuroGraph adapters are outside this delivery. Adding
verified artwork/concepts belongs in the store pool, not core source code.

## Deployment proof

Apply `supabase/migrations/018_social_autopilot.sql`, deploy control plane and
canonical template/runtime code, enable through a real owner session, then
record the grant, production batch, generation jobs, Slack receipt and exact
scheduling results. Until those exist, describe this as implemented and tested,
not activated or fully scheduled.

Implementation: the open-core template owns planning, rendering, binding and console controls. The platform owns standing grants, leases, budgets, Slack and cron execution. Arthaus owns recipes, master lineage, editorial facts and desired policy.
