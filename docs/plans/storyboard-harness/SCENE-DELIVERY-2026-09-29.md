# Exact-artwork scene delivery

## Purpose and scope

Deliver the owner-requested Moroccan courtyard, forest gallery and space
observatory treatments into the existing token-scoped social review room.
Each treatment contains three distinct verified full artworks, a caption with
verified artist handles, and a 1080×1350 JPEG. These are three single-image
pilots; neither a multi-slide carousel nor a generated month is claimed.

The creative recipe is a launch hypothesis. No corpus-derived engagement lift
or proven archetype is claimed. Corpus admission and extraction remain the
separate research lane documented in the storyboard plan.

## Ownership

- Open core: three-source plan validation, byte verification, ordered source
  contact sheet, perspective compositor, delivery receipt and signed review.
- Platform: OAuth, fixed Higgsfield profile, exact quote, actor-bound Action,
  tenant journal, at-most-once submission and result polling.
- Store: artwork masters and receipts, curated subject grouping, scene briefs,
  artist/caption evidence, frame-opening placements and final delivery records.
- Dataset/knowledge layer: provenance and admitted patterns; this pilot does
  not manufacture exemplar counts or turn the temporary recipe into evidence.

## Generation and realization

1. `collection-scene` plans require three distinct source references, verification
   receipts and content hashes. Each full, unframed JPEG is verified against its
   dimensions and bytes. The transform is 1080×1350 contain-pad.
2. The input reader creates a left-to-right contact sheet and binds its hash with
   the plan into the existing input hash. This sheet proves source selection;
   it is not uploaded to the image model.
3. The platform chooses `social.collection_scene_generate`. GPT Image 2.5,
   Flare/high/2K/4:5/count=1 generates one environment with three empty frame
   openings. The exact quote must fit the caller's ceiling. No automatic retry.
4. A succeeded provider job is a **background**, not a finished social post.
   Inspect its geometry and record each inner opening as normalized
   top-left/top-right/bottom-right/bottom-left coordinates. Do not accept
   occluded or unusable openings merely to complete the pilot.
5. A store delivery receipt binds artifact ID, post ID and immutable input hash,
   final caption, background SHA-256 and three source-ref placements. A loop may
   use a caption-only receipt without changing the generation input or spending.
6. The deterministic compositor contains each full artwork on a neutral mat,
   then perspective-warps it into its opening. It does not redraw the artwork.
   Input size, orientation, geometry, distinctness and overlap are checked.
7. A token-scoped GET rechecks the post, known provider result, receipt and source
   bytes, downloads only allowlisted provider media without redirects, verifies
   the background hash and returns a 1080×1350 JPEG. It has no spending authority.
8. The room and month sheet show completed composites and amended captions.
   Missing or invalid placement receipts remain explicitly unfinished; provider
   backgrounds cannot silently appear as final artwork.

## Authorization and acceptance

An explicit bounded request from the authenticated owner console/MCP can execute
through the existing Action gate without another artwork preapproval. Public
review tokens only permit review. Publishing and scheduling remain separate.
Unknown provider outcomes require reconciliation, never resubmission.

For this pilot, inspect all three complete artworks, frame alignment, visual
scale, matting, composition, caption credits and mobile review. Three accepted
single images unlock a repeatable scene template; they do not establish fully
automatic frame localization. Scaling a month still needs automated placement
prediction with rejection, carousel sequencing, per-slot budgets and final
review. Loop fidelity/seam acceptance and video publishing also remain open.

## Verification and live checkpoint

Contract tests cover source substitutions, distinct receipts, landscape/canvas
mismatches, cross-mechanic Actions, exact quotes, no scene upload, at-most-once
submission, perspective geometry and signed media delivery. Store runtime
TypeScript and the platform Higgsfield suite are required before deployment.

The connected account returned 2.75 credits per exact scene prompt (8.25 total)
on 2026-09-29. At this documentation checkpoint, no scene has been generated.
Append live provider IDs, actual spend and QA to the store receipt after the
production run; never infer completion from mocks or a quote.


### Live integration correction

The first production scene request stopped before job creation because the
Wildflowers source is a 4 MB base64 file. GitHub Contents returns `encoding: none`
and empty content above 1 MB. StoreRepo must retrieve that same API path as raw
media, with a bounded response, and match the metadata blob SHA before decoding
the source. The JPEG SHA-256 and scene input checks still apply. A missing
inline body is not an empty artwork, and recompressing the verified master is
not the fix. The unchanged prompt still quotes at 2.75 credits through the
production provider client.


### Actual scene results

All three pilots completed through the authenticated Store MCP and platform
Action gate: three submissions at 2.75 credits each, 8.25 total confirmed by the
357 → 348.75 balance change. Provider backgrounds were 1792×2240 PNGs;
source-preserving composites are 1080×1350 JPEGs with artist-credited copy.
Core #109/#110, platform #45 and store #190/#191 are merged; store #192 records
placements and final result receipts for the existing signed room/month UI.

See [the store's live pilot record](https://github.com/Arthaus-Inc/marketplace/blob/main/agents/social/production/SCENE-PILOT-2026-09-29.md)
and [job, cost and hash receipts](https://github.com/Arthaus-Inc/marketplace/blob/main/agents/social/production/SCENE-RESULTS-2026-09-29.json).
These are three single-image drafts for human review. The existing loop also
now has its verified artist handle without changing the paid input.

The generated observatory has landscape frames, so full portrait artwork uses
wide side mats. The next prompt must specify opening orientation from the
selected source dimensions. Do not silently crop art or spend on a reroll to
hide that result. Frame coordinates were inspected manually; full month
execution still needs reliable localization/rejection, durable final-media
promotion, carousel sequencing when appropriate, bounded slot budgets and
creative acceptance. Nothing in this pilot publishes or schedules a post.
