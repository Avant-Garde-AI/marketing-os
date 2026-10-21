# Rolling social production and release

Owner request, 2026-10-21: create fourteen daily posts seven days before the
first release, alternate lifestyle carousels and artwork animations, schedule
without individual approvals, and notify the owner in Slack for opt-out review.

## Current state — implementation is not activation

- The existing gate, token-scoped reviews, approved scheduling and five-minute
  publishing cron remain the execution path.
- Frozen editorial-draft carousel binding shipped in core #133 and store #272.
- A live scheduling attempt found Meta OAuth error 190. No new schedule or
  publication executed. Owner-only credential recovery shipped in core #134 /
  store #273 and is live at `https://www.arthaus.cloud/social/connections`.
- The existing Arthaus Slack review destination received the recovery/review
  notice. This confirms one notification delivery, not recurring automation.
- Three October camera-edit videos were rendered without model media spend;
  their new receipt/renderer shipped in core #135. Store deliveries are #274.
- All eighteen October Higgsfield inputs now have cost-only proposals. Estimate:
  63.75 credits; combined per-job ceilings: 120. No generations submitted.
- `lib/social/autopilot.ts` implements and tests the pure policy, calendar-window,
  native-time, credit-reservation and release-precondition contracts. It performs
  no writes and grants no authority. The durable worker, standing grant and
  operator controls below remain to be implemented. **Autopilot is not enabled.**

## Calendar and budget contract

Use one stable account/date batch key and non-overlapping fourteen-day windows.
For the Arthaus deployment, after the October remainder:

| Prepare on | Daily release dates | Local send time |
| --- | --- | --- |
| October 25 | November 1–14 | 10:00 America/Chicago |
| November 8 | November 15–28 | 10:00 America/Chicago |
| November 22 | November 29–December 12 | 10:00 America/Chicago |

Resolve each date's local wall time independently. November 1 is 16:00 UTC;
October dates are 15:00 UTC. Do not add fourteen 24-hour intervals to an existing
UTC send time across daylight savings. A daily tick must not create a new
fourteen-day overlapping horizon. Missed review lead time requires attention;
never silently backfill a release in the past.

Owner-confirmed on 2026-10-21: **125 Higgsfield credits per fortnight**, applied
to each non-overlapping fourteen-post batch. The Arthaus deployment policy now
records `maximumCredits: 125`. With the current fixed provider profiles,
seven three-slide carousels and seven loops need 21 scenes and seven videos.
Ceilings of three credits per scene and eight per loop reserve 119 credits.
These ceilings must be enforced against fresh exact quotes; a rate increase
stops the batch. Historical prices are observations, not future spend grants.
Reserve ceilings before submission, including failed/unknown attempts. A retry
or reroll cannot release a reservation merely because its result was lost.

The checked-in deployment policy remains disabled with the confirmed budget.
The budget decision is resolved; a policy file never substitutes for the
platform standing grant or a functioning production worker.

## Work to complete, in execution order

1. **Owner standing grant in the platform.** Implement an app-executed action
   that previews the exact destination, policy hash, recipes, daily cadence,
   per-batch/per-job caps, Slack destination and opt-out behavior. Approval
   through `decideAction()` records the real owner, proposal ID and policy
   revision. Never impersonate a signed-in console or connector. Agent tools
   may propose this action; they cannot enable it themselves. File changes
   invalidate a grant until a new approved revision is recorded.
2. **Durable batch and slot journal.** Add tenant-cascading platform tables for
   grants, windows, slot state, paid reservations, exact proposal/job IDs, asset
   manifests, Slack delivery receipts and release outcomes. Claim bounded steps
   with leases/unique keys using the existing job runner. Recover from persisted
   phases. An unknown provider submission is an attention state, never another
   generation request. Check entitlement, tenant uninstall, active grant and
   live Instagram identity before any paid work.
3. **Bounded authoring and realization worker.** Reuse the production planner,
   verified master inventory, thematic recipe selection and voice/contracts.
   Write fourteen source-grounded captions and progressing three-beat briefs
   through a specifically scoped runtime prepare action. Carry actual artist
   handles and clearly label imagined settings. Realize the two established
   archetypes with fresh media. Use verified empty-frame localization and the
   deterministic compositor for scenes; use a bounded media worker for video
   export, source/fidelity/seam and visible-motion checks. Archive source-bound
   provider results and final bytes. Machine acceptance is not human review or
   evidence of engagement success. Experimental camera formats can be added
   after explicit recipe admission; they are not silently substituted for loops.
4. **Delegate narrowly through the existing gate.** Before each generated-media,
   artifact-binding or scheduling decision, verify the current owner grant,
   tenant, account, batch dates, exact params/material hashes and remaining
   reservation. Call `decideAction()` with a distinct delegated actor carrying
   grant/revision identity. Keep the app/runtime executor split. No generic
   service endpoint or model-callable tool receives an approve-anything flag.
5. **Slack review before release is armed.** Final media must be inspectable in
   the existing month/post review pages. Deliver a batch notice to the tenant's
   configured review destination with exact dates, counts, review links and
   pause/edit controls. Record the successful Slack receipt before scheduling;
   do not treat a missing channel or claimed-but-unsent notice as delivery.
   Require the configured review interval before the first send. Update the
   notice after the gate confirms the exact schedules; a failed schedule is
   visibly partial and never reported as fourteen scheduled posts.
6. **Operator controls and send-time revocation.** Add authenticated enable,
   pause, skip-one, edit and cancel-batch controls to Social. Pause must prevent
   already-scheduled delegated posts from sending, not merely stop new batches.
   Recheck the active grant/slot opt-out under the existing post lock immediately
   before publication, and cancel future delegated schedules through the gate.
   Edits invalidate the material hash and remove consent. Preserve manual posts
   and published records. Default calendar filtering remains scheduled/published;
   show auto-scheduled ownership and review deadlines clearly on the Social board.
7. **Production proof and rollout.** First exercise a bounded real batch after
   confirmed budget configuration and account recovery. Confirm file truth, exact
   slot counts, successful Slack delivery, valid schedule consent and eventual
   Instagram IDs/permalinks. Test duplicate ticks, pause during rendering,
   pause after scheduling, revoked token, provider unknown outcome, price change,
   missing source, missed lead time, Slack outage and partial scheduling with
   meaningful fixtures. Do not use fake posts on the live account as evidence.

## Boundaries

The open-core social pack owns delivery/lifecycle contracts; the console template
owns reusable authoring, review and scheduling behavior. The hosted platform owns
standing authority, durable jobs, credentials, budget reservations and Slack.
The store repo owns catalog/graph facts, masters, recipes, editorial content,
media receipts, captions, cadence and requested policy. Hosted runtime changes
must preserve tenant/broker/service seams when ported from the template.

Never write a consent hash directly, mark absent media ready, call a channel's
publish method outside the gate/approved cron, or store secrets in policy or
artifacts. A valid credential or successful Slack notice alone does not confer
publishing consent. A configuration file or test suite is not a live worker.
