# @avant-garde/storyboard

The narrative layer for social creative. **Spec: [`spec/33-THE-STORYBOARD-HARNESS.md`](../../spec/33-THE-STORYBOARD-HARNESS.md).**

> **This is a scaffold.** The orchestrator and the real critics are deliberately
> absent. Read §6 of the spec before assuming anything here is finished.

## Why it exists

Three posts were composed for one artwork, through three archetypes, with a
published design library and a live claims guard. All three were boring. The
cause was structural:

- the scraped reference library distilled 2,500 ads into **four rectangle
  lists**, five of seven archetypes carrying `evidence: { n: 0 }`
- creative direction lived in prose (*"a close crop — paper texture, a frame
  edge"*) that nothing in the pipeline read
- the pipeline composed **one** candidate and shipped it, so no component ever
  had the job of saying *this is boring*

A slot-filler cannot be creative. It can only be correct.

## The thesis

**A social post is a story that happens to be a picture.** So the central
artifact is a `Storyboard` — ordered beats, each carrying what it MEANS before
anything about how it looks — reviewable and rejectable before a pixel is
generated.

```
KNOWLEDGE → ORCHESTRATOR → STORYBOARD → [narrative critic]
                               ↓
                          VISUAL BRIEF → IMAGERY (explore N) → [visual critic]
                               ↓                                     ↓
                          COMPOSITION ←──────── eliminate worst ─────┘
                               ↓
                          GOVERNANCE (claims · review · Action gate)
```

## What is here

| | |
|---|---|
| `types.ts` | the IR: `Storyboard`, `Beat`, `VisualBrief`, `ContinuityConstant`, and the `ImageryService` / `NarrativeCritic` / `VisualCritic` seams |
| `narrative.ts` | structural validation — *is this a story at all*, not *is it good* |
| `explore.ts` | explore → critique → eliminate, over the seams above |

## What is deliberately NOT here

- **The orchestrator.** Sub-agent decomposition, where novelty comes from, and
  the branching/budget shape are all unresolved (spec §3). Writing it now would
  encode the wrong answer in code that is harder to argue with than prose.
- **Real critics.** Interfaces only. A stub that always passes would recreate
  the original bug with extra steps.
- **Imagery integration.** The generators exist and work; wiring them before the
  brief contract settles would bind us to today's shape.
- **Any renderer.** Nothing here may import one — that is what makes a
  canvas/Figma exporter a swap rather than a rewrite.

## Rules the validator enforces, and the failure each encodes

| rule | what it prevents |
|---|---|
| a multi-beat arc must **turn** | `setup → setup → setup` — a catalogue with slide numbers |
| every beat carries an **assertion** | beats that are decoration |
| `brief.shows` is required | a generator handed a mood instead of an instruction |
| continuity must be **bound** to a frame/asset | four convincing frames that read as four unrelated pictures |
| `prompt-only` continuity always warns | the weakest mechanism, chosen on the record |
| `sourcing` gates the generator | frame-in-frame, when a framed render meets a framing engine |

## Open questions for the next reader

Numbered in spec §3, and genuinely open:

1. sub-agent decomposition (dramaturge / art-director / copywriter / continuity)
2. **where novelty comes from** — guided by a corpus, an orchestrator regresses
   to its mean, which is the original complaint
3. branching shape: N storyboards, or one storyboard × N images per beat
4. how knowledge is injected when the corpus is thin

And one that blocks output regardless of harness quality: **every Arthaus
product image is a framed render**, so there is no bare artwork to generate
from. No amount of narrative fixes a bad input.
