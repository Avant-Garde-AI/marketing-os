# 29 — Post Concepts: reusable idea structures for the social agent

> **Status:** TRD — proposed. Shape open for one review pass, then binding on the social pack.
> **Depends on:** 24-SOCIAL-MEDIA-AGENT (pillars, calendar, posts), 26-SOCIAL-AGENT-ALIGNMENT (artifacts in git), 20-CAPABILITY-SUITE (writes are Actions), 23-DESIGN-SURFACES (the canvas).
> **Sits above:** the layout genome (`social/reference/genome.md`) and the archetype→surface bridge.
> **First target:** Arthaus. **Written:** 2026-09-10.

---

## 0. The gap

The social pack can answer *where things go* (archetypes), *what fills them* (bindings), *how it is written* (copy formulas) and *when it runs* (calendar). It cannot answer the question a person actually asks first:

**What is this post about, and why would anyone care?**

Nothing in the system holds an idea. A pillar (`room-in-situ`) is a category, not an idea. An archetype is a rectangle arrangement. A copy formula is a sentence shape. So every post is invented from scratch, which is why ten posts came out looking and reading like one, and why the captions drifted into fabrication — with no premise to be accountable to, the model supplied its own.

What is missing is the layer between the strategy and the post: a **Concept**. A named, reusable idea structure that says what a post is about, why it lands, what it needs to exist, and what shapes it can take.

This is also the layer that makes a working session possible: *"give me four in this concept"* — the agent instantiates, the user reviews and schedules. And its inverse: *"here is what the market is doing, draft me a new concept"*.

Atelier (`creative-agent`) does not have this either. Its `CreativePattern` is `pattern_id / slots / layout / perf_rank` — a performance-ranked **layout**, retrieved per persona and format. Useful, and the same tier as our genome archetypes. The idea layer is above both.

## 1. What a Concept is

A Concept is **not** a template, a campaign, or a layout. It is closest to a standing editorial column: a premise you can run repeatedly with different subjects, that stays interesting because the premise is interesting, not because the subject is new.

```
Concept
  id, name
  premise        what the post is about, as a repeatable idea
  payoff         why a reader cares, IN THEIR TERMS — not the brand's
  needs[]        the content contract: what must exist for an instance to be real
  expressions{}  format → how this idea takes that shape (single | carousel | video)
  voice          which copy formulas fit, and the hook shape
  cadence        how often before it stops feeling like an idea
  evidence       brand-derived | researched | counted   (never conflated)
  provenance     who authored it, from what
```

Two fields carry the weight.

**`payoff` is written in the reader's terms.** "Shows our catalogue depth" is a brand's reason. "You can see what it would actually look like in a room like yours" is a reader's. A concept whose payoff can only be stated as a brand benefit is not a concept, and the pack should say so rather than accept it.

**`needs` is a content contract, and it is the whole reason this is checkable.** "One work, three rooms" needs a work with at least three distinct room scenes. "The piece that started the wall" needs a gallery-wall set with a stated anchor. If the store cannot satisfy the contract, the concept is **refused with the missing need named** — exactly as `specFromArchetype` refuses an unfillable archetype. This is what stops "give me five" from producing five plausible fabrications: an instance that cannot be grounded is not generated at all.

## 2. One idea, several shapes ⟨BUILD⟩

`expressions` is what makes a concept worth having rather than just a good caption. The same premise becomes:

| Format | What the concept supplies |
|---|---|
| `single` | an archetype id + the role→content plan for one frame |
| `carousel` | a **slide script**: n slides, each with its own role in the argument (setup → turn → payoff → close), each mapping to an archetype |
| `video` | a **beat script**: shot list with durations and the same narrative roles |

The slide script is the important one, because a carousel is not three separate posts — it is one argument with a shape. A concept that says *"slide 1 establishes the room, slide 2 removes the art, slide 3 restores it"* has encoded something a per-post agent reinvents badly every time.

Formats a concept does not support are absent, not empty. "This idea does not work as a video" is a real answer.

## 3. Instantiation ⟨BUILD⟩

`social_concept_instantiate(conceptId, n, constraints?)`:

1. Resolve `needs` against the store's inventory. Rank candidate subjects by how completely they satisfy it.
2. Refuse, naming the unmet need, if fewer than `n` subjects qualify. Returning three when asked for five, and saying so, is correct; inventing two is not.
3. For each subject, produce a **grounded** draft: real subject facts, an archetype from `expressions`, imagery instructions (scene prompt with the archetype's own text zone), and copy from `voice`.
4. Emit drafts as normal post artifacts, `status: proposed`, each carrying `conceptRef` and the subject facts it was grounded in.

Step 4's `conceptRef` is what makes the loop learnable later: outcomes attach to concepts, so the store finds out which ideas work, not merely which posts did.

## 4. Authoring new concepts ⟨BUILD⟩

`social_concept_propose(observation)` — the session the user described: *sit down, look at what the market is doing, come up with new ones.*

Input is an observation (a market pattern from `social/reference/corpus/`, a competitor's post, or the user's own sentence). Output is a **draft concept artifact for review**, never a live one. It must state its `evidence` honestly:

- `counted` — distilled from n observed exemplars (the retail corpus lane; carries `n`)
- `researched` — from artist/market research, no count
- `brand-derived` — from brand.md, no external evidence

These three are already kept separate in the genome and must not merge here. A concept invented in a chat is `brand-derived` with `n: 0`, and should look it.

**The hierarchy holds:** brand.md dominates, the genome informs, a concept organizes. A concept that reads like the competition is a failure even if the market rewards it — the same rule the genome carries, one tier up.

## 5. Domain-agnostic by construction

Concepts are **per-store artifacts** (`social/concepts/*.md`); the *vocabulary* is platform. Nothing in the schema is art-specific — `needs` is a predicate over whatever inventory nouns the store already uses.

| Store | Concept | Needs |
|---|---|---|
| Framed art | One work, three rooms | a work with ≥3 room scenes |
| Coffee roaster | One origin, three brews | an origin with ≥3 brew methods documented |
| Apparel | The piece that anchors the outfit | a garment with ≥2 styled looks |

The pack ships the type, the tools, and a small starter set derived from the store's own brand.md at scaffold time. It does **not** ship a library of generic ideas — that is how every account ends up posting the same thing.

## 6. Three worked concepts (Arthaus)

Grounded in `brand/brand.md` (the Nest Curator thinks in rooms) and the existing pillars.

**`one-work-three-rooms`** — *premise:* the same piece, in three genuinely different rooms. *payoff:* "you can tell whether it works in a room like yours, not a gallery." *needs:* a work with ≥3 distinct room scenes. *expressions:* carousel (3 slides, one room each, caption names the room mood); single (best-fit room, `room-in-situ-captioned`). *cadence:* weekly. *evidence:* brand-derived.

**`the-piece-that-started-the-wall`** — *premise:* a gallery wall told backwards from its anchor. *payoff:* "gallery walls look intimidating; they start with one decision." *needs:* a gallery-wall set with a stated anchor work. *expressions:* carousel (anchor → +2 → finished wall); video (same three beats). *cadence:* fortnightly. *evidence:* brand-derived.

**`what-the-artist-was-looking-at`** — *premise:* the artist's reference or influence beside the work. *payoff:* "art from artists, not algorithms — you learn something about the person." *needs:* an artist with a sourced statement or documented influence. **This one refuses often, and should** — it is the concept most likely to invite fabrication, so the contract is strictest. *expressions:* single (`work-detail`); carousel (influence → work → detail). *cadence:* monthly. *evidence:* researched.

## 7. Acceptance criteria

1. A concept with an unsatisfiable `needs` is **refused by name**, never silently downgraded.
2. `instantiate(n)` returns ≤ n and reports the shortfall; it never invents subjects.
3. Every generated post carries `conceptRef` and the subject facts it was grounded in.
4. A carousel produced from a slide script reads as one argument, not n posts.
5. A concept authored in chat is stored as `brand-derived`, `n: 0`, and is visibly distinct from a counted one.
6. Concept artifacts round-trip through the store repo like every other artifact (spec 26 §1).

## 8. Open decisions

- **D1** — Do concepts live in the calendar (a slot references a concept) or only at instantiation? Leaning: calendar slots gain an optional `conceptRef`, so a month can be planned as ideas before subjects exist.
- **D2** — Does `needs` get a real predicate language, or start as a documented string plus a hand-written resolver per store? Leaning: string + resolver first; a DSL invented before three real stores exist will be wrong.
- **D3** — Is `social_concept_propose` an Action (gated) or a read that emits a draft? Leaning: read that writes a `status: draft` artifact — drafts are free, promotion is the gate.

---

## 9. Video: Penpot holds the keyframes, not the film

Added 2026-09-11, after rendering `how-it-was-made` end to end on Veo 3.1.

**An mp4 never enters the canvas.** Penpot is a vector editor with no timeline;
storing video there would be fighting the tool, and a rendered film is not an
editable artifact in the sense the Design Studio means. The split:

| | Owner | Editable |
|---|---|---|
| Keyframes (a beat's start/end state) | Penpot board | yes — Design Studio |
| The render between them | Veo | no |
| The finished mp4 | post `assetRefs` | no — reviewed, not edited |

**A beat is a keyframe.** `ConceptBeat` already carries `archetypeId` and
`seconds`, which turns out to be exactly the right shape: a beat is a frame
composed as an archetype and held for a duration. Compose each beat as a named
board (`boards[]` and `exportSurfaceBoards` already exist — email uses board
names as slot keys), export them, and hand consecutive pairs to the video model
as `image` and `lastFrame`.

**This is what makes continuity structural rather than hoped-for.** The first
real render held board, surface and light for six seconds and changed both in
the last two — not model drift, but a brief that contradicted itself, because
the `lastFrame` was an independently generated still shot on a different desk.
When both keyframes are boards on ONE page sharing a background image and crop,
that failure is impossible by construction. §"SceneConstants" stops being an
instruction the model may or may not honour and becomes a property of the
inputs. Prompt-level continuity remains, as the belt to that brace.

**It also puts human editing in the right place.** The canvas is where a crop,
a caption, a frame colour or a piece of brand type gets fixed — and then the
video is re-rendered from the corrected keyframes. Nobody edits a film; they
edit the two pictures it interpolates, which is a job a design tool is good at
and a video tool is not.

### What this needs ⟨BUILD⟩

1. `compose_post_from_archetype` gains a multi-board form: one board per beat,
   named for its role, sharing the file.
2. A render step that walks consecutive exported boards into video-model calls
   and attaches the result to the post as an asset.
3. Cost control at that step. Veo is billed per second of output; a concept
   with five beats is four renders, and that must be visible before it runs,
   not after.

### Model access, for the record

Veo 3.1 required **no grant of any kind** on either `avant-garde-platform` or
`arthaus-us`. An earlier claim in this workstream that it needed a Model Garden
grant was wrong: the 404s came from model ids that do not exist
(`veo-3.1-*-preview`, `veo-3.0-*`, `veo-2.0-*`). The working ids are
`veo-3.1-fast-generate-001` and `veo-3.1-generate-001`, us-central1, via
`:predictLongRunning` + `:fetchPredictOperation`. Noted because "we need access"
is an expensive wrong answer — it sends someone to a console to fix nothing.
