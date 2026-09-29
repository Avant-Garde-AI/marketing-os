# Practical production recipes — 2026-09-28

## Scope correction and implementation boundary

The owner prioritizes repeatable content now: full-artwork looping video and
three-artwork lifestyle scenes, divided equally between plausible homes and
invented worlds. Corpus extraction remains useful research; admitting a counted
pattern is not a prerequisite for honestly labeled owner-derived recipes.
The existing narrative shortlist and final review are retained. No plan artifact
is itself generated content, approval, a seamless-loop guarantee or engagement
proof.

Implemented here: a pure recipe/month planner in the social pack; source-bound
copy briefs; weighted recipe and subject rotation; evidence-aware three-artwork
cohorts; blocked source slots that retain useful writing context; a tenant-bound `social_production_month_plan`
tool acquiring live graph/catalog receipts, reviewed source metadata and exact
concept copy formulas. Stable IDs support retry reconciliation, not permission
to overwrite prior posts. Defaults: 12 new proposed slots, mix 6/3/3. Existing occupied calendar
rows/post IDs remain intact; plans use available planned dates or report an
insufficient calendar. A missing calendar returns a proposal requiring review. No imagery
calls, provider credential changes, scheduled timestamps or publishing writes.

Scene cohorts share at least one normalized facet from current catalog or
operator-reviewed source evidence. The planner rotates among eligible groups
of three distinct verified artworks using source-bound grouping keys. If no
coherent group is available, the slot stays blocked with its source and copy
context. The runtime independently checks the selected relationship and cites
the actual evidence; a grouping key alone is never a publishable claim.

## End-to-end delivery work

1. **Sources.** Resolve exact published catalog identities to the original
   asset system. Produce a bounded, full-composition derivative server-side;
   inspect it, decode dimensions, pin SHA-256 and record provenance. Never
   infer flatness from a product handle or strip a frame by relabeling a crop.
   Only send scoped derivatives to the generation provider, not archival masters.
2. **Provider connection.** Add tenant-scoped OAuth for the official Higgsfield
   MCP through the control plane: state/PKCE, verified callback/redirect,
   encrypted access/refresh credentials, refresh locking, disconnect/revocation
   and broker-scoped access. Honor initialize/session behavior and inspect live
   tool schemas. Do not pass durable credentials into the agent or blindly
   expose spending tools through the generic external-tool map.
3. **Recipe pilot.** Prepare one loop, one real-home grouping and one imagined
   grouping. Present the actual source, motion/scene direction, caption
   alternatives and estimated credit ceiling. For the bounded pilot, an explicit
   request from a verified console user or `generation:run` MCP connector can
   authorize the existing Action without an artwork preapproval step. Bind the
   verified actor, source, brief, fixed settings, exact quote and ceiling in
   that Action. A public review token is never spend consent.
4. **Jobs.** Persist tenant, post/slot, provider request id, source and prompt
   hashes, model/version, estimate/maximum credits, attempts and outcome. Submit
   once after approval; persist before polling. An uncertain submit enters
   reconciliation, never automatic resubmission. Refresh status without spending;
   cap retries per job and per batch; pause on exhausted budget or auth loss.
5. **Loop realization.** Inspect actual image-to-video/first-last-frame tool
   support. Preserve the complete source composition and choose motion from
   something visible in it. Matching boundary references guide generation but
   do not prove continuity. Compare decoded first/last frames, inspect boundary
   motion and intermediate fidelity; review at least two cycles. Reject tears,
   invented objects, border loss, flicker, abrupt reversals or a still presented
   as an animated success. If boundary closure needs a finishing pass, record
   that transform and re-review; never silently substitute a boomerang.
6. **Scene realization.** Use generated scenery with explicit frame planes;
   composite the three exact source images into those planes. Perspective,
   artwork aspect ratio, occlusion and lighting require deliberate handling.
   A prompt that says “preserve artwork” is not fidelity verification. Compare
   each framed region to its source, count all three, and reject double frames.
   Plausible homes remain styled concepts; invented worlds are identified as
   imagined. Initially deliver a still carousel, then add camera movement only
   when artwork fidelity is demonstrated.
7. **Copy.** Fresh catalog/graph facts plus current brand and declared genome
   formula → candidate hook/caption, accurate credits and accessibility text.
   Caption candidates accompany the storyboard before imagery spend. Final
   accessibility descriptions follow rendered pixels. Run existing claims checks
   and source-reference validation. Mechanical passage is not taste acceptance.
8. **Delivery.** Rehost outputs as immutable, tenant-scoped assets, retaining
   MIME, dimensions, duration, source and provider lineage. Extend SocialPost
   with a validated motion asset and poster; include it in material/approval
   hashes and clear consent on edits. Add review playback and calendar posters.
   Extend the existing Instagram adapter for Reels/container readiness and test
   an inert container before any authorized publish. Keep final publishing
   consent separate from generation approval.
9. **Month.** After the three-item pilot is accepted, quote the chosen cadence,
   prepare the month, generate in small resumable batches and expose the existing
   contact sheet. Record blocked, rendering, rejected and review-ready separately;
   never present proposed slots as completed posts. Avoid repeat subjects,
   relationships, motion and rooms; revise low-performing recipes from outcomes.

## Ownership

| Boundary | Owns |
| --- | --- |
| Open core | Recipe/plan contracts, source/credit checks, job state machine, provider port, review/media contracts and tests |
| Platform control plane | Tenant OAuth/Vault/broker and existing Action authority |
| Arthaus store | Recipe mix, room worlds, graph bindings, source inventory, voice, operator choices and results |
| Dataset/reference lane | Corpus observations, exemplars, counted evidence and later pattern admission |

## Portable pilot generation contract

The social pack now exports `generationPlanSchema` for a store-owned pilot plan.
Each source points to `social/production/sources/<original-sha256>.jpeg.b64`,
names its verification receipt and decoded dimensions, and declares a
1080×1920 `contain-pad` treatment. The runtime must re-read the file, verify
the original bytes and dimensions, then hash the prepared image before an
Action preview. The schema alone cannot verify bytes.

`generation-jobs.ts` separates planned, quoted, approved, submitting,
submitted, succeeded, failed and unknown phases. The platform's existing Action
preview binds the pilot plan, prepared image hashes, exact provider settings
and a maximum credit ceiling before source transfer. The single approved Action
may upload those prepared bytes, record confirmed provider media IDs, obtain an
exact cost-only quote, and submit only if the request is otherwise unchanged,
the quote is current and its maximum is within that ceiling. The resulting
quote hash and Action receipt are stored on the job; they are audit bindings,
not another approval authority. A preliminary settings estimate is never an
exact quote or authorization to spend above the ceiling.

The platform must durably claim `submitting` before the spending call and save
the provider request ID before polling. Any uncertain call enters `unknown`.
Only read-only reconciliation may move an unknown job forward; the contract
allows one submission attempt and has no automatic resubmit transition, even
after quote expiry. New spend requires a new job and a new existing-Action
authorization. The explicit authenticated-run pilot uses the same bounded
Action and durable job contract, with a verified console or scoped MCP request
as its authority rather than a separate artwork preapproval. This contract
imports no provider credentials or renderer.

NeuroGraph persona context remains an optional customer-agent MCP port.
CreativeOutcome remains the proprietary Creative Review port, unimplemented.
Neither is needed to pretend these temporary recipes are empirically proven.

## Verified provider constraints

Official MCP endpoint: `https://mcp.higgsfield.ai/mcp`. It requires OAuth and
uses the signed-in account's credits; developer API billing is separate.
The platform supports the official Higgsfield OAuth connection with
PKCE, one-use state, Vault credential storage and read-only tool re-checking
(`marketing-os-app` PR #18). The owner completed account consent and the authenticated server returned 106
tools. Model contracts and cost-only preflights were inspected successfully; no
live generation was performed.

Sources: [MCP overview](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp),
[agent connection](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent),
[API billing](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api),
[Seedance reference controls](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance).

## Acceptance for “a month is ready”

Every promised slot has its final playable clip or ordered scene assets, final
caption, traceable source/provenance, spend receipt and working review link.
The loop repeats cleanly; all three scene artworks remain faithful. The contact
sheet exposes all failures and repeated directions. A human accepts the pilot
and final creative, and separate channel approval precedes publication.
This release does not yet meet that acceptance. The follow-up motion review
contract now validates MP4/poster receipts, hashes them with final copy, shows
user-controlled loop playback and a direct asset link, and blocks scheduling or
publishing until a video channel adapter exists. Actual generation, trusted asset
binding and automated Reels publication remain unimplemented. The store inventory has expanded from three to twelve verified
flat sources. The larger-pool rehearsal plans twelve slots, but includes repeated
artworks/groups and needs editorial review before it is a production schedule.
Account connection work lives in the platform repository (`docs/HIGGSFIELD-MCP.md`).


## As-built launch checkpoint

| Capability | State |
| --- | --- |
| Full-artwork sources | Twelve active catalog works verified against AMS originals and inspected flat derivatives; the Passion Flower pilot source is staged as content-addressed bytes and its complete composition is verified and padded before review |
| Monthly planning | Twelve new slots, 6/3/3 recipe mix, source-compatible groups, current catalog/graph facts, existing post protection and repeat warnings |
| Copy | Current brand and concept formulas plus cited writing facts and three pilot caption treatments; final month captions are not yet authored |
| Paid Higgsfield connection | OAuth deployed and owner connected; 106 tools discovered; settings preflight verified |
| Final video review | MP4/poster/source receipt validation, approval hashing, playback and direct asset link implemented; no generated clip bound yet |
| Generation execution | Governed one-loop Action, exact post-upload quote check, durable job phases, single submission and status polling are implemented and deployed; no pilot upload, submission or credit spend has occurred |
| Publishing | Existing still/sequence gate retained; video scheduling and publishing explicitly refuse until the video adapter exists |

Core implementation: PRs #92 (recipes), #93 (video review), #94 (coherent groups),
[#98](https://github.com/Avant-Garde-AI/marketing-os/pull/98) (portable job/input contract)
and [#100](https://github.com/Avant-Garde-AI/marketing-os/pull/100) (service route middleware).
Store implementation/data: marketplace PRs #171–#176, including
[#175](https://github.com/Arthaus-Inc/marketplace/pull/175) (staged pilot)
and [#176](https://github.com/Arthaus-Inc/marketplace/pull/176) (middleware).
Platform OAuth: marketing-os-app PR #18; governed execution:
[#21](https://github.com/Avant-Garde-AI/marketing-os-app/pull/21).
The account connection and production execution seam are deployed. At that
checkpoint the next step was to review and approve the waiting Passion Flower loop proposal, generate and inspect its
actual output, then accept one loop, one real-home scene and one imagined-world
scene before a budgeted month batch. Planning artifacts and the staged pilot
source are neither imagery-spend nor publish consent.


## Live follow-through after account consent

The expanded inventory and coherent-group planner were verified together on the
Arthaus production MCP on 2026-09-28: 12 planned, 0 blocked, 6/3/3 mix and the
existing October 7 post preserved. The inventory SHA-256 was
`22e27760f63c70cfa95da01f719a4556617fc4947917c1fe3ebd5b771e195217`.
The botanical graph query returned duplicate handles and was rejected; source
acquisition retained that diagnostic and used the curated live-catalog path.
This is a successful fallback, not a clean graph-query result.

Authenticated Higgsfield inspection established actual `start_image` and
`end_image` roles for `kling3_0` and `wan3_0`, and `image_references` for
`gpt_image_2_5`. Upload requires confirmed provider media IDs. No source upload
or generation has happened. Same-image boundary references need a deliberate
fit/padding step to keep the whole composition, and do not prove loop continuity.

Cost-only settings preflights returned 7.5 credits for a 5-second standard silent
Kling clip, 17.5 for a 5-second 1080p silent Wan clip, and 2.75 for a high-quality
2K GPT Image 2.5 scene. One loop plus two scene images therefore starts at 13
credits (23 with Wan); one output for each of the 12 planned slots starts at
61.5 (121.5 with Wan), before retries or extra carousel views. These are planning
estimates, not an approved spend ceiling, exact creative quote or quality claim.

The platform's read-only `/api/broker/higgsfield/preflight` seam keeps OAuth
credentials server-side, accepts no arbitrary tool or generation settings and
forces cost-only requests. Its result is explicitly ineligible for approval.
The governed Action preview instead binds the verified source and prepared-image
hashes, prompt, caption, fixed provider settings and a maximum credit ceiling.
After human approval, its execute path uploads the prepared image, obtains the
exact quote with the confirmed provider media ID, checks that quote against
the approved ceiling and submits once. Unknown outcomes enter reconciliation
without automatic resubmission.

## Execution checkpoint after the connected pilot build

As of 2026-09-28, the platform's governed one-loop executor and polling route
are implemented on main (`marketing-os-app` PR #21, commit `50bda75`), migration
`012` is applied, and the production deployment is READY
(`dpl_F9d9m7TtZ9y5DXL1fDLQUanmhYNW`). Platform CI and 53 tests passed. The
open-core contract and template (`marketing-os` PRs #98 and #100) and the
Arthaus staged source and console (`marketplace` PRs #175 and #176) are merged.
The Passion Flower pilot contains its verified full-artwork derivative, exact
source hash, option-B caption, motion direction and contain/pad transform.
The exact pilot prompt settings have a **preliminary 7.5-credit estimate**;
that is not a post-upload quote, approval, charge or completed render.

The execution path can now create a reviewable proposal, carry one approved
source transfer and generation request through durable phases, and poll the
provider without resubmitting an uncertain request. Draft video Reviews are
available. The authenticated Store MCP created one Passion Flower proposal in
`awaiting_approval` with a 7.5-credit estimate and ceiling. Repeating prepare
returned the same job and proposal; status read verified the waiting phase.
The production runtime was READY at deployment
`dpl_GBXuKZ2oucBHwWy212u3cYqXhUxg`. No source upload, provider submission
or credit spend has occurred for this pilot. At that checkpoint, the next
step was human review of the approval card. Final immutable
video asset binding, decoded artwork fidelity and loop-seam review, exact-source
real-home and imagined-world scenes, the month batch, and Instagram Reels
publishing remain open. The month is not ready.

### Authenticated one-loop run update (in development, 2026-09-28)

The owner has removed the separate artwork preapproval requirement for now
when they explicitly request this bounded pilot generation from an authenticated
console or a connected MCP session carrying `generation:run`. The earlier
`awaiting_approval` card remains a historical checkpoint, not the required next
step for this new request path. The platform must record that verified actor in
the existing Action gate, bind the exact source/creative/settings and maximum
credits, obtain the exact post-upload quote within that ceiling, and submit at
most once. An unsigned request, a background turn, a read-only connector, or a
public review link cannot authorize spending. Unknown outcomes still receive
read-only reconciliation only; publishing still needs its own Action.

Open-core and store runtime changes are proposed in
[`marketing-os` #103](https://github.com/Avant-Garde-AI/marketing-os/pull/103)
and [`marketplace` #179](https://github.com/Arthaus-Inc/marketplace/pull/179).
The pooled hosted runtime and platform verifier/console handoff must land
together before this can be called a live console path. The platform will return
token-scoped, store-owned one-page review links for generated outputs. No
source upload, generation submission, credit charge or completed clip is
claimed by this update.
See [the platform connection/execution record](https://github.com/Avant-Garde-AI/marketing-os-app/blob/main/docs/HIGGSFIELD-MCP.md)
for provider parameters, transport contracts and the remaining execution work.
