# Social operator workflow, narrative quality and category research

**October 9 checkpoint:** [Roadmap refresh](ROADMAP-REFRESH-2026-10-09.md) supersedes immediate ordering and records delivered caption/time edits, one-click scheduling, three-beat loop direction and the hosted parity gap. Correction to the original research description below: a generic Brand Soul Gemini client, tools, job storage and poller already exist; targeted social research, governed scope/budget and reviewed visual-pattern consumption remain planned.

Owner direction, October 7, 2026: make publication state legible, prioritize narrative/format/end quality, and help operators describe, envision and improve stories. Continue reliability, measurement, monthly production and corpus work. Customer persona MCP and proprietary Creative Review adapters remain deferred; preserve their empty optional seams.

## Implemented console increment

The Social worklist reads post artifacts and separates Draft proposals, Ready for review, Scheduled, Published, Needs attention and Closed, with counts and previews. `proposed` means an editorial draft, not a pending gate approval. `asset_ready` means prepared media awaiting publishing consent. Creative approval alone does not authorize a send. Unresolved attempts, failed sends and schedules overdue by more than 15 minutes have a visible attention lane; this is a display classification, not a cancellation or retry.

Cards link to final-media review, full post details, published permalinks and the existing chat's story-refinement entry point. Post details show actual videos or all carousel slides, readable lifecycle explanations, local release/publication times and delivery records. “Develop a story” and “Improve story” prefill a brief for the existing agent; these shortcuts are not a completed structured brief editor, revision service or new research integration.

The shared calendar defaults to Scheduled + published, offers Scheduled only and All work, preserves the selected mode during month navigation and reports visible/total counts. A planned date never admits a proposal to the default view. Previously published records remain visible as history. This is a filter over the rebuildable index; files, consent and the existing publishing gate remain unchanged.

## Prioritized delivery slices

| Order | Slice | Deliverable and acceptance |
| --- | --- | --- |
| 1 | Operate and measure the live batch | Verify actual scheduled publications against Instagram; durable container/result reconciliation, missed-send and credential alerts, metrics snapshots linked to exact post/recipe revisions. Surface reach, saves, shares, comments and available Reel measures, with unavailable values explicit. |
| 2 | Operator creative workbench | A versioned brief, beat-by-beat shortlist and scoped feedback/edit workflow on the Social/review surfaces. Produce three meaningfully distinct directions; show why one was rejected; approve the selected board before any new imagery spend unless the operator explicitly delegates that selection within a budget. |
| 3 | Category research and corpus calibration | Targeted cited research plus complete-media visual inspection. Admit only reviewed source-supported moves, then wire them into concept/planner retrieval. Benchmark against the currently shipped recipes. |
| 4 | Repeatable monthly production | Budgeted, resumable subject selection, narrative rotation, generation, binding and batch review. Preserve existing schedules, avoid repeated artworks/hooks/scenes and refuse missing masters or weak subject/theme fits. A prepared batch never confers publishing consent. |

Reliability, metric collection and corpus acquisition can progress alongside the workbench. Expansion should be gated by accepted creative yield, artwork fidelity, diversity and cost per approved post, not the raw number of generated files. The two live recipes remain creative hypotheses until measured and evaluated; their operational success is not engagement validation.

## Operator brief and revision contract (planned)

Keep concepts in the existing store-owned `social/concepts/` surface. A brief references a concept revision and adds reader payoff, category/audience context, format/duration or slide count, emotional tone, narrative device, exact artwork/catalog constraints, references, allowed variation, exclusions and spend ceiling. An operator can supply prose and references; the agent compiles them into a readable proposal with missing inputs and factual dependencies surfaced.

Each shortlisted direction shows the hook, what changes at each beat, the final payoff, visual feasibility, exact source support, expected cost and comparison/rejection rationale. Support explicit instructions such as “make slide two a real reveal,” “more surreal but keep the artworks exact,” or “keep this room and change only the payoff.” Feedback can target copy, one beat, selected subjects or visual realization; changed dependencies invalidate only affected downstream work. Existing published/approved versions remain immutable records while a new revision is proposed and separately approved.

Store operator feedback as typed versioned records: accepted/rejected direction, rationale, preserve/change instructions, scoped edits and provenance. These are preferences, not observed engagement. Final review remains one media/caption/date approval surface over the existing gate. Storyboard choice and paid-generation authorization must be visible together without adding a redundant artwork approval.

The generic base agent owns planning, alternatives, critique, bounded repair and ports; the social pack owns format-specific realization and channel contracts. Arthaus owns editorial premises, vocabulary, artwork themes, caption voice and cadence. New formats should first vary the reader argument: detail → whole → connection, surprising pair → explained relationship, curatorial comparison, and ordinary home → imagined counterpart. Vary hooks, transitions and payoffs in addition to environments; unsupported scale/process/history claims must refuse or be explicitly simulated with an approved label.

## Targeted category research (planned)

Research question example: “Which repeatable Instagram narratives are observable among independent art marketplaces and artist-led home-decor brands, and which could be instantiated faithfully from this catalog?” Bound it by category, geography/language, audience context, date range, formats, comparable accounts, explicit exclusions and a budget. Include ordinary examples, not only prominent/high-like accounts.

The provider port should return a cited report with source URLs, observation dates, source/account identity, claimed metric provenance, unavailable denominators, limitations and proposed experiments. A short operator summary identifies candidate reader arguments and the exact examples worth acquiring. Keep web/report claims separate from visually inspected post structure and from this store's observed outcomes. Likes alone cannot establish reach-normalized performance or causality.

Google currently offers a preview [Gemini Deep Research agent](https://ai.google.dev/gemini-api/docs/deep-research) through the Interactions API with background execution and collaborative research planning. The existing Brand Soul client, tools, job storage and cron poller provide a foundation; extend them as an optional social research provider, not a planner dependency. Verify provider credentials and broker support before enabling the social workflow; existing gcloud/Vertex access does not by itself establish this API's credential contract. Retain a provider job ID, immutable input hash, status/checkpoints, deadline, usage and cancellation/recovery state. The existing generic tool dispatches directly; social model-callable submission must propose through the governed action path with explicit scope and budget. No research job, paid run or new credential connection was created by this console increment.

The output pipeline is: research brief → cited candidate report → selected source URLs → acquire complete slides/video → inspect pixels and extract observable beat changes → review/correct → admitted archetype/move with exemplars → graph/catalog instantiation → shortlist/critique → chosen storyboard → final media → review/schedule → observed results. A researched claim never gains `evidence.n`; only unique visually inspected source posts count as exemplars. Provider research text cannot silently populate the counted genome.

The existing corpus pilot remains a starting point, not a complete corpus extraction. First adjudicate the staged patterns and expand a bounded, relevant contrast sample. Then compare source-supported narrative families across artists, preserve outliers, and use account-relative public signals only for prioritization. Review/artifact authority and planner-context wiring are required before the library can influence production. No automatic model admission.

## Evaluation and release gates

Compare new storyboards blindly against the current loop/scene baseline using reader interest, beat-two information gain, payoff, brand fit, source grounding, feasibility and variation across subjects. Retain rejected boards and reasons. Follow selected boards through generated fidelity and human acceptance. For live outcomes, predeclare goals and observation windows, distinguish Reels/carousels and adjust for reach/subject/timing where available; sparse early observations guide experiments, not a winning-archetype claim.

Ship small template-first PRs with the contract/spec correction beside implementing code, then port to the store runtime. Keep provider research experiments, model/brief versions, reviews and outcomes linked to exact artifacts. Customer intelligence adapters are outside these slices until the operator workflow and evidence path are functioning.
