# 33 — The Storyboard Harness

> **Status:** TRD — scaffold committed, architecture deliberately unfinished. This
> document and `packages/storyboard/` exist to be argued with.
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

**One decay to plan around:** the organic records store Instagram CDN
`imageUrl`s, which expire. Sampled 2026-09-19: **403 Forbidden**. Metadata,
captions and engagement survive; the pixels need re-pulling before anything can
be clustered visually.

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

Ordering beats by narrative role rather than by index is deliberate. A three
slide carousel that runs setup → setup → setup is a catalogue, and naming the
roles makes that visible to a validator instead of only to a reader.

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

## 3. The orchestrator ⟨DESIGN — the part to argue about⟩

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
`social_genome_read` should refuse to serve a zero-evidence archetype unless
explicitly asked for — which is what would have stopped this document's author
using five of them.

### 3.1b Retirement remains an option

If the re-distillation in §3.1 does not yield archetypes with real member
counts and a stated reason they work, retire the genome rather than keep a
weak one on life support: reduce it to `register` and `doNot` — the parts that
were always prose and are honest as prose — and let a real pattern library
supply structure. Atelier's Crello store and graph retriever are the reference
for what that looks like.

What must not continue is the current state: four rectangle lists serving as a
design system, with nothing telling a reader which of them were counted.

## 4. Critique ⟨BUILD — interfaces only in this scaffold⟩

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

## 6. What this scaffold deliberately does NOT do

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
