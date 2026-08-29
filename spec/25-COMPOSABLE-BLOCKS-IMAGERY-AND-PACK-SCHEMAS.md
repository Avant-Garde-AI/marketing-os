# 25 — Composable Blocks, Resolved Imagery & Pack-Owned Schemas

> **Status:** TRD / THESIS — written to be expanded into full specifications. Sections marked **⟨EXPAND⟩** are deliberately shallow: they carry the intent and the constraints, not the design. Decisions already made are marked **DECIDED**; open ones are collected in §9.
> **Depends on:** 20-CAPABILITY-SUITE (reads compose freely, writes are Actions), 22-BRAND-SOUL (blocks and copy derive from the soul; files are truth, DB is a rebuildable index), 23-DESIGN-SURFACES-PENPOT (the pixel-exact lane blocks defer to), 24-SOCIAL-MEDIA-AGENT (the second consumer of everything here).
> **First target:** Arthaus. **Written:** 2026-08-29, from a working email-agent build.

---

## 0. Thesis

Three things surfaced from building the Email Campaign Agent against a real store, and they are one idea in three places.

**A creative agent is only as good as the vocabulary it composes with.** Ours started with five primitives — heading, paragraph, button, productRow, spacer — and produced emails that were *correct* and visibly plainer than the store's hand-authored templates. Introspecting Arthaus's `emails/` folder found the gap precisely: an eyebrow kicker, a pull-quote, a charcoal CTA band, a featured-set card, numbered and checkmark lists. Adding them closed most of the quality gap in a day. That is the tell: **the vocabulary, not the model, was the ceiling.**

**But a fixed vocabulary just moves the ceiling.** The next store has a different idiom. The interesting unit is not "more primitives" — it is a **store-owned library of composed, named, semantic blocks** that the agent derives from the store's own material, maintains, and composes with. ESPs ship a fixed block palette; the value here is a palette *authored for the brand and evolving with it*. That is what makes "create emails by talking to Claude" real rather than aspirational.

**And a block is only declarative if what fills it is resolvable.** A `hero` block that hardcodes a URL is a snippet. A `hero` block that declares *"lifestyle, room-forward, portrait, warm"* and is satisfied by a resolver — existing asset, composited mockup, or generated scene — is a capability. Imagery is the first such capability; it will not be the last.

All three need somewhere to live. Blocks and policy are **files in the store repo**; compilations and their ESP linkage are **rows in Supabase**. Which exposes the fourth thing: a pack currently cannot declare its own tables. That is fine for first-party packs and fatal for an ecosystem.

**The invariant that holds the whole thing up:** *a block composes primitives; it never emits raw HTML.* Deliverability hardening (VML buttons, MSO ghost tables, `mso-line-height-rule`, inline-everything, fluid-hybrid columns) is won once in code and must never be re-litigated by a generated string. Every design below is downstream of that line.

---

## 1. The two-layer model — **DECIDED**

| Layer | Owner | Form | Open/closed | Changes by |
|---|---|---|---|---|
| **Primitives** | platform | TypeScript renderers + zod schema | closed set | platform release |
| **Composed blocks** | store | data (front matter + composition) | open set | agent proposal → human review → git |

**Primitives** are the hand-hardened set in `@avant-garde/email-assembly`: `heading`, `paragraph`, `button`, `productRow`, `spacer`, `eyebrow`, `image`, `callout`, `ctaBand`, `featuredCard`, `list`, `swatches`, `chips`, `trustBadges`, `divider`, `graphCallout`. They exist because email clients are hostile; their comments carry the reasons and those reasons are load-bearing.

**Composed blocks** are named compositions with typed parameters — `artist-intro`, `gallery-wall-set`, `three-promises`, `how-it-ships`, `palette-story`. They are the brand's vocabulary, not the platform's.

Why the split, stated plainly: **rendering correctness is a platform concern; brand expression is a store concern.** Regenerating a VML button per store is how you get an email that renders as bare text in Outlook. Hardcoding "the Arthaus eyebrow" into the platform is how you get every store looking like Arthaus.

### 1.1 The precedent this generalises

`emails/partials/` + `<!--PARTIAL:name-->` + `composePartials` is this idea already, one abstraction level down: shared components, marker substitution, deterministic composition. The block library is its typed, parameterised successor. `composePartials` stays — it is how the *frame* is assembled; blocks fill the slots inside it.

---

## 2. Block definition ⟨EXPAND⟩

**Constraints the format must satisfy** (the design is open; these are not):

1. **Human-editable and reviewable in a PR.** The pack's doctrine is markdown + YAML front matter for human artifacts (`strategy.md`, `campaign.md`, `AGENT.md`) and JSON for machine registries. A block is a human artifact.
2. **Typed parameters.** `artist-intro` takes `{ artistName, aesthetic, image, ctaHref }`. Params are what make a block reusable rather than a snippet, and they give the model a narrow, *validatable* surface. This matters more than it sounds: a flat, permissive schema let `gemini-2.5-flash` repeatedly put heading copy in an `alt` field. Narrow typed args are a correctness mechanism, not ergonomics.
3. **Composition is a primitive tree**, never a string of HTML. Enforced at parse, not at review.
4. **Provenance and version**, same treatment as `brand.md`: who/what authored it, when, why.
5. **Usage guidance for the agent** — when to reach for this block, when not to. The agent reads its own library.

**Open:** whether composition is expressed declaratively (a nested structure) or as a pure function over params. Declarative is inspectable and diffable; functional is more expressive. Lean declarative until something demands otherwise.

---

## 3. The library in the repo ⟨EXPAND⟩

Blocks live under the store's email root — `emails/blocks/` for a store with an existing Klaviyo system, `email/blocks/` for a scaffolded one (root auto-detected; see §5.1).

**Registry discipline** follows `klaviyo-registry.json`, which is proven: committed, slug-keyed, PATCH-not-duplicate, team-shared.

**The Klaviyo round-trip is the sharpest opportunity here.** Klaviyo has *universal content blocks*, and the pack's client already models `KlaviyoUniversalContentBlock` (the path was live-validated in July). A store block that syncs to a universal content block becomes **editable by the marketing team in Klaviyo's own UI** — the agent designs it, the team tweaks it, and the repo stays the source of truth. Getting the reconciliation direction right (repo wins? last-writer-wins? divergence flagged?) is a real design question, not a detail.

---

## 4. Derivation — the onboarding unlock ⟨EXPAND⟩

The agent should **derive** a store's library, not invent one.

The machinery mostly exists: `extractSkeleton` already turns a reference template into a slotted frame, and the `emails/` introspection already surfaced the recurring patterns latent across 19 hand-authored templates. The missing piece is *pattern → block proposal*.

Flow: ingest the store's templates → cluster recurring structures → propose a named, parameterised library in the store's own idiom → human approves → committed.

**Why this is the product moment:** a new store goes from "connect Klaviyo" to "make me an artist drop" and gets something on-brand *on day one*, because the blocks carry the brand. Without derivation, every store starts at the plain-vocabulary floor we started at.

---

## 5. Imagery as a resolved capability — **PARTLY BUILT**

### 5.1 What is already true (built, deployed, verified 2026-08-29)

`lib/imagery/resolve.ts` (hosted-agents, template, console). A caller supplies a **role**, never a URL:

| Tier | Mechanism | Cost / latency | Status |
|---|---|---|---|
| 1 `given` | image the caller already holds | free | inconsistent — the art graph keeps one image per artwork; may be a flat scan or an off-brand frame |
| 2 `compose` | AMS `POST /external/compose` — composite into the 22-room built template library | ~$0, ~8s, 5 slides | **live**; uses no image generation, so unaffected by the Gemini spend cap |
| 3 `scene` | AMS `POST /external/scene` — novel scene from prose | pro image model, ~20s | **built**, blocked on an AI Studio spend cap |

**House rules — DECIDED, and each one is a bug we hit:**
- **Oak primary**, black/walnut alternate.
- **Never white.** A white frame + white mat on a parchment wall renders the artwork as a small island in an oversized white slab.
- **Square art never gets a room.** 0 of 187 templates are square and the compositor is `fit: cover`, so a square piece is silently centre-cropped.
- **Treatment by role:** editorial and room-recommendation get the work in a space; artist-drop and product get the leaning shot. **Leaning is the universal fallback** — no room context to clash with the work.

The resolver returns the winner **plus ranked alternatives, each carrying the reason it ranked there**, and a provenance string. That is what makes §5.2 possible.

### 5.2 Selection ⟨EXPAND⟩ — **policy DECIDED, mechanism open**

Rules narrow to 2–3 candidates; a **vision pass picks; a human can override** (DECIDED). Every pick is *recorded* with its rationale, so it is reproducible and arguable rather than a mystery URL.

Open: where the override surfaces (console picker vs chat), and whether a human override becomes a durable preference for that artwork or a one-off.

### 5.3 Durability — a hard constraint

Composed URLs are **signed and expire in 24h**. Fine for a preview; anything that will be *sent* must be uploaded to the ESP first. The email draft Action already does this for surface sections, so the pattern exists — but any new consumer must honour it. `expiresInMinutes` rides the payload so a caller cannot mistake one for durable.

### 5.4 Caching, and why it compounds ⟨EXPAND⟩

`externalRef` seeds template selection deterministically: same ref → same rooms. Key it on the **artwork handle** rather than the campaign and the same piece resolves to the same imagery across every campaign — cheaper *and* more brand-consistent. Over time the store accumulates a curated "the shot we use for this piece" set: an asset index that is genuinely valuable and did not have to be curated by hand.

### 5.5 Where it lives — **DECIDED**

Beside `design-surfaces`, **not** inside `email-campaign`. Social wants the identical capability. It is a platform capability consumed by packs.

---

## 6. Storage split — **DECIDED**

| Concern | Home | Why |
|---|---|---|
| Block library, imagery policy, "what kind of shot this email type wants" | **store repo** | brand policy: versioned, diffable, reviewable in a PR, survives a DB restore |
| Campaign compilations, ESP linkage (template/campaign/message ids), send state, readback | **Supabase** | operational state with foreign keys into an external system; must survive a repo checkout |

This is the existing doctrine — *files are truth, the DB is a rebuildable index* — applied to two genuinely different kinds of thing. The email cron already proves it: it rebuilds `mos_email_campaigns` and `mos_calendar_items` from the artifacts on every pass.

---

## 7. Pack-owned schemas ⟨EXPAND⟩ — the gap this exposes

The email pack's tables (`mos_email_campaigns`, `mos_calendar_items`, `mos_email_artifacts`) arrived as **platform migrations 005–007**. That works for first-party packs and breaks the moment packs are pluggable: name collisions, no ownership, no teardown, no per-pack versioning.

**Direction (not yet a design):**

- **A schema per pack** — `pack_email`, `pack_social` — rather than prefixed tables in `public`. Clean ownership, trivial teardown, collision-free for third parties.
- **Migrations ship with the pack** and are applied **on enablement**, so installing a pack is what creates its tables.
- **Cross-pack contracts stay platform-owned.** `mos_calendar_items` is already exactly this: the cross-channel projection every pack writes into. It stays in `public` and is the published contract; pack schemas stay private.
- **Tenant isolation stays as-is** — `tenant_id` + RLS. Per-tenant schemas do not scale.

**The decision that actually matters** is the trust boundary: does a pack's migration run with DDL privileges at enablement (powerful, and a real hazard for third-party packs), or does a pack *declare* a schema that the platform applies after review? First-party can take the former. An ecosystem cannot.

---

## 8. How a team actually works ⟨EXPAND⟩

The loop this is all in service of:

1. **Library** — the agent derives blocks from the store's templates; a human reviews the PR.
2. **Plan** — the agent proposes a month from `strategy.md`; every slot carries its why.
3. **Compose** — a campaign is assembled from blocks; imagery resolves from declared intent.
4. **Review** — console list → detail → live preview (rendered by our engine, so it works before anything exists in the ESP).
5. **Approve** — through the Action gate; each send approved individually.
6. **Read back** — the cron reconciles the index and watches for out-of-band edits in the ESP.

**Known gaps in that loop today:** the console is **read-only** — a human who disagrees with a pick has no edit affordance and must go through chat or the repo. And ESP push is Slack-only by design (spec 20); whether the backlog view should be able to stage to the ESP directly is an open product question, not a missing feature.

---

## 9. Open decisions

| # | Decision | Notes |
|---|---|---|
| D1 | Block definition format — declarative tree vs function over params | §2. Lean declarative. |
| D2 | Klaviyo universal-content reconciliation direction | §3. Repo-wins is simplest; team-edits-in-Klaviyo is the valuable case. |
| D3 | Does a human imagery override become a durable per-artwork preference? | §5.2 |
| D4 | Pack migration trust boundary — DDL at enablement vs declare-and-review | §7. The ecosystem question. |
| D5 | Console: read-only, or does it gain block/campaign editing? | §8 |
| D6 | Should the backlog view stage to the ESP directly, or does approval stay Slack-only? | §8, changes the spec-20 gate posture |
| D7 | Block versioning vs already-sent campaigns — does a sent campaign pin its block versions? | implied by §2.4 provenance |
| D8 | Cross-store "starter" blocks, or per-store derivation only? | §4 |

---

## 10. What exists today (so an expander knows the floor)

**Built and live:** 16 primitives (130 tests); the auto-detected email root (`emails/` vs `email/`); campaign output landing in the store's `templates/` dir + registry; the imagery resolver with house rules (tiers 1–2); AMS `/external/scene` for tier 3; 15 tools on MCP (8 semantic + 2 imagery + 5 email reads); the console read surfaces (`/email`, `/email/campaigns/[id]`, `/calendar`) and the reconcile cron; `AGENT.md` per-store agent override; the Picasso art-graph grounding (`explore_concept`, `search_artworks`, `recommend_similar`, `get_artwork_facets`, `concept_walk` → editorial callouts).

**Not built:** the block library as an artifact (blocks are still a code-level vocabulary); derivation; imagery caching/asset index; pack-owned schemas; any console edit affordance; vision-based selection.

**Blocked on credentials, not code:** tier-3 scene generation (AI Studio spend cap) and the deployed imagery resolver (`AMS_MOCKUP_SERVICE_KEY` not yet in Vercel).
