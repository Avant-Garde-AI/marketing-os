# Storyboard harness — initialization brief

> Hand this to the coding agent that will do the architecture. It is written to
> be pasted whole. Everything it references is committed.
>
> **Written:** 2026-09-19, after three composed posts were correctly called
> trash and the cause turned out to be structural.

---

## The prompt

You are architecting the creative core of a social-media agent that currently
produces boring output. The diagnosis is done and committed; the architecture
is not, and it is yours.

**Read first, in this order:**

1. `spec/33-THE-STORYBOARD-HARNESS.md` — the diagnosis, the thesis, and §9,
   which lists exactly what is open and what is not.
2. `packages/storyboard/` — the scaffold. Types, structural validation, and the
   explore/critique loop. 21 tests. No orchestrator, no real critics, on
   purpose.
3. `spec/24-SOCIAL-MEDIA-AGENT.md` and `spec/29-POST-CONCEPTS.md` — what exists
   today and is being refactored, not replaced.
4. `agents/social/reference/` in the Arthaus store repo (`Arthaus-Inc/marketplace`)
   — the genome, the distiller, and the research lane that produced them.

**The problem, in one paragraph.** A social post is a story that happens to be
a picture, and this system has no story layer. It fills rectangles. The scraped
reference corpus distilled to two generic centred-stack layouts because the
funnel discarded two thirds of its input; creative direction lives in prose that
nothing reads; and the pipeline composes exactly one candidate and ships it, so
nothing in the system has ever had the job of saying *this is boring*. A
slot-filler cannot be creative — it can only be correct, and correct is what it
produces.

**Your job.** Decide the six open questions in §9 and build the orchestrator
and the critics. The scaffold's IR is a proposal, not a constraint: if
`Storyboard`, `Beat` or `VisualBrief` are the wrong shape for the architecture
you choose, change them and say why in the spec.

### What is already true and should not be relitigated

- **Mastra is the harness.** Build on the agent runtime this repo already runs.
- **Atelier (`Avant-Garde-AI/creative-agent`) is the reference, not a
  dependency.** Read it for the `explore → render → critique → eliminate`
  loop, which it does well. Its unit is a single performing ad; this needs an
  arc, where the interesting thing is the turn between beats. Decided
  2026-09-19: not over MCP, not vendored.
- **Governance already works.** A claims guard that refuses a colour the
  artwork does not support, an Action gate with approve-at-schedule consent,
  expiring review links, an Instagram publish lane with a self-renewing token.
  Do not rebuild these and do not route around them. Creativity and governance
  stay in one process.
- **No renderer inside `packages/storyboard`.** Penpot is today's target;
  canvas/Figma export must stay a swap.
- **Evidence discipline.** `evidence.n` means "exemplars I counted". A
  researched claim may never carry a count. This mechanism already caught a
  real error and must survive your refactor.

### The corpus — the highest-value unlock, and yours to orchestrate

`gs://arthaus-creative-corpus/` (GCP project `arthaus-us`) is intact:

| | |
|---|---|
| `meta-ad-library/2026-09-01/` | 393 ad images, 261 classified `designed_ad` |
| `instagram-organic/2026-09-01/` | 40 artists, **923 posts**, engagement on every one |
| | **345 carousels · 179 video** · 399 single |
| `layout-synth/2026-09-01/` | the clustering run: 198 in, 66 quarantined, 39.4 % coverage, **2 canonicals** |

**The organic corpus has never been looked at visually.** It went to a
researched-dossier lane and came back as prose. 524 multi-frame posts by
working artists, with a performance signal attached, is exactly the material a
narrative harness needs and nobody has clustered it.

The owner's instinct — cluster visually, then have a frontier model extract the
template and narrative structure — is endorsed as a *direction*. **The pipeline
is explicitly yours to design** and is listed as open question 5. Batch or
streaming; one pass or staged; clustering before or after model extraction;
unit of extraction a post or a beat; inside the Mastra harness or beside it as
an offline job the harness merely reads. None of that is decided, and a
prescriptive plan here would be guessing.

Two facts to design around:

- **Organic `imageUrl`s are dead.** Instagram CDN links, sampled 2026-09-19:
  `403`. Captions, engagement and metadata survive; pixels need re-pulling from
  handles already held (Apify).
- **The ad lane's low yield is a pipeline problem, not a corpus problem.**
  Raising coverage above 39.4 % is probably worth more than acquiring more ads.

### One precondition no architecture fixes

Every Arthaus product image is a framed render on a 2048² canvas. Feed one to
the mockup engine and you get a frame inside a frame — verified twice, on two
different works. Until bare artwork masters are reachable, a better harness
produces better-composed pictures of the wrong thing. Solve it or route around
it deliberately; do not discover it late.

### How to work

- Small PRs against `Avant-Garde-AI/marketing-os`, each with the reasoning in
  the commit body. This repo's convention is that commit messages explain WHY.
- Spec changes land with the code that implements them. If you change the IR,
  change §2.
- Tests pin rules to the failure that produced them. See
  `packages/storyboard/test/narrative.test.ts` for the house style — each test
  name says what real thing it prevents.
- When you find that something in spec 33 is wrong, say so in the spec. §0.1
  already carries one correction from its own author; that is the expected
  standard, not an embarrassment.

### Definition of done for this phase

Not "a post exists". A post already exists and it is boring. Done is:

1. A `Storyboard` that a human reads and says *yes, that is worth making* —
   before any imagery spend.
2. More than one candidate produced, and at least one eliminated by a critic
   whose recorded reason a human agrees with.
3. An arc whose beat 2 does something beat 1 did not, and where you can point
   at the corpus evidence for why that move works.

---

## Appendix — repository map

| path | what |
|---|---|
| `spec/33-THE-STORYBOARD-HARNESS.md` | this architecture |
| `packages/storyboard/` | the scaffold (IR, validator, explore loop) |
| `packages/skills/social-media/` | the current pack — concepts, claims guard, actions |
| `packages/design-surfaces/` | Penpot adapter, compose lane, export |
| `packages/marketing-os/templates/agents/` | the console runtime; vendored copies live here |
| `Arthaus-Inc/marketplace` → `agents/` | the store: brand.md, genome, design library, posts |

**Vendoring discipline:** `packages/…` is canonical, the template under
`packages/marketing-os/templates/agents/` is a copy, and the Arthaus console is
a copy of that. A fix must land in all three or it is lost at the next upgrade.
