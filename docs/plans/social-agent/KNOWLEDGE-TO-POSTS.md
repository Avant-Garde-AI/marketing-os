# From extracted knowledge to posts that are worth publishing

> **Status:** tactical plan, written 2026-09-01 at the end of the corpus wave.
> Live state and the new-session prompt are in `HANDOFF-2026-09-01.md`.
> **Depends on:** spec 24 (the pack), spec 26 (alignment), the reference contract
> in `packages/skills/social-media/src/reference.ts`, and the corpus destined for
> `gs://arthaus-creative-corpus`.
> **Targets:** Arthaus marketplace first, Easel second — deliberately in that
> order, because Easel is the same engine with one substitution (§6).

## 0. What we have, and the honest gap

We can now describe a market's layout grammar from observed evidence. What we
cannot yet do is turn that into a post about a *particular artwork*.

| Have | State |
|---|---|
| Retail corpus | 393 ads, **261 `designed_ad`** (66% yield), with images |
| Artist corpus | 504-artist field cohort, 15 posts each, **with images**; plus a 40-artist roster pilot (no images) |
| Layout extraction | S0–S6 **in flight** (87/261 at time of writing); canonicalization driver merged (creative-agent #1) |
| The contract | genome schema, `resolveArchetype`, `social_genome_read`, fit-check |
| The loop | author → compose → review room → Slack approval → cron publish, all live |
| Arthaus content | 1,001 artists with generated `headline` / `known_for` / `long_description`; artworks; room scenes |

**The gap is slot filling.** An archetype says
`{role: "work", kind: "image", x, y, w, h}`. Nothing decides *which* artwork
goes in that box, *which* room scene sits behind it, or what the caption says
about it. Everything upstream of that is built; everything downstream of it is
built. This plan is almost entirely about the middle.

A second gap matters nearly as much: `evidence.n` today counts what
**competitors** do. It will never count what works **for Arthaus** until the
store's own post performance feeds back (§5). Until then the genome is a
well-sourced outside view, not a learned one — and it should be described that
way.

---

## 1. P1 — Canonicals to a genome with real evidence

Close the loop that is currently running.

**Do:** run `--stage canonicalize` over the extracted specs; map each canonical
to a genome archetype — `zone_archetype` (role → median `[x,y,w,h]`) becomes
`slots`, `member_count` becomes `evidence.n`, `days_active_median` becomes
`evidence.signal`. Write `social/reference/genome.md` in the Arthaus repo.

**Watch:** `min_cluster_size` now auto-scales for small corpora and reports the
value it used. A canonical drawn from 5 members is a hint, not a convention —
carry that honesty into the archetype `description`, not just the number.

**Done when:** the genome parses, every archetype resolves in-bounds at
1080×1080/1350/1920, and `evidence.n` is a real count. The brand-derived
archetypes stay as a labelled fallback for roles the corpus never showed.

## 2. P2 — Slot resolution (the crux)

A `role` is a *contract for what belongs there*, and the store must be able to
satisfy it from its own catalogue.

**Build `resolveSlots(archetype, context)`** in the social pack — pure,
testable, no I/O — returning a filled `ComposeSpec`. The resolver is a map from
role → asset source:

| Role | Source | Notes |
|---|---|---|
| `work` | the artwork image | the actual piece; never a mockup composited into a room (AMS already forbids this) |
| `room` / `wall` | Arthaus room scenes | AMS `apply-room-scenes.js` / `batch-shoppable-rooms-compose.js` already produce these |
| `band` / `ground` | DESIGN.md tokens | a palette value, never a literal from the genome |
| `headline` / `caption` / `statement` | §3 | text, composed not chosen |
| `eyebrow` | collection or pillar name | short, uppercase, brand-tokened |

**Two rules that must be structural, not conventions:**

1. **The genome supplies structure; the store supplies pixels.** A resolver that
   could read an image URL out of the corpus would eventually do it. The
   contract already cannot express one — keep it that way.
2. **Unfillable roles fail loudly.** If a chosen archetype needs a `room` and
   the store has no room scene for that piece, the resolver returns a clear
   miss and the agent picks a different archetype. Silently substituting a blank
   is how a "designed" post becomes a grey box.

**Done when:** given an artwork id and an archetype, `resolveSlots` returns a
`ComposeSpec` that passes `checkComposeFit` with zero errors, and a missing
asset produces a named failure rather than an empty slot.

## 3. P3 — Captions from formulas and the store's own words

The genome's `copyFormulas` give *structure*. The substance already exists and
is under-used: `research/data/artists/v1-index/*.json` carries a `headline`,
`known_for` and `long_description` for ~1,000 artists, and brand.md §Art
Description Formula defines the three-part shape.

**Do:** compose captions as `formula × artwork content × brand voice`, in that
order of precedence — the formula decides the shape, the artwork decides the
substance, brand.md decides the register. Record `copyFormulaRef` on the post so
a caption can always be traced back to the pattern it instantiated.

**The failure to design against:** captions that read as market-average. If a
formula came from the corpus, the *words* must still come from brand.md and the
artwork. A post that could belong to Minted is a failed post even if it converts
(brand.md §Competitive Differentiation).

**Done when:** a caption names the work and artist per the brand's formula,
carries `copyFormulaRef`, and never leads with the artist in a discovery post
(the Nest Curator arrives through the room, not the name).

## 4. P4 — First real posts, through the loop that already exists

No new plumbing. `social_plan_propose` → `social_post_upsert` (with `groupId`
for multi-platform variants) → `resolveSlots` → `compose_design_surface` →
`social_link_design` → `social_review_share` → notes → `social.schedule_post` →
Slack approval → cron.

**Do:** one week of Arthaus posts, end to end, reviewed by a human in the room.
Then publish **one** — the first thing this system has ever actually posted.

**Done when:** a post group renders correctly at each platform's aspect ratio,
survives the review room, and publishes on an approved schedule with consent
intact.

## 5. P5 — Close the evidence loop

Today `evidence.n` is "how many competitor ads showed this". The version that
matters is "how this archetype performed **for Arthaus**".

**Do:** record `archetypeId` on every published post; read back platform
performance; write a store-local `performance` block alongside the archetype —
never overwriting the corpus-derived `evidence`, because they are different
claims and conflating them destroys the honesty the schema exists to protect.

**Done when:** the agent can say "this archetype has run 6 times for this store
and outperforms the pillar median", sourced from Arthaus's own posts, and the
distinction between market evidence and store evidence is visible in the file.

## 6. P6 — Easel: the same engine, one substitution

Easel serves the **Emerging Collector**, where the *artist* is the unit of
interest rather than the room. Almost nothing changes:

| Marketplace | Easel |
|---|---|
| brand.md / DESIGN.md | the artist's **AMS Creative Genome** (palette measured from their own work) |
| retail canonicals (paid ads) | **artist canonicals** from the 504-artist organic corpus |
| room-first pillars | artist-first pillars — process, series, studio |
| store voice | the artist's own voice |

The 504-artist corpus was pulled with images precisely so it can go through the
same extraction and produce artist-native archetypes. That is the Easel
substitution, and it is why the artist cohort was worth the spend.

**Naming, before this ships:** AMS already calls a per-artist palette a
"Creative Genome". Our market reference is also called a genome. Two different
things under one word in one organisation — rename the market one
(*social reference* / *market grammar*) before Easel makes the collision daily.

---

## Sequencing, and what is parallel

```
P1 canonicals→genome ──┐
                       ├─→ P4 first posts ─→ P5 evidence loop ─→ P6 Easel
P2 slot resolution ────┤
P3 captions ───────────┘
```

P2 is the long pole and the only one with real unknowns (room-scene coverage per
artwork). P1 finishes with the current run. P3 is mostly wiring to content that
already exists.

## The risks worth stating

1. **Room-scene coverage.** If most artworks lack a room scene, the
   highest-weighted pillar (`room-in-situ`) cannot be composed. Measure coverage
   in P2 before committing to the pillar weights in `social/strategy.md`.
2. **Market-average drift.** Every step here pulls toward what competitors do.
   The `doNot` list and the brand-dominates hierarchy are the counterweight, and
   they only work if they are enforced in the compose prompt, not just written.
3. **Evidence conflation.** Corpus evidence, research evidence and store
   performance are three different claims. The schema keeps them apart today;
   P5 is where that discipline will be tested.
4. **The corpus ages.** `distilledAt` is visible for a reason. A refresh cadence
   (quarterly is likely right) should be decided, not drifted into.
