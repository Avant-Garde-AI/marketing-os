# 33 — The Storyboard Harness

> **Forward plan:** [Creative core architecture and implementation](../docs/STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md)
> consolidates the research, current code, corpus findings, contracts, evaluation
> gates and work packages. This spec preserves the diagnosis and implementation history.

> **Status:** Implementation in progress — planning and model-backed critics
> implemented; a three-single-image corpus pilot succeeded. Arc extraction,
> imagery dispatch and human acceptance remain outstanding. §10 records the architecture decisions and their limits.
> **Supersedes, in effect:** the compose half of 24-SOCIAL-MEDIA-AGENT and the
> archetype half of 29-POST-CONCEPTS. Neither is deleted; both become inputs.
> **Depends on:** 22-BRAND-SOUL (brand.md is truth), 23-DESIGN-SURFACES-PENPOT
> (a surface is an artifact, not a PNG), 26-SOCIAL-AGENT-ALIGNMENT (artifacts in
> git), 30-DESIGN-LIBRARY (components are store-owned), 20-CAPABILITY-SUITE
> (writes narrow through one gate).
> **Written:** 2026-09-19, the day three composed posts were correctly called
> trash.

---

## 0. Why this exists

Three posts were composed for one artwork, through three different archetypes,
with a published design library, a live claims guard, and real product data.
All three were boring. Not broken — boring. The owner's words: *"no creativity,
no deep structure or uniqueness: one is just using the framed piece from
Shopify."*

That verdict is correct, and the cause is architectural rather than a bad day
at the keyboard.

### 0.1 The scraped library distilled to rectangles

`social/reference/genome.md` is 2.4 KB and holds seven archetypes. Only two
carry a corpus count (n=32, n=20), and both are generic centred stacks with a
logo — ad furniture from the retail cohort.

**Correction, 2026-09-19.** An earlier draft of this section called the five
`evidence: { n: 0 }` archetypes "hand-written prose turned into boxes",
implying carelessness. That was wrong and unfair to the lane that produced
them. `research/04-genome-emission.md` MANDATES `n: 0` for the artist cohort:

> `evidence.n` is 0 for every archetype. Always. That field means "exemplars I
> counted in a corpus", and this lane counted none. [...] Filling in `n` would
> let a researched claim pose as an observed one, which is the one thing this
> whole chain is built to prevent.

So `n: 0` is a working honesty mechanism, not a defect. The defect is that
nothing DOWNSTREAM reads it: this document's own author used five
zero-evidence archetypes without noticing, because `social_genome_read` serves
them indistinguishably from counted ones. Fix the consumer, not the marker
(see §3.1).

The real problem is narrower and worse than "the archetypes are fake".
`scripts/distill.mjs` extracts exactly `{ role, kind, x, y, w, h }` and says so
— *"the market's register belongs in `doNot`, not in the archetypes."*
Treatment was discarded on purpose. What reached the composer was geometry, and
geometry alone cannot be interesting.

### 0.5 The corpus is not lost, and it is bigger than the genome suggests

Verified 2026-09-19 against `gs://arthaus-creative-corpus/` (project
`arthaus-us`). The raw acquisition is intact. The distillate is thin because
the funnel lost almost everything, not because little was gathered.

**Paid ads — clustered, and the clustering nearly all drained away:**

| stage | count |
|---|---|
| ad images stored | 393 |
| classified `designed_ad` | 261 |
| fed to layout-synth | 198 |
| **quarantined (unparseable)** | **66** |
| instances clustered | 132 |
| coverage — instances landing in a kept cluster | **39.4 %** |
| **canonicals kept** | **2** |

`min_cluster_size` was lowered from a configured 15 to 7 to get even those two,
and the run's own note says so: *"canonicals from a small corpus are weaker
evidence — check member_count before relying on one."* The provider was real
Vertex rather than the mock (77 distinct zone types; the mock emits exactly 2),
so parse quality is genuine — there was simply not enough of it.

Both surviving canonicals are `centered_stack`. That is the entire reason the
genome offers nothing but centred stacks.

**Organic posts — never clustered at all:**

| | |
|---|---|
| artists | 40, across four follower tiers (100k+, 20-100k, 5-20k, Society6 field) |
| posts | 923, every one with engagement |
| **carousels** | **345** |
| **video** | **179** |
| single image | 399 |
| engagement (likes+comments) | median 320 - p90 5,478 - max 637,451 |

This is the material a NARRATIVE harness actually needs — 524 multi-frame posts
by working artists, with a performance signal attached — and layout-synth never
touched it. It went to the researched-dossier lane and came back as prose.

**Correction from direct bucket inspection, 2026-09-19:** the table above is
only the 40-artist pilot. `instagram-organic/2026-09-01/field-cohort/` also
contains 504 account records, 6,958 post rows (6,947 unique shortcodes), and
6,927 saved JPEG objects. Its rows comprise 1,337 `Image`, 3,020 `Sidecar` and
2,601 `Video` records. This broader cohort includes adjacent accounts; it must
not be described as 504 verified working artists.

The blanket claim that all organic pixels need re-pulling was wrong. The field
cohort has durable images. However, its records contain only one `imageFile`
per post, no carousel children and no video stream: a saved cover cannot prove
an arc. Inventory matching finds 1,332 single-image rows with saved pixels;
32 rows across all formats lack a saved-image reference. Deduplicate by post identity
before counting evidence. Expiring CDN URLs remain an acquisition problem for
missing slides and video, not a reason to discard the saved single images.
See §10.7 and the pilot report for execution and coverage limits.

### 0.2 Creative intent died in prose

`work-detail`'s own description reads:

> A close crop — paper texture, a frame edge, the shadow line. Editorial
> intimacy, used as a pause between rooms.

Its slot list is one full-bleed rectangle. Nothing in the pipeline reads that
sentence. So a composer handed a whole framed product render fills the rectangle
with it and produces the exact opposite of the intent — a catalogue shot where
an intimate crop was specified. **An archetype whose creative direction is
unreadable to the thing that composes it is decoration.**

### 0.3 There is no taste anywhere in the loop

The current path composes ONE candidate and ships it. No exploration, no
rendering of alternatives, no critic, no elimination. No component of the system
has the job of looking at output and saying *this is boring*.

A slot-filler cannot be creative. It can only be correct. Correct is what we
got.

### 0.4 What the rest of the industry already knows

`Avant-Garde-AI/creative-agent` (Atelier) solved the loop half years-of-effort
ago: a deepagents spine, an Art Director producing a typed IR, a sub-agent
studio (composer, typographer, copy, brand-compliance), then
`explore N → render → critic → eliminate worst → refine` until clear or out of
budget, with provenance on every decision.

**We are not attaching Atelier over MCP and we are not vendoring it.** Decided
2026-09-19. Atelier is an ad-creative harness: its unit is a performing ad, its
critic is trained on conversion, and its loop optimises a single frame. What
this store needs is a NARRATIVE that happens to be rendered — a story arc across
slides or seconds, where the interesting thing is the turn between beats, not
the composition of any one of them. Atelier is the right reference and the wrong
dependency.

Read it for the loop. Build the arc ourselves, on the Mastra harness we already
run, so the governance we already have (claims guard, Action gate, review links,
publish consent) stays in the same process as the creativity.

---

## 1. The thesis

**A social post is a story that happens to be a picture.**

Static or carousel or video, the unit that makes something worth stopping for is
a narrative move: a premise you accept, a tension you feel, a turn you did not
expect, a payoff that resolves it. A single image is not exempt — it is a
one-beat arc whose before and after are implied, and the good ones imply them
hard.

So the central artifact is not a layout. It is a **Storyboard**: an ordered set
of beats, each carrying what it MEANS before anything about how it looks.

Layout re-enters late and subordinate. Generative imagery is called as a
SERVICE, per beat, from a brief the orchestrator wrote — never as the first
move, and never asked to invent the idea.

### 1.1 The pipeline, stated once

```
KNOWLEDGE            brand.md · genome · concepts · copy formulas · prior posts
    │                (written, versioned, store-owned — the "guided by")
    ▼
ORCHESTRATOR         a deep agent that PLANS, not one that fills
    │
    ▼
STORYBOARD (IR)      beats · arc · continuity · claims · voice
    │                typed, diffable, reviewable BEFORE a pixel exists
    ├──────────────► CRITIQUE  ── narrative critic, not a visual one
    │                           "is there a turn? is the payoff earned?"
    ▼
VISUAL BRIEF         per beat: what the picture must show, feel, and never do
    │
    ▼
IMAGERY SERVICE      Gemini scenes · Veo · AMS mockups · store assets
    │                explore N, not 1
    ▼
CRITIQUE             visual critic — on-brief? on-brand? boring?
    │                eliminate worst, refine, repeat until clear or out of budget
    ▼
COMPOSITION          storyboard + chosen imagery → Design Surface
    │                (Penpot today; canvas/Figma export is a renderer swap)
    ▼
GOVERNANCE           claims guard · review room · Action gate · publish consent
```

Every arrow is a seam that can be tested. The two CRITIQUE stages are the ones
that do not exist today, and they are the reason the output is dull.

---

## 2. The Storyboard IR ⟨BUILD⟩

`packages/storyboard/src/types.ts` is the contract. Prose here explains the
decisions; the types are authoritative.

### 2.1 Beats carry meaning before form

A `Beat` has a `role` in the arc (`setup`, `tension`, `turn`, `payoff`,
`coda`), an `assertion` — the one thing this beat says, in a sentence a human
can disagree with — and only then a `VisualBrief`.

The beats array supplies order; role labels describe each beat’s job. They do
not by themselves prove that a semantic turn occurred. A three
slide carousel that runs setup → setup → setup is a catalogue, and naming the
roles catches the simplest structural failure. The narrative critic must still
judge the meaning. Planning now requires `transition.change`, `why`, and
`patternRefs` on every beat after the first; unsupported moves remain hypotheses.

### 2.2 The VisualBrief is instruction, not geometry

The failure in §0.2 was intent stored where nothing reads it. So the brief is
structured and MANDATORY, and it is what gets handed to a generator:

- `shows` — what is literally in frame
- `feels` — the register, in the store's own vocabulary
- `avoid` — what would ruin it (this is where "no wide lens, no low angle"
  lives, and where "not a catalogue shot" finally becomes enforceable)
- `sourcing` — may this be generated, must it be a real store asset, or either

`sourcing` exists because of a live, unfixed bug: every Arthaus product image is
a framed render on a 2048² canvas, so feeding one to the mockup engine yields a
frame inside a frame. A brief that says "bare artwork required" lets the
pipeline REFUSE rather than produce nonsense.

**Correction:** `sourcing: store-asset` alone cannot distinguish a master from a
framed render. `VisualBrief.asset` now names both the ref and intended use
(`as-is`, `detail-crop`, `mockup-input`). The planning inventory declares its
kind and verification source. Mockup input requires a verified bare master;
framed renders remain usable as framed objects or honest crops, never as masters.

### 2.3 Continuity binds frames, not prompts

Learned expensively on the first video test: four individually convincing frames
whose board, surface and light all changed between them read as four unrelated
pictures. Prompt text alone does not hold continuity.

`Continuity` is therefore a first-class field on the storyboard, and the
contract is that a constant listed there MUST be bound as a reference frame or a
fixed asset — not merely mentioned in a prompt string. The validator's job is to
say when that is impossible; the generator's job is to obey.

### 2.4 Claims travel with the beat

The claims guard already refuses a colour the artwork does not support. That
guard currently runs on the caption, at save time. In a storyboard, an assertion
is made per beat and may be visual as well as textual, so `Beat.assertion` and
`Beat.evidence` are where provenance attaches — and the existing guard becomes
one checker among several rather than the only one.

---

## 3. The orchestrator — original design questions (decisions in §10)

This is the piece most likely to be wrong in this draft, and the reason the
scaffold is being pushed before it is finished.

**What is settled:** it plans a whole arc before any imagery exists; it is
guided by written knowledge rather than free-associating; it emits a Storyboard
that a human can read and reject cheaply, before spend.

**What is not settled, and needs a stronger mind than this draft had:**

1. **Sub-agent decomposition.** Atelier uses composer / typographer / copy /
   brand-compliance. A narrative harness plausibly wants
   dramaturge / art-director / copywriter / continuity-supervisor. Unclear
   whether these should be Mastra sub-agents, tools on one agent, or workflow
   stages. The wrong choice here produces either a committee that dithers or a
   monolith that cannot be critiqued.
2. **Where novelty comes from.** Guided by templates and prior posts, an
   orchestrator regresses to the mean — which is precisely the complaint that
   started this. Something must push AGAINST the corpus. Candidates: an explicit
   novelty critic that scores similarity to the last N posts and penalises it;
   forced constraint injection; adversarial "make this boring / now fix it".
   None chosen.
3. **Budget discipline.** Explore-N costs real money per beat (Veo is capped at
   $2/render by owner instruction). Where the branching happens — N storyboards,
   or one storyboard with N images per beat — changes cost by an order of
   magnitude and is unresolved.
4. **How knowledge is actually injected.** brand.md is long. The genome is
   currently worthless (§0.1). Prior posts are few. Retrieval strategy, and what
   to do when the corpus is thin, are open.
5. **How the corpus gets re-distilled — including who orchestrates it.**
   §0.5 establishes that 923 organic posts (345 carousels, 179 video, all with
   engagement) have never been looked at visually, and that the ad lane kept
   39.4 % of what it was given. What is NOT decided, deliberately, is the
   pipeline that fixes it: batch or streaming, one pass or staged, where
   clustering sits relative to model extraction, whether the unit of extraction
   is a post or a beat, and whether this runs inside the Mastra harness or
   beside it as an offline job whose output the harness merely reads. This is
   an orchestration design problem in its own right and is handed over
   unsolved — see §9.

### 3.1 The genome must be re-distilled, not re-acquired

Superseded by §0.5: the corpus is intact, so this is a DISTILLATION problem,
not an acquisition one. Three things follow.

**Cluster the organic corpus.** 923 posts, 345 of them carousels and 179 video,
with engagement attached — and never visually clustered. This is where narrative
structure lives, and where a critic can learn what "worked" means for this
market rather than for advertising in general. The images need re-pulling first
(§0.5), which is an Apify re-run over handles we already hold.

**Extract with a frontier model, not a zone parser.** layout-synth answers
"where were the boxes". The questions a storyboard needs are "what is the arc",
"what does beat 2 do that beat 1 did not", "why is this worth swiping" — and
those are read from the images and captions together, by a model, not by
geometry clustering. Keep the geometry pass; it is cheap and it grounds
composition. It is simply not the interesting half.

**Fix the funnel before blaming the corpus.** 66 of 198 ads quarantined and
39.4 % coverage means the ad lane discarded roughly two thirds of what it was
given. A distillation that keeps a third of its input and then lowers its own
cluster-size threshold to find two patterns is reporting weakness accurately;
the honest response is to raise yield, not to re-scrape.

Until then the orchestrator has no template knowledge worth having, and
`social_genome_read` now defaults to `minEvidence: 1` and refuses to serve a
zero-evidence archetype unless explicitly asked for with `minEvidence: 0` — which is what would have stopped this document's author
using five of them. Explicit inclusion returns an uncounted-hypothesis warning.
When no archetypes qualify, honest register and copy guidance remain available;
`available: false` means no eligible layout, not that the prose disappeared.

### 3.1b Retirement remains an option

If the re-distillation in §3.1 does not yield archetypes with real member
counts and a stated reason they work, retire the genome rather than keep a
weak one on life support: reduce it to `register` and `doNot` — the parts that
were always prose and are honest as prose — and let a real pattern library
supply structure. Atelier's Crello store and graph retriever are the reference
for what that looks like.

What must not continue is the current state: four rectangle lists serving as a
design system, with nothing telling a reader which of them were counted.

## 4. Critique (implementation update in §10)

Two critics, deliberately separate, because they fail differently.

**Narrative critic** — reads the Storyboard, no pixels. Is there a turn? Does
the payoff pay off the setup? Would a reader who saw only beat 1 want beat 2?
Cheap, runs before any spend, and kills the catalogue-in-disguise.

**Visual critic** — reads rendered candidates against the brief. On-brief?
On-brand? And the question nothing currently asks: **is this boring?**

Both return a `Verdict` with a `kill` boolean and reasons. The loop eliminates
the worst and refines. A critic that can only say "fine" is not a critic, so the
interface requires reasons on a pass as well as a fail.

**The scaffold ships interfaces and a deliberately trivial reference critic.**
Any real implementation is downstream work, and a plausible-looking stub critic
that always passes would be worse than none — it would recreate §0.3 with extra
steps.

---

## 5. Rendering is a swap, and that is the point

The owner is willing to pivot last-mile editing to canvas or Figma export. That
is cheap here precisely because the Storyboard is renderer-agnostic: beats and
briefs say nothing about Penpot.

`compose.ts` maps a Storyboard plus chosen imagery onto a surface spec. Today
that targets the design-surface lane (spec 23) and the store's published library
(spec 30). A Figma or canvas exporter is a second implementation of one
interface, not a rewrite. **No Penpot type may appear in `packages/storyboard`.**

---

## 6. What the original scaffold deliberately did NOT do

Stated plainly so the next reader does not mistake intent for progress:

- No orchestrator implementation. §3 is unresolved; writing it now would encode
  the wrong decomposition in code that is harder to argue with than prose.
- No real critics. See §4.
- No imagery integration. The generators exist and work; wiring them before the
  brief contract is settled would bind us to today's shape.
- No genome re-acquisition.
- **No bare-artwork fix.** This blocks real output regardless of harness quality
  and is tracked separately.

The scaffold is types, seams, validation, and the documentation you are reading.

---

## 7. Acceptance criteria

1. A Storyboard is readable, diffable and REJECTABLE before any imagery spend.
2. A validator refuses an arc with no turn, and says which beat is missing.
3. Creative direction is machine-readable at the point of generation — no
   intent lives only in prose (§0.2 cannot recur).
4. Continuity constants are bound to frames or assets, and a storyboard that
   cannot bind one fails loudly.
5. More than one candidate is produced and at least one is eliminated by a
   critic, with its reason recorded.
6. Nothing in `packages/storyboard` imports a renderer.
7. Every claim a beat makes carries evidence, and the existing guard still
   refuses unsupported colour.

## 8. Failure modes to design against

All observed in this system, not imagined.

- **Rectangles mistaken for a design system.** §0.1.
- **Intent stored where nothing reads it.** §0.2.
- **One candidate, shipped.** §0.3.
- **Regression to the corpus mean** — the thing "guided by templates" does by
  default, and the reason §3.2 is open.
- **A stub that looks like a critic.** Silent passes are worse than absence.
- **Garbage in.** Frame-in-frame proves a harness cannot outrun its inputs.
- **Zero-evidence archetypes served as fact.** Five of seven, used unknowingly,
  by the author of this document.

---

## 9. What is being handed over, and to whom

This document and `packages/storyboard/` exist so that a stronger model can do
the architecture. The scaffold is deliberately the part that is safe to be
wrong about — types, seams, validation — and everything load-bearing is left
open on purpose.

**Decide these. Do not treat any as settled by this draft.**

| # | Question | Where |
|---|---|---|
| 1 | Sub-agent decomposition — Mastra sub-agents, tools on one agent, or workflow stages | §3.1 |
| 2 | Where novelty comes from, given that a corpus-guided planner regresses to its mean | §3.2 |
| 3 | Branching and budget shape — N storyboards vs one storyboard × N images per beat | §3.3 |
| 4 | Knowledge injection and retrieval when the corpus is thin | §3.4 |
| 5 | **Corpus re-distillation, and how to orchestrate it** | §3.5, §0.5 |
| 6 | What a narrative critic and a visual critic actually are | §4 |

**Constraints that are not open.**

- Build on the Mastra harness this repo already runs. Atelier is the reference
  for the explore/critique loop and is NOT a dependency (§0.4) — its unit is a
  performing ad and its loop optimises a single frame; this needs an arc.
- Governance stays in the same process as the creativity: the claims guard,
  the Action gate, review links and publish consent already exist and already
  work. Do not rebuild them, and do not route around them.
- `packages/storyboard` imports no renderer, ever. That is what keeps a
  canvas/Figma exporter a swap rather than a rewrite (§5).
- Evidence discipline is not negotiable. `evidence.n` means "exemplars I
  counted"; a researched claim may never carry a count (§0.1).

**One input problem no architecture solves.** Every Arthaus product image is a
framed render on a 2048² canvas, so feeding one to the mockup engine yields a
frame inside a frame. Until bare artwork masters are reachable, a better
harness produces better-composed pictures of the wrong thing. Treat it as a
precondition, not a detail.


## 10. Architecture decisions — first implementation, 2026-09-19

### 10.1 Decomposition and novelty (questions 1 and 2)

Use explicit sequential stages within the existing Mastra runtime: grounded
context → three arc proposals → independent narrative/novelty critiques → human
review. Each model call uses a fresh tool-less Mastra Agent, with no shared memory
or authority to write. This avoids creative delegation becoming write authority.
`social_storyboard_plan` is a read/proposal tool and returns the complete review
material without saving artifacts. No Atelier dependency is added.

The planner varies the reader question, order and narrative mechanism rather
than only the layout. The critic sees all three proposals plus up to twelve
recent posts and must call out repetition. Constraint variation proposes novelty;
the independent critic judges whether it earns attention while preserving brand
rules. Neither a high score nor a role named `turn` proves that it works.

### 10.2 Branching and budget (question 3)

Branch three textual arcs first (one bounded planning call, at most three critic
calls). Stop at human review, with zero imagery calls. A review hash binds the
brief, context and verdicts; it is a content digest, **not authorization**.

After selection, the intended imagery budget is two alternatives per beat, with
an explicit quoted total and at most one targeted repair per failed beat. Every
Veo render must quote no more than $2. Reserve spend before dispatch, including
failed attempts, and require renewed review if the arc or quoted budget changes.
That dispatcher is **not implemented in this PR**; the existing Action gate must
own authorization. The count-only `exploreStoryboard` utility cannot enforce a
dollar limit and must not be exposed as a model-callable spending path. Its calls
counter reports candidate slots reserved, not confirmed provider billing.

### 10.3 Knowledge and evidence (question 4)

For the first version use a small, reviewed tenant-owned context manifest at
`social/reference/storyboard-context.json`: fact sources, asset inventory, at
most six relevant patterns and twelve recent posts. Refresh brand instructions
from the current tenant on each invocation. Fail on oversized input instead of
silently truncating evidence. Semantic retrieval can replace manifest selection
once a validated library exists; adding a vector store before that would hide
how little evidence is available.

Counted patterns carry concrete post refs, ordered beat indices, distinct media
refs and observations. The exemplar count is the number of **unique posts**, not
frames, captions, or model confidence. Researched/brand-derived patterns have
sources but no count; the schema rejects extra count fields. A reference lookup
checks existence, while the critic checks whether it supports the proposed move.
The manifest remains a reviewed trust boundary: a model cannot certify its own
pixel inspection by inventing media refs. Current code does not authenticate GCS
objects or claim that an extractor has actually run.

When evidence is thin, retain the idea as a hypothesis and show the missing
acceptance criterion. `social_genome_read` separately defaults to n≥1; explicitly
requesting n=0 exposes uncounted hypotheses with a warning.

### 10.4 Corpus pipeline (question 5 — decided design, not executed)

Run a resumable offline batch alongside the interactive harness. The unit of
extraction is the **whole post**, including ordered carousel images or ordered
video samples, caption and capture-time engagement. Beats are child observations,
not independent posts. Single images remain useful without being counted as arcs.

1. Inventory stable post IDs, handles and existing GCS objects. Keep every input
   in a run ledger: ready, media-expired, incomplete, extraction-failed, extracted
   or unclustered. Never silently discard the quarantine.
2. Rehydrate expired media from the held handles, reconcile by stable post ID,
   and persist pixels plus checksums/capture times. A failed fetch is missing
   evidence, not an invitation to infer an image from a caption.
3. Send complete posts to an operator-configured frontier vision model. Extract
   visual treatment, each beat’s role and observable change, cross-beat bindings,
   and the narrative mechanism. Preserve geometry as a separate feature. For
   video, retain sample timestamps and mark incomplete motion observations.
4. Cluster **after** extraction, using visual/treatment and narrative-transition
   features. Keep rare structures and outliers searchable rather than forcing
   them into the two largest layout clusters. This preserves stories whose first
   image looks alike but whose later moves differ.
5. Review cluster exemplars and counterexamples. Emit patterns with unique member
   post IDs, observations and versioned model/prompt/input hashes. Engagement is
   descriptive, normalized within comparable artist/format/time cohorts; it is
   not proof that a transition caused performance.
6. Report acquisition completeness, parse success and cluster coverage against
   explicit denominators. Repair the ad lane’s 66 quarantined records separately;
   do not mix paid and organic performance signals or lower thresholds silently.

GCS authentication and read access were restored on 2026-09-19. Direct inventory
corrected the acquisition assumptions in §0.5. A single-image extraction pilot
does not establish carousel transitions or better full-corpus yield.

### 10.5 Critics (question 6)

The narrative critic is a model-backed editor over the whole arc, all alternatives,
source context and recent history. It returns a whole-story judgment and optional
beat findings. The visual critic receives actual image attachments alongside the
brief, full arc and brand context; it returns exactly one scored judgment per
candidate, grounded in a visible detail. Video decoding/sampling and a final
rendered-sequence continuity review are still integration work.

Structured outputs are validated. Empty responses, foreign IDs, omitted candidate
judgments, unexplained judgments and model errors fail closed. The exploration
utility also refuses incomplete candidate batches and includes unvisited beats in
`emptyBeats` when a budget truncates exploration. No critic is forced to reject a
fixed fraction: if all survive, the review records that the elimination acceptance
criterion has not been demonstrated.

These are real model-call implementations with deterministic contract tests, not
validated taste. Human agreement with an actual rejection remains required. The
existing claims guard still governs saving; Action gate, review links and publish
consent are unchanged. The new planning path does not save a post or mark it ready.

### 10.6 Remaining acceptance work

- Validate the small visual extraction pilot, recover complete carousel/video
  media, then expand with measured coverage and quarantine recovery.
- Supply bare-master provenance or choose the framed-object route deliberately.
- Prepare the store context manifest and select a configured vision-capable
  `STORYBOARD_MODEL`; run the planning tool and get human agreement on an arc and
  the elimination reasons before any imagery spend.
- Implement approved imagery quoting/dispatch, targeted repair and final sequence
  critique through the existing gate, then compose through the renderer seam.
- Port tested changes into the store console in a reviewable PR. No hosted-runtime
  divergence or live store deployment is authorized by a planning result.


### 10.7 Offline execution pilot

`packages/storyboard-corpus` implements a separate whole-post extraction runner,
append-only local ledger and explicit Vertex pixel adapter. The CLI dry-runs by
default and requires a model, project and post cap before `--execute`. It is not
an Atelier dependency or a new write path in the interactive agent. Changes to
media bytes, caption, model, prompt or extractor version invalidate resume; every
failed attempt remains visible, including provider usage when available.

The extraction schema retains per-image observations, transitions, treatment and
continuity. It does not emit counted patterns: clustering and admission follow
visual review. Video inputs are timestamped image samples with limited coverage,
never a poster silently treated as a whole video. The field-cohort normalizer
audits complete single images separately from
carousel/video covers. Acquisition is operator-controlled and the local input
manifest is explicit. Three real single-image extractions succeeded on 2026-09-20;
that result validates pixel transport and basic treatment extraction, not arcs.

**Inventory verified:** the larger field cohort and its saved pixels exist.
The normalized complete-post lane accepts verified `Image` records; `Sidecar`
and `Video` covers remain explicitly incomplete and require reacquisition.
Clustering single-image treatments can proceed independently, but it cannot
supply evidence for between-beat narrative moves.
See `docs/plans/storyboard-harness/CORPUS-PILOT.md` for the bounded pilot sequence.

### 10.8 Staged v2 extraction calibration — 2026-09-23

The new `packages/storyboard-corpus` v2 contract implements the planned split
between pixel-grounded observation and narrative interpretation. The first
model call receives ordered media bytes with no caption or engagement. The
second receives validated observations plus the caption as labeled context,
still without engagement. Exact media order, adjacent transition references,
beat support and claim-source references are checked. Output remains unreviewed.
At that checkpoint, the pure acquisition contract could classify incomplete
media, but the v2 model adapter had not yet been bound to the durable CLI
ledger or run on a recovered carousel. It did not establish an observed arc
pattern.

Three complete single-image posts passed a bounded live v2 probe on 2026-09-23.
The model distinguished three comic covers _within one image_ from a carousel,
described a painterly city scene, and recognized a hand/stylus making-process
presentation. The city annotation also emitted an irrelevant audio limitation,
and fine OCR remains uncertain. Schema validity is not semantic approval: the
next evidence gate is human review of complete recovered carousel transitions.
Measured prompts, failures and usage are in the pilot report.

### 10.9 Snapshot-ledger execution — 2026-09-24

The v2 adapter now has a separate local CLI and resumable ledger. It accepts
only ready `CorpusSnapshot v2` records with local mirrored image children,
checks their source order and byte checksums, then records output as unreviewed.
It does not scrape a post, infer missing carousel slides or publish a pattern.
The original v1 CLI is preserved. A measured three-single-image ledger run
completed, and a repeat produced no additional ledger rows. Two targeted
re-probes showed that an explicit still-image instruction removed irrelevant
audio caveats from those examples; human judgment and real carousel transitions
remained the next validation gate at that checkpoint. See the pilot report for
counts and limits.

### 10.10 First source-complete carousel — 2026-09-24

One frozen original-cohort carousel was recovered with exact post identity and
three ordered child IDs. The provider response, mirrored pixels and a complete
snapshot are durable research objects. V2 observed two adjacent changes in the
actual slides: T-shirts give way to a hoodie, then hats and stickers, with an
orange running-route line linking the presentation from start dot to finish
flag. This is the first direct corpus example of a second beat doing something
new. The output remains **unreviewed**: a possible overstatement of continuous
photography and coarse `addition` transition labels need human adjudication.
One extracted sequence cannot justify a reusable pattern, outcome claim or
counted genome update. The bounded recovery run and its limitations are in the
pilot report.

### 10.11 Observation vocabulary correction — 2026-09-24

The first carousel showed that `addition` is too coarse when a focal product
disappears and another occupies its role while a route motif persists. V2 now
has `replacement` as a separate observable transition operation. A re-run of
that same post used it for both shirt-to-hoodie and hoodie-to-accessories
changes and described the runner photos without asserting they are one
continuous photograph. This revises the *observation vocabulary*, not the
creative thesis: it remains provisional pending diverse carousel review.

### 10.12 Recovery attribution and sequence units — 2026-09-24

The next frozen carousel exposed an attribution distinction that the first
recovery contract missed. `DPukaNjEnC2` appeared in the `teaganwh` occurrence,
but the fresh provider record names `jessenarens` as owner and `teaganwh` as an
explicit coauthor. Exact shortcode plus owner-only equality would falsely
reject it; accepting any tagged artist would be too loose. The recovery
adapter now requires the source handle to match either the owner or a recorded
coauthor. `CorpusSnapshot v2` retains the source occurrence, actual owner and
attribution role separately, with the raw provider response as order and
attribution evidence.

Complete 6- and 10-slide carousels were then extracted from actual ordered
pixels. The six-slide gallery tour changes wall views and later reframes a
sculpture; the ten-slide book showcase moves from exterior details to interior
spreads. The latter produced ten slide observations and four proposed narrative
beats. A presentation unit and a beat therefore cannot be forced into a 1:1
mapping. This is a concrete calibration example for the plan's many-to-many
realization map, not a validated story archetype. All three carousel outputs
remain unreviewed; the book output also uses unsupported intent language
("unboxing-style" and "censorship bars") that a reviewer must correct or
reject. The pilot report records exact artifacts and failure/retry history.

### 10.13 Reliability and relevance correction — 2026-09-24

The next contrast slice showed that child-byte completeness is not semantic
media completeness. A six-child artist carousel included a video at ordinal 1;
all six originals were mirrored, but the post remains ineligible for still-only
v2 extraction until temporal, audio and transcript coverage are represented.
Another two-slide example moves from isolated geometric artwork to its use on
a shirt. That is an observed art-to-product recontextualization; pixels do not
establish whether the shirt was manufactured or is a mockup. A nine-slide
wedding-stationery case is source-complete and narratively structured, yet its
relevance to Arthaus artist storytelling remains uncertain and its visual text
has inconsistencies. Artist tier and engagement rank alone are insufficient
corpus-admission criteria.

Caption belongs beside the source snapshot as labeled interpretation context,
not in the pixel observation call. A real caption-only re-run reused a validated
`observed` stage checkpoint and paid only for annotation. The checkpoint is
bound to ordered media checksums, coverage, source, model and observation
prompt; caption and annotation-prompt changes cannot invalidate pixel facts.
The ten-slide book also exposed repeated JSON shape errors. Both v2 model
passes now request explicit structured output and still enforce local schema,
locator and claim checks. One measured recheck succeeded structurally, while
the model still inferred "censorship" from black rectangles. Structural output
validity is therefore not evidence support or human approval. Corpus
interpretations need an independent support review before pattern admission.

## 11. Research and TRD reconciliation — 2026-09-20

The supplied narrative/storyboard research and Atelier sub-module TRD validate
the plan-first premise while expanding the target architecture. The first
implementation built a useful middle slice: grounded beat-level storyboards,
independent critique and human review before pixels. The production target adds
an upstream immutable Creative Schema and separates narrative plans from
shot-level Storyboard IRs and governed render handoffs.

The core package remains renderer-independent and Mastra remains the Marketing
OS harness. Atelier is a protocol reference, not a dependency. Deterministic
structural checks gate hard constraints; model-based narrative and visual editors
remain advisory until measured against human pairwise judgments. A performance
critic, taste adapters and outcome-driven taxonomy updates are later gated
capabilities, not properties the current implementation may claim.

The corpus extraction contract will be revised before scale to separate visible
frame observations, adjacent transitions and grounded narrative annotations.
The three-image pilot proved transport and provenance, not the target narrative
ontology. Full reconciliation, current-component disposition and the execution
sequence are recorded in
`docs/plans/storyboard-harness/TRD-RECONCILIATION.md`.

## 12. Comprehensive implementation plan — 2026-09-20

The [core plan](../docs/STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md) is the
canonical forward architecture. It preserves Mastra, renderer independence,
counted-evidence semantics and existing approval authority. Proposed contract
revisions remain planned until implemented with their tests and migrations.

It corrects three oversimplifications in the earlier reconciliation: beats and
presentation units need an explicit realization map rather than exactly one beat
per shot; counted single-image treatment evidence is distinct from sequence
evidence; and literature-specific judge percentages do not establish release
thresholds for this product. Human preference, structural validity and measured
outcomes retain separate contracts and evaluation gates.

The plan includes the offline acquisition/annotation/library pipeline, online
creative/review/render workflow, dependency and storage boundaries, budget and
failure recovery, research experiments, implementation work packages, migration
and rollout strategy, and traceability to the supplied TRD. Its first acceptance
milestone remains a human-approved, evidence-supported Arthaus arc with an agreed
candidate rejection before imagery spend, followed by governed realization.

NeuroGraph is an optional joint-deployment integration: persona/scenario context
primarily arrives over MCP from the customer agent, while proprietary Creative
Review skills, tools and models own creative outcome assessment. Reserve distinct
ports and leave both implementations empty for now. Missing integrations remain
explicitly unavailable; the social agent retains independent planning and human
review. Predictions and simulated responses are not observed business outcomes,
and neither integration changes existing approval authority.
