# 30 — The Design Library and the Two-Way Canvas

> **Status:** TRD — proposed. Binding on the design-surface lane once D1–D4 are settled.
> **Depends on:** 22-BRAND-SOUL (files are truth), 23-DESIGN-SURFACES-PENPOT (the canvas, tenancy, compose lane), 26-SOCIAL-AGENT-ALIGNMENT (artifacts in git), 29-POST-CONCEPTS (§9 keyframes).
> **Generalises:** social is the first consumer, not the subject. Email board sections, offers and ads use the same lane.
> **Written:** 2026-09-11, after the first real carousel composed end to end.

---

## 0. Two gaps, one seam

**The craft gap.** `surfaceStyleFromTokens` maps DESIGN.md to a font family and a
hex code. That is enough to avoid looking *wrong* and nowhere near enough to look
*designed*. What makes a post read as considered is the layer underneath: type
scale relationships, optical spacing, a hairline rule, a letterspaced eyebrow,
where the subject sits in a crop, safe margins. None of it is in the genome —
correctly, the genome carries structure — and none of it is in DESIGN.md's
tokens. Today it lives in TypeScript, in a `SurfaceStyle` literal, where no
designer can reach it and every change is a platform deploy.

**The read-back gap.** Compose is one-way. The agent writes a surface into
Penpot and never reads what a human did to it. A person can open the canvas,
fix a crop, rewrite an eyebrow, nudge a band — and that work exists only in
Penpot. The artifact in the repo still describes what the agent composed, so
the next compose silently discards the edit and the review room shows a picture
nobody can trace to a source.

These look like separate problems and share one seam: **the canvas has to
become two-way over a source of truth that lives in git.**

## 1. The repo is the master ⟨BUILD⟩

Components live in the STORE REPO, beside brand.md and DESIGN.md:

```
design/
  library/
    library.md          # manifest: version, what this library is for
    tokens.json         # DTCG — compiled from DESIGN.md, not hand-kept
    components/
      caption-band.json
      credit-lockup.json
      eyebrow.json
    type/
      scale.json        # the relationships, not just the faces
```

**Source is JSON, never `.penpot`.** A binfile is a build output: opaque,
unmergeable, and meaningless in a diff. A store that cannot read its own design
system in a pull request does not own it. The `.penpot` library is produced
from these files the way a bundle is produced from source.

This is the same rule spec 22 settled for brand.md and spec 26 settled for
campaign artifacts, applied to the one part of the system that was still
platform-owned.

## 2. Publish is one way: repo → Penpot ⟨BUILD⟩

A publish step compiles `design/library/` into a Penpot shared library file in
the tenant's team, through the lane that already exists — `@penpot/library` →
`importBinfile` → mark shared. No new infrastructure.

**One-way, and this is D1, the decision the rest depends on.** If the shared
library in Penpot is also a source — if a designer editing it there counts —
there are two masters and they diverge silently. Divergence in a design system
does not announce itself; it shows up months later as two slightly different
caption bands nobody chose.

So: Penpot holds a PUBLISHED ARTEFACT. Edits made to it in Penpot are not lost
and not authoritative — see §4.

**Drift is reported, never repaired.** The publish step records the repo commit
it built from, and a check compares the live library against it. Same rule the
migration runner already follows: a system that silently re-syncs teaches
people the repo does not matter.

## 3. Compose instantiates components ⟨BUILD⟩

`specFromArchetype` gains a component-aware fill: a slot bound to
`{ kind: "component", ref: "caption-band" }` instantiates the published
component rather than drawing a rect and a text node.

The split from spec 29 survives intact and gets sharper:

| Layer | Owner | Answers |
|---|---|---|
| Concept | store repo | what the post is about |
| Archetype | genome | where things go |
| **Component** | **store repo → published library** | **what it looks like** |
| Binding | agent | which work, which words |

The prize is propagation: a designer edits `caption-band.json`, publishes, and
every future surface picks it up. Today the equivalent is a platform PR.

## 4. Read-back: the canvas proposes, it does not overwrite ⟨BUILD⟩

The missing half. `getFileStructure` already reads a file's boards and objects;
nothing compares that to what the agent composed.

1. **Diff.** Compare the live file against the spec that produced it. Report
   what changed, by role: "the eyebrow text differs", "the room image was
   replaced", "a shape was added that no role owns".
2. **Propose.** Turn the diff into a revision of the ARTIFACT — the post's copy,
   its bindings — as a proposed change, not a write.
3. **Approve.** It lands through the same gate every other store-facing change
   uses (spec 20 Actions). A human editing a canvas is not a different kind of
   authority from a human approving a post.

**Unattributable edits stay unattributable.** A shape added on the canvas that
corresponds to no archetype role cannot be mapped back to an artifact field,
and the diff must say so rather than inventing a home for it. Silently dropping
it would make the artifact a lie about the picture; silently keeping it would
make the next compose delete a human's work.

## 5. Not a social feature

The primitive is: **an agent-staged visual artifact, opened on a canvas,
modified conversationally or directly, re-staged for review.** Social posts are
the cleanest example, not the scope. Email board sections already compose
through `createSurface`; offers and ads will. Every one of them wants the same
three verbs — publish a library, instantiate components, read the canvas back —
and none of them is social-specific.

This is why §1–§4 name no domain. The social pack consumes the lane; it does
not own it.

## 6. Decisions

- **D1 — sync direction.** Repo is master; Penpot holds a published artefact;
  canvas edits return as proposals (§4). *Leaning: settled as written. The
  alternative — bidirectional sync — has no answer to "which one is right".*
- **D2 — component source format.** DTCG tokens plus per-component JSON, with
  `.penpot` as a build output. *Leaning: as written. Revisit only if Penpot's
  component model cannot be expressed declaratively.*
- **D3 — when publish runs.** On template upgrade, on demand from the console,
  or on every deploy? *Open. Leaning: on demand plus a drift check, because a
  deploy-time publish makes an unrelated release able to change the look.*
- **D4 — component granularity.** How much is a component (a band) versus a
  composed lockup (band + eyebrow + rule)? *Open, and deliberately: this is a
  design judgement the first real library should answer by existing, not a
  schema question to settle in advance.*

## 7. Acceptance criteria

1. A store's design library is readable and diffable in a pull request.
2. Publishing is one way; the live library records the commit it was built from.
3. Drift between repo and live library is reported and never auto-repaired.
4. A composed surface names the component version it used.
5. A canvas edit produces a PROPOSED artifact revision, never a direct write.
6. An edit that maps to no role is reported as unattributable, not dropped and
   not guessed at.
7. Nothing in the lane is social-specific; email can use it unchanged.

## 8. Failure modes to design against

All five are observed, not hypothetical.

- **Two masters.** The reason D1 is settled first.
- **Silent overwrite.** Compose today discards canvas edits without noticing,
  because it has never read the canvas.
- **A build output in git.** `.penpot` files in a repo look like source control
  and provide none of it.
- **Ordering that only breaks in review.** The first real carousel previewed
  BACKWARDS — boards correctly positioned top-to-bottom, presented by the
  viewer in reverse. The artifact was right and the review was wrong, which is
  the hardest class to notice.
- **Propagation nobody asked for.** A library edit reaching already-approved
  surfaces would retroactively change work someone signed off. Published
  surfaces pin their component version; only new composes float.
