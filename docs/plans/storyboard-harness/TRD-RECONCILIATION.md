# Storyboard harness — research and TRD reconciliation

Status: architecture decision record, 2026-09-20.

This document reconciles spec 33 and its first implementation with the supplied
research report, *Building On-Taste Storyboards and Narratives for an AI Creative
Agent*, and the *Atelier Narrative & Storyboard Sub-Module TRD*. The research is
design input; its literature claims have not been independently audited here.

## Decision

Keep the implementation already proved useful, but place it inside a larger
four-artifact pipeline:

```text
Creative Schema
  -> K Narrative Plans
  -> K Storyboard IRs (beats and shots)
  -> reviewed Render Handoff
```

The current `packages/storyboard` combines the second and third artifacts. That
was enough to prove grounded planning before imagery spend, but it is not the
finished contract. The next architecture revision separates strategic constraints,
narrative choice, shot realization and provider dispatch so each can be reviewed,
versioned and measured independently.

Mastra remains the harness in Marketing OS. Atelier is a protocol and algorithm
reference, not a runtime dependency. Shared contracts may later be extracted,
but Marketing OS must not import Atelier implementation code to obtain them.

## Canonical layers

### 1. Creative Schema

The schema records what must be true before a model proposes a story:

- strategy: persona, scenario, decision factors, objection and funnel stage;
- brand: voice, claims constraints, mandatory and distinctive assets;
- format: channel, aspect, duration, safe zones and caption constraints;
- narrative priors: candidate archetypes and hooks, with provenance;
- beat envelope: required proof and duration, without prescribing realization;
- shot grammar: allowed cinematic vocabulary and continuity rules;
- freedom: dimensions deliberately left open;
- per-dimension control strengths and cold-start status.

Hard constraints are copied from governed sources and validated deterministically.
Archetypes, hooks and beat forms from research are hypotheses until linked to
reviewed corpus exemplars. A researched item carries sources and no count.

The schema is immutable once used. Changes create a new version. It is the unit
for comparing candidate storyboards from the same strategic assignment.

### 2. Narrative Plan

The Director creates at least four parallel plans by default. Each plan contains
premise, payoff, reader question, beat realizations, emotional movement and a
character/setting bible where relevant. Plans vary their narrative mechanism,
not merely wording, layout or palette.

The Director receives different, logged exemplar subsets and explicit freedom
dimensions. Candidate diversity is measured before ranking. A run that collapses
below its configured diversity floor is a failed exploration, even when every
candidate is individually competent.

This changes the current one-call `planStoryboards` shape. The present three-way
planner remains a valid prototype; production should separate Director output
from Storyboarder output and default to K >= 4.

### 3. Storyboard IR

The Storyboarder realizes one plan as ordered beats and ordered shots. Beats own
meaning: assertion, proof, information change and narrative function. Shots own
presentation: subject, action, framing, angle, movement, time range, text/voice,
asset bindings and continuity bindings.

Every shot references exactly one beat; every beat has at least one shot. This
allows a single narrative beat to require multiple images or cuts without
pretending each frame is a new narrative event.

The renderer boundary remains intact. Core Storyboard IR may express provider-
neutral render intent, but it does not name Flux, LTX, Higgsfield, Penpot or any
other backend. Provider choice, prompts, seeds and cost quotes belong in a
separate Render Handoff owned by the existing governed action path.

### 4. Review and learning

Three judgments stay separate:

1. deterministic structural validation gates hard constraints, evidence,
   continuity, beat/shot coverage and format;
2. an independent narrative/novelty editor supplies advisory reasons and may
   eliminate a proposal, but is not treated as calibrated taste;
3. humans provide the authoritative pairwise preference and edit signal.

A future performance critic ranks structurally valid candidates. It does not
gate alone and is not an RL reward. It is admitted only after beating an
off-the-shelf aesthetic baseline on held-out outcome prediction and meeting a
predeclared human-agreement gate. Until the label store and those evaluations
exist, model scores are review aids rather than performance claims.

## Taste and evidence

Taste is a versioned, tenant-partitioned dataset. A taste snapshot contains
approved exemplars, rejected candidates with reasons, a human-readable taste
profile, and retrieval metadata. Writes are append-only; rejection is a label,
not deletion. Every plan records the snapshot and exemplars it used.

Reference conditioning and retrieval precede adapter training. No brand adapter
is trained merely because enough raw images exist: the inputs must be curated,
tagged and rights-appropriate. Any adapter experiment must reproduce from a
snapshot and pass both training-copy and diversity gates.

Cross-tenant brand material never enters a shared adapter. Cross-client priors
may be shared only as aggregate taxonomy statistics with their provenance and
authority explicitly defined.

## Corpus extraction and modeling

The corpus and the research serve different evidence lanes.

### Research lane

The supplied report contributes candidate vocabulary, critic dimensions,
evaluation protocols and architecture hypotheses. Its assertions are stored as
researched propositions with citations. They never acquire `n`, engagement
support or observed status through summarization.

### Visual observation lane

Actual complete posts are inspected without engagement in the model prompt. The
extraction contract is revised before a large run. It separates observation from
interpretation:

1. **Frame observation** — visible subjects, text, composition, treatment,
   geometry and source fidelity for every attached frame or video sample.
2. **Transition observation** — what visibly appears, disappears, repeats,
   reframes or changes between adjacent items.
3. **Narrative annotation** — proposed beat function, hook mechanism,
   information delta, tension/reveal/payoff relationship and continuity device,
   each grounded in frame and transition observations.
4. **Post representation** — narrative mechanism, emotional-curve hypothesis,
   treatment vector, format, completeness and provenance hashes.

Observation and annotation are separate so a model cannot turn a plausible
interpretation into a claim about pixels. Geometry remains an independent cheap
feature group. Engagement is joined only after extraction and normalized within
comparable artist, format and time cohorts; it describes association rather than
causation.

Cluster after extraction, using multiple feature views rather than one embedding:

- narrative mechanism and ordered transition types;
- visual treatment and composition;
- hook and proof placement;
- continuity devices and pacing;
- format and completeness.

Rare structures and outliers remain searchable. Cluster review includes both
exemplars and counterexamples. Only a human-reviewed cluster can emit a counted
pattern, and its count is unique complete posts rather than frames or reposts.

### What runs now

Do not extract all 1,332 saved single images with the pilot prompt. The pilot
proved transport, provenance, schema validation and resume, but its prose output
is too shallow for the target ontology.

After the revised extraction contract is implemented:

1. calibrate on 30–50 stratified single images to test treatment, implied-story
   and process/promotion distinctions;
2. reacquire 20–30 complete carousels across artists, formats and performance
   levels, then calibrate ordered transition and narrative annotation;
3. add a separately reported video sample only after temporal sampling and
   completeness rules are fixed;
4. freeze an extraction version, then use bounded batch inference for scale;
5. review and cluster before emitting any production pattern library.

The 3,020 carousel covers and 2,601 video posters in the field cohort are useful
for reacquisition identity and cover analysis, but cannot support arc evidence.

## Current implementation disposition

| Current capability | Disposition |
| --- | --- |
| Beat assertions, transitions, evidence and visual briefs | Keep; become the semantic half of Storyboard IR |
| Asset provenance and bare-master refusal | Keep as a hard structural constraint |
| Bound continuity | Keep; extend from beat-level constants to shot-level bindings |
| Three parallel storyboards | Preserve as prototype; move to separate Director/Storyboarder stages and K >= 4 default |
| Model-backed narrative/novelty critic | Keep as advisory independent editor; do not call it calibrated taste or performance |
| Multimodal visual critic | Keep for visible brief compliance; add whole-sequence continuity review |
| Reviewed context manifest | Keep as the first explicit taste/pattern snapshot; evolve rather than hide it behind premature retrieval infrastructure |
| Offline whole-post runner and ledger | Keep; revise output schema and add complete-media acquisition before scale |
| `evidence.n` counted-post semantics | Keep unchanged |
| Renderer-free core package | Keep unchanged |

## Work sequence

1. Specify and test `CreativeSchema`, `NarrativePlan`, shot-level Storyboard IR,
   Render Handoff and version/provenance contracts.
2. Split orchestration into Director, Storyboarder, structural gate and patch-only
   Reviser, stopping at human plan review before imagery spend.
3. Revise corpus extraction to the observation/annotation contract and run the
   two calibration slices above.
4. Define a versioned taste snapshot and pairwise review record; capture decisions
   from the first real Arthaus review rather than inventing labels.
5. Implement provider dispatch only through the existing quote/review/Action gate.
6. Defer adapters and a performance critic until curated data and outcome labels
   satisfy their gates.

## Decisions still requiring product evidence

- Taxonomy ownership: begin with versioned IDs in the storyboard package and
  promote stable, outcome-bearing archetype/hook terms into NeuroGraph. Declaring
  the full vocabulary centrally before calibration would freeze research priors
  as product truth.
- Review artifact: plan review is mandatory before imagery; IR plus keyframes is
  required before render/publish approval. Keyframes alone are insufficient.
- Performance labels: Bonnard/Axon field availability and granularity must be
  audited before designing the critic feature table or promising Stage 4.
- Bare artwork masters remain a hard prerequisite for any mockup-input path.

