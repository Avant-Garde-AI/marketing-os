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
| Layout extraction | S0–S6 **re-running against Vertex** (the first full pass was mock — see P1); canonicalization driver merged (creative-agent #1) |
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

**Check the provider before believing any of it.** `run.yaml` ships
`inference.provider: mock`, and the mock is not obviously fake: it completes
261 ads without a single failure, and canonicalization happily returns three
clusters at 94% coverage. Those clusters are synthetic. The tell is in the
artifact — `provenance.provider` on every `template_spec.json`, and the fact
that a mock spec has exactly one zone (`z0`, type `hero`) where a real one has
eight to twelve with named roles. **A clean run is not evidence that the run
was real.** Assert on `provider == "vertex"` before canonicalizing.

**Where the geometry actually is.** A real spec splits what the genome needs
across two keys, joined on `zone_id`:

- `skeleton.zones[]` — `bbox: [x, y, w, h]`, already normalized 0–1, which is
  the genome's coordinate system exactly (no conversion, no scaling);
- `zones_semantic[]` — `zone_type` per `zone_id` (`headline`, `hero_product`,
  `logo`, `cta_button`, `background_field`, …), which becomes the slot `role`.

`zones_semantic[].bbox` is null and `canvas`/`slots`/`quality` are empty; that
is expected, not damage. Read geometry from the skeleton.

**Done when:** the genome parses, every archetype resolves in-bounds at
1080×1080/1350/1920, `evidence.n` is a real count, and the specs behind it say
`vertex`. The brand-derived archetypes stay as a labelled fallback for roles
the corpus never showed.

## 2. P2 — Slot resolution (the crux)

A `role` is a *contract for what belongs there*, and the store must be able to
satisfy it from its own catalogue.

**Built** — `packages/skills/social-media/src/resolve.ts`. `resolveSlots`
returns filled slots plus **named misses**; `assertComplete` is the loud
version; `chooseArchetype` picks the strongest archetype the store can actually
fill (fillability filters `rankArchetypes`' order rather than replacing it);
`missingRoles` inverts it to show what a store must produce to unlock each
archetype. Pure — no I/O, no clock, no randomness. What remains here is
**binding the roles to real Arthaus content**, below.

The resolver is a map from role → asset source:

| Role | Source | Notes |
|---|---|---|
| `work` | the artwork image | the actual piece; never a mockup composited into a room (AMS already forbids this) |
| `room` / `wall` | Arthaus room scenes — **generated, not scarce** (see below) | AMS `apply-room-scenes.js` / `batch-shoppable-rooms-compose.js` |
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

**Room-scene coverage is not the constraint it was assumed to be.** The plan
opened with "measure coverage before trusting the pillar weights", on the
assumption that room scenes are a scarce pre-existing asset. They are not:
AMS composites them on demand with sharp from a 35-template library
(`lib/content/mockup/rooms.json`) — no model call, ~$0 per artwork — and
`--target` styles the templates to an artist's own palette so scenes stop
looking uniformly Arthaus-terracotta. Coverage is therefore ~100% by
construction, and `room-in-situ` can carry the highest pillar weight in
`social/strategy.md` as written.

What this converts into is a **selection** problem rather than an availability
one: each room template carries `mood`, `color_temperature`, `primary_room` and
a palette, so the resolver should choose the room that suits the work instead of
taking the first. That is a better problem to have and it is squarely inside
P2.

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

**Built** — `social/bindings/caption.mjs` (Arthaus PR #57), as two functions
rather than a generator. Writing a caption worth publishing is a model's job; a
template that slots a work title into a sentence produces precisely the
market-average copy this section warns about. So `captionBrief` assembles the
inputs (formula structure and example, the work's facts, the register, and the
`doNot` list **verbatim**) and gets out of the way, while `checkCaption`
enforces what is mechanical.

Enforceable, each traced to the brand line it comes from: price-led copy,
urgency devices, artist-CV formality, and opening a *discovery* post on the
artist's name. The last is conditional — `intent: "artist-feature"` disables it,
because a feature legitimately opens on the artist, and naming them in sentence
two is the formula working.

**The limit is stated in the module, not glossed.** "Twee or cutesy", "dense
grids", "e-commerce chrome" are matters of taste and of *image*; no regex sees
them. `checked` names exactly what was verified so a clean result reads as
"nothing mechanical is wrong" and never as "this is on brand" — the review room
still decides that. The linter is also deliberately not over-eager: "we never
compete on price" and "priceless" both pass, because a linter that cries wolf
gets switched off and then protects nothing.

Sanity check worth repeating after any rule change: all four of the genome's own
formula `example`s pass the genome's own rules. Exemplars that failed would mean
the rules were wrong, not the examples.

**Done when:** a caption names the work and artist per the brand's formula,
carries `copyFormulaRef`, and never leads with the artist in a discovery post
(the Nest Curator arrives through the room, not the name).

## 4. P4 — First real posts, through the loop that already exists

No new plumbing. `social_plan_propose` → `social_post_upsert` (with `groupId`
for multi-platform variants) → `resolveSlots` → `compose_design_surface` →
`social_link_design` → `social_review_share` → notes → `social.schedule_post` →
Slack approval → cron.

**The review surfaces are already at parity with email — the gap is content,
not plumbing.** Worth stating plainly, because the email agent's month-sheet
handoff is the model here and it is easy to assume social needs building:

| surface | email | social |
|---|---|---|
| console index | `app/email/page.tsx` | `app/social/page.tsx` |
| console detail | `app/email/campaigns/[id]` | `app/social/posts/[id]` |
| month contact sheet | `app/review/email/page.tsx` | `app/review/social/page.tsx` |
| review room | `app/review/email/[id]` | `app/review/social/[id]` |
| tokened share link, notes, resolve | ✓ | ✓ |

Spec 26 built all of it, plus `postCalendarProjection`, post grouping and
thumbnails. `social_post_upsert`, `social_link_design`, `social_review_share`
and `social_review_notes(_resolve)` all exist. Nothing structural is missing —
**no month of posts has ever been planned**, so the sheet has nothing to show.
One planning run produces the same handoff link email gives you.

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

1. ~~**Room-scene coverage.**~~ **Retired.** Room scenes are generated on
   demand by AMS from a 35-template library at ~$0 and no model call, so
   coverage is ~100% and `room-in-situ` is safe to weight highest. What remains
   is choosing the *right* room (each template carries mood, colour temperature
   and palette) — a selection problem inside P2, not a supply risk.
2. **Market-average drift.** Every step here pulls toward what competitors do.
   The `doNot` list and the brand-dominates hierarchy are the counterweight, and
   they only work if they are enforced in the compose prompt, not just written.
3. **Evidence conflation.** Corpus evidence, research evidence and store
   performance are three different claims. The schema keeps them apart today;
   P5 is where that discipline will be tested.
4. **The corpus ages.** `distilledAt` is visible for a reason. A refresh cadence
   (quarterly is likely right) should be decided, not drifted into.
