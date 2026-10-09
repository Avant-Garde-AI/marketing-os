# Social roadmap refresh — October 9, 2026

This checkpoint supersedes the immediate ordering in the [October 7 roadmap](OPERATOR-NARRATIVE-ROADMAP-2026-10-07.md), while preserving its creative goals and deferred customer adapters. The review/scheduling baseline is operating; prioritize narrative development, observed output quality and evidence-backed learning. Do not restart the planner, approval gate or research client.

## Source and production baseline

Read-only audit on October 9:

| Surface | Verified revision or observation |
| --- | --- |
| Open-core `main` | `7030959`; new console/email/social increments are PRs #126–129 |
| Arthaus store `main` | `af24d6b`; relevant loop and workflow increments are PRs #233–238 |
| Arthaus agent production | Vercel `dpl_9AJJsTMw5RKWYezPojRGEpTMxFg6`, Ready, created October 9 at 11:56:28 America/Chicago; source `1cd6426a6d5853a9fa4724aa07f658f196534f72` (#238) |
| Source/deployment difference | No `agents/` difference between deployed source and store `main`. Later #239 changes the storefront theme, not this agent; it does not require an agent redeploy. |
| Live October Social board | 27 posts: 7 drafts, 5 ready, 8 scheduled, 7 published, 0 attention, 0 closed |
| Remaining approved releases | October 10–17, 10 a.m. America/Chicago |
| Pooled hosted runtime `main` | `f7a02d1`; lacks the new post decision component, owner edit route and scheduling route. Arthaus delivery does not establish platform-wide parity. |
| Platform control plane `main` | `a147c79`; MCP OAuth/store-token improvements are separate from creative quality and social library admission. |

The [live board](https://www.arthaus.cloud/social?month=2026-10) exposes published receipts/permalinks for the October 8 Reel and October 9 carousel. These are console/artifact observations; this audit did not repeat the direct Instagram API checks recorded on October 7. No paid research, generation, post edits, approval decisions, schedule changes or deployments were performed.

## What the improvements retire, and what they do not

| Capability | Current state | Roadmap consequence |
| --- | --- | --- |
| Legible lifecycle and calendar | Staged worklist, final media, history/permalinks and Scheduled + published default shipped October 7 | Treat as the baseline; extend with outcomes and recovery rather than redesigning statuses. |
| Final post decision | One signed-in decision bar, inline caption/time edits and Approve & schedule shipped in core #128 / store #237 | Final copy/date control is delivered. Use this surface for future storyboard context and quality results. |
| Safe edits to approved posts | Changed caption/time removes scheduling consent; media remains bound and receipt hashes update. Published posts are immutable through this editor. | Reuse existing invalidation/gate semantics. This is not a complete creative revision graph or a beat/visual editor. Storyboard-origin copy still requires agent revision. |
| Artwork-loop direction | Three named beats, visible motion instructions and duration-free copy; generation input rejects specified weak-motion language/missing beat labels. October 10 uses the reviewed `oct26-10-loop-v3` replacement. | A recipe and prompt check are implemented. They do not establish visible motion, seam continuity, fidelity, reader interest or engagement. |
| Narrative planning and critics | `packages/storyboard` already proposes three arcs, checks bindings, runs independent critiques and returns review material; runtime exposes storyboard and graph planning tools. | Build the operator workbench over these contracts. Do not describe the planner/critics as missing or rebuild them. End-to-end creative acceptance and generated sequence QA remain open. |
| Gemini research foundation | Brand Soul tools, Interactions client, research job storage and cron polling already exist in template/store. | Extend and govern the existing capability for targeted social research; a second generic client/poller is unnecessary. A social research-to-exemplar-to-planner workflow is not delivered. |
| Monthly generation | Current calendar, recipes, delivery receipts and approval path support the live batch. | Budgeted resumable production with diversity, accepted yield and recovery is still a separate deliverable; repeatable jobs alone do not prove narrative variety. |

The email improvements provide a useful interaction pattern: inspect what goes out, edit essentials in place, then make one explicit decision. Social should preserve its own ordered slides/video and story context while sharing the gate and editing conventions.

## Revised delivery sequence

### 1. Establish generated quality and outcome feedback

First evaluate the new loop against the earlier near-still results. Record visible change across the three beats, seam continuity, exact-artwork fidelity and readability on a phone. Inspect actual output, not only the prompt. Keep failed/rejected examples and reasons. Add a sequence QA record before binding future generated assets; one frame or successful provider completion is insufficient. Do not silently regenerate or replace already approved releases.

In parallel, collect outcome snapshots for exact published post/media/recipe revisions and surface delivery/credential failures. Include available reach, saves, shares, comments and Reel measures; unavailable values remain explicit. Use fixed observation windows and compare like formats. Seven published posts are early observations, not evidence that either recipe is a proven engagement winner.

Acceptance: an operator can see whether the generated story survived realization and what its published result was. A failed quality review proposes a scoped repair with a budget; it never grants spend or publishing authority.

### 2. Connect the narrative workbench to final review

Reuse existing storyboard/graph tools and review artifacts. Add a persisted operator brief, three distinct directions and readable beat-by-beat comparison on Social. Show what beat two adds, why an alternative was eliminated, source support versus hypotheses, feasibility and expected generation cost. Retain direction choices and feedback against exact versions.

Support scoped instructions: preserve the room and framing; revise only the reveal; keep the artwork exact; make the payoff less literal. Copy/date controls are already delivered; implement semantic/visual dependency invalidation and repair beyond them. Preserve earlier approvals and published records as history. Permit delegated storyboard selection only within an explicit scope and budget, without reintroducing redundant artwork pre-approval.

Acceptance: an operator can describe a story, compare alternatives before imagery, improve a specific beat and follow the selected version through final media to the existing approval/schedule decision.

### 3. Calibrate narrative families from targeted research and pixels

Reuse Brand Soul's Gemini Interactions plumbing where appropriate. The current client directly submits from a model tool using the runtime API key; social paid research needs the platform's approved scope/budget path and suitable credential ownership before extending that dispatch. Validate account access, usage limits, recovery/cancellation and immutable research inputs; source presence is not a successful production research run.

[Google's current documentation](https://ai.google.dev/gemini-api/docs/deep-research) confirms background Interactions research and collaborative planning. Use collaborative planning to make the category question reviewable; retain cited reports separately from observable media evidence. This checkpoint did not exercise either provider mode.

Start with a bounded contrast sample covering art marketplaces, artists and home/interior brands. Acquire complete carousels/videos from selected examples, extract observed hooks/transitions/payoffs, adjudicate patterns and admit supported moves to the reviewed library and planner context. Reconcile with the supplied research/TRD against real examples. Preserve whole-post evidence and outliers; a report does not become counted evidence, and public likes do not establish causality.

Acceptance: the planner can cite inspected examples for a repeatable move and faithfully instantiate it using graph/catalog subjects. Unsupported directions remain explicitly labeled hypotheses. No model automatically admits its own findings.

### 4. Expand production after quality and evidence gates

Build budgeted, resumable monthly production over existing subject selection, recipes, receipts and batch review. Rotate narrative arguments as well as artworks, scenes and formats. Candidate expansions include detail → whole → relationship; a surprising pair with an explained connection; curatorial comparison; approachable home → imagined counterpart. Exact masters, artist attribution and theme fit remain prerequisites.

Track cost per accepted post, creative yield, diversity and repair frequency. Stage small experiments before widening cadence or formats. A month of prepared posts still needs explicit scheduling consent through the existing gate.

Acceptance: a batch resumes safely, respects budget and existing schedules, and produces materially different reader experiences with traceable evidence and quality decisions.

## Rollout and cleanup alongside those slices

- Port the delivered template increment to pooled hosted agents with per-request tenant context, broker credentials and service-only gate execution intact. Verify parity against a representative tenant; do not copy single-store assumptions.
- Reconcile stale concept metadata: Arthaus `agents/social/concepts/artwork-in-motion.md` still marks video blocked because acquisition/Higgsfield are “not yet deployed,” despite the working production recipe. Correct availability independently of evidence admission: the concept remains brand-derived with zero counted exemplars unless inspected evidence supports a change.
- Correct docs that describe Gemini research as wholly unimplemented. The generic foundation exists; targeted social scope, governed spend, reviewed visual evidence and planner consumption remain the work.
- Keep reusable planning/QA/revision contracts in open-core; Arthaus catalog/theme/voice/cadence in store `agents/social/`; counted exemplars, source provenance and admission rules in the corpus/library layer. Customer persona MCP and proprietary Creative Review adapters remain deferred optional seams.

## Evidence and verification limits

The audit fetched remote `main`, used clean assessment branches, inspected deployment metadata and live read-only console states, and compared relevant source paths. The scheduled October 10 page visibly offers Change time and Edit caption and states that approval will publish automatically. New code was not executed locally and generation quality was not independently adjudicated during this audit. Documentation changes require link/path and diff checks, not a repeat of unrelated application tests.

Useful source paths: core `packages/storyboard/README.md`; template `components/review/post-decision.tsx`, `lib/social/owner-edit.ts`, `app/api/social/post-edit/route.ts`, `app/api/social/scheduling/route.ts`, `lib/social/generation-plan.ts`, `src/mastra/tools/storyboard.ts`, `src/mastra/tools/brand-soul.ts`, `src/mastra/brand/deep-research.ts`, `app/api/cron/research/route.ts`; store `agents/social/posts/2026-10-10-instagram-loop/post.md` and `agents/social/concepts/artwork-in-motion.md`.
