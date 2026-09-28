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
   alternatives and estimated credit ceiling. Existing Action approval binds
   source/brief/model/quote hashes. Reuse selection governance; do not add a
   parallel authority system or treat a public review token as consent.
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

NeuroGraph persona context remains an optional customer-agent MCP port.
CreativeOutcome remains the proprietary Creative Review port, unimplemented.
Neither is needed to pretend these temporary recipes are empirically proven.

## Verified provider constraints

Official MCP endpoint: `https://mcp.higgsfield.ai/mcp`. It requires OAuth and
uses the signed-in account's credits; developer API billing is separate.
Actual tenant registry inspection on 2026-09-28 found Store and Picasso
Concierge only. The platform now supports the official Higgsfield OAuth connection with
PKCE, one-use state, Vault credential storage and read-only tool re-checking
(`marketing-os-app` PR #18). Live public-client registration succeeded. The
Arthaus account still needs owner consent before its tool schemas can be
inspected. No live generation was performed.

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
| Full-artwork sources | Twelve active catalog works verified against AMS originals and inspected flat derivatives; automatic scoped upload/resolution still to build |
| Monthly planning | Twelve new slots, 6/3/3 recipe mix, source-compatible groups, current catalog/graph facts, existing post protection and repeat warnings |
| Copy | Current brand and concept formulas plus cited writing facts and three pilot caption treatments; final month captions are not yet authored |
| Paid Higgsfield connection | OAuth implemented and deployed; owner account consent pending |
| Final video review | MP4/poster/source receipt validation, approval hashing, playback and direct asset link implemented; no generated clip bound yet |
| Generation execution | Provider schema inspection, quoted Action, job persistence/reconciliation, source transfer and output verification remain to build |
| Publishing | Existing still/sequence gate retained; video scheduling and publishing explicitly refuse until the video adapter exists |

Core implementation: PRs #92 (recipes), #93 (video review), #94 (coherent groups).
Store implementation/data: marketplace PRs #171, #172, #173 and #174. Platform
OAuth: marketing-os-app PR #18. The account connection is the next external
dependency. After consent: inspect actual tools and quotes, implement the
governed execution adapter, accept one loop/home/world pilot each, then run a
budgeted monthly batch and send final assets plus captions to the existing review
page. None of the planning artifacts constitutes imagery-spend or publish consent.
