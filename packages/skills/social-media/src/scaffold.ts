/**
 * The `social/` store-repo scaffold — the cold-start answer for social
 * (spec 24 §1 paths, spec 26 §1 artifacts-in-git).
 *
 * `scaffoldSocialSystem(opts)` produces the whole `social/` tree for ANY store
 * repo: the authoring guide, a brand-derived starter strategy, and the domain
 * reference lane. Same doctrine as the email pack's `scaffoldEmailSystem` —
 * THE SCAFFOLD IS THE PLATFORM DEFAULT, and real content replaces it later
 * with provenance recorded (a distilled genome replaces the starter genome; a
 * co-created strategy replaces the starter strategy).
 *
 * WHY IT EXISTS: social's paths were defined in code but nothing created them,
 * so a fresh store hit "social/strategy.md not found — co-create the social
 * strategy first" with no way forward. The paths existed; the tree did not.
 *
 * PURE AND DETERMINISTIC: same opts → the same Record, byte for byte. No
 * clocks, no randomness — every stamp comes from `opts`. Repo writes happen at
 * the caller's seam (the `social_scaffold` tool, or a coding-agent session);
 * this never touches git and never overwrites: the tool skips paths that exist.
 *
 * SOCIAL IS GREENFIELD, and that is worth protecting. The email pack had to
 * grow `resolveEmailRoot` because stores already had a hand-built `emails/`
 * before the platform had an opinion — every email path now branches on
 * "email" | "emails" forever. No store has a `social/` convention yet, so this
 * scaffold sets one before that can happen.
 */

import { serializeStrategy } from "./artifacts";
import { serializeGenome } from "./reference";
import type { SocialGenome, SocialStrategy } from "./types";

export interface ScaffoldSocialOptions {
  /** The store's display name — used in prose. */
  storeName: string;
  /** Storefront URL — the default target for posts. */
  storeUrl: string;
  /**
   * Channels the store publishes to. Defaults to instagram; the roster the
   * starter strategy is laid out for.
   */
  channels?: string[];
  /**
   * ISO datetime stamped into generated artifacts (the starter genome's
   * `distilledAt`). Caller-supplied — the generator never reads a clock.
   */
  stampedAt: string;
  /** Opaque domain key for the genome, e.g. "framed-art-retail". */
  domain?: string;
  /** Version stamp recorded in the README (pack or template version). */
  version?: string;
}

function file(body: string): string {
  return `${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// social/strategy.md — the starter strategy
// ---------------------------------------------------------------------------

function starterStrategy(opts: ScaffoldSocialOptions): SocialStrategy {
  const channels = (opts.channels ?? ["instagram"]).map((channel) => ({
    channel,
    register: "TODO — derive from brand.md §9's tone-modulation table for this surface",
    cadencePerWeek: 3,
  }));
  return {
    channels,
    // Deliberately generic and clearly-marked: pillars are the one thing that
    // MUST come from the brand, so the placeholders name where to get them
    // rather than inventing a plausible-looking strategy the owner might keep
    // by accident.
    pillars: [
      { name: "product", messagingRef: "TODO — brand.md §10 messaging framework", weight: 3 },
      { name: "editorial", messagingRef: "TODO — brand.md §10 messaging framework", weight: 2 },
      { name: "proof", messagingRef: "TODO — brand.md §10 messaging framework", weight: 1 },
    ],
    body: file(`
# Social strategy — ${opts.storeName}

> **This is a scaffold, not a strategy.** Every \`TODO\` below is a decision
> that must come from this store's Brand Soul (\`agents/brand/brand.md\`), not
> from a template. Co-create it with the owner, then delete this banner.

## How to finish it

1. **Channels.** For each channel, set \`register\` from brand.md §9's
   tone-modulation table (how the brand's voice changes per surface) and
   \`cadencePerWeek\` from what the store can actually sustain. An honest 2 beats
   an aspirational 5.
2. **Pillars.** Replace each \`messagingRef\` with a real pointer into brand.md
   §10's messaging framework. \`weight\` is the relative share of slots — the
   planner rotates deterministically by weight.
3. **Seasonal arcs** (optional). Add \`seasonalArcs\` for campaigns that own a
   month or two; the planner surfaces them in every slot's rationale.

## The rules the planner enforces

- **Every slot carries its why.** A calendar row without a rationale is not a
  plan. The planner composes each from the pillar, the semantic layer's top
  movers, and the persona's decision architecture.
- **Never engagement bait.** Every post serves the brand AND a commercial or
  editorial intent (\`targetLink\`). If a slot has no honest why, it stays a gap.
- **Drafting is free; publishing is gated.** Plans, copy and creative cost
  nothing and need no approval. Publishing narrows through the Action gate and
  a human Approve in Slack.
`),
  };
}

// ---------------------------------------------------------------------------
// social/reference/genome.md — the starter domain reference
// ---------------------------------------------------------------------------

function starterGenome(opts: ScaffoldSocialOptions): SocialGenome {
  return {
    domain: opts.domain ?? "unset-domain",
    // Three brand-neutral structures that cover most single-image social:
    // enough layout vocabulary to compose against on day one, with n = 0
    // stating plainly that no corpus produced them.
    archetypes: [
      {
        id: "full-bleed-image",
        name: "Full-bleed image",
        description:
          "The image is the whole post; all copy lives in the caption. The safest default and the hardest to get wrong.",
        slots: [{ role: "image", kind: "image", x: 0, y: 0, w: 1, h: 1 }],
        evidence: { n: 0 },
      },
      {
        id: "image-with-caption-band",
        name: "Image with caption band",
        description:
          "Image above a solid band carrying a short line of type — attribution, a title, a price. Use when one fact must travel with the image.",
        slots: [
          { role: "image", kind: "image", x: 0, y: 0, w: 1, h: 0.78 },
          { role: "band", kind: "band", x: 0, y: 0.78, w: 1, h: 0.22 },
          { role: "caption", kind: "text", x: 0.06, y: 0.83, w: 0.88, h: 0.12 },
        ],
        evidence: { n: 0 },
      },
      {
        id: "statement-card",
        name: "Statement card",
        description:
          "Type on a plain ground — a line of editorial voice with no photograph. Use sparingly; it reads as a pause between images.",
        slots: [
          { role: "ground", kind: "band", x: 0, y: 0, w: 1, h: 1 },
          { role: "statement", kind: "text", x: 0.1, y: 0.34, w: 0.8, h: 0.32 },
        ],
        evidence: { n: 0 },
      },
    ],
    register: {
      treatment:
        "TODO — replace with what this store's market actually looks like. Until then the brand's own DESIGN.md governs entirely.",
      doNot: ["TODO — domain anti-patterns, once a corpus exists"],
    },
    distilledAt: opts.stampedAt,
    provenance: [
      {
        claim:
          "scaffold default — generic archetypes, distilled from NO corpus (evidence.n = 0). Replace by running the store's acquisition + distillation lane.",
        origin: "agent",
      },
    ],
    body: file(`
# Domain reference (starter)

These archetypes are **platform defaults**, not observations: \`evidence.n\` is
0 for every one because no corpus produced them. They exist so composition has
a layout vocabulary on day one instead of free-handing geometry.

Replace them by running this store's acquisition + distillation lane (see
\`README.md\` in this folder). When you do, keep the provenance honest — the
whole point of \`evidence\` is that a reader can tell a real observation from a
placeholder.

**The hierarchy never changes:** the brand dominates, the genome informs. If a
market convention conflicts with \`brand.md\` / \`DESIGN.md\`, the brand wins.
`),
  };
}

// ---------------------------------------------------------------------------
// READMEs
// ---------------------------------------------------------------------------

function referenceReadme(): string {
  return file(`
# Domain reference — the acquisition lane

The **genome** is this store's outward reference: what its market currently
looks like, expressed as layout archetypes, an editorial register and copy
formulas. It sits beside \`brand.md\`'s inward one.

> **The hierarchy is not negotiable.** \`brand.md\` DOMINATES — palette, type,
> voice, subject. The genome only INFORMS structure and domain fluency. A post
> that reads like the competition is a failure even if the market rewards it.

## The split — and why acquisition lives HERE

The platform owns the **contract**: the genome schema, archetype resolution,
and the \`social_genome_read\` tool. It never scrapes, fetches, or names a
vendor.

This store owns the **content**: which competitors matter, which scraper,
which credentials, and how often it refreshes. That is domain-specific, often
paid, and bound by a third party's terms — so it belongs in this repo, not in
the shared pack.

## The loop

1. **Identify the domain.** A research session lists the stores and creators
   whose social actually defines this market. Record them in \`seeds.md\` with
   the reason each one earns its place — a seed list without rationale rots.
2. **Acquire.** Pull those accounts' recent posts into \`corpus/\` with whatever
   tool you have chosen. \`corpus/\` is **gitignored**: it is bulk third-party
   content and must never enter version control.
3. **Distil.** Turn the corpus into \`genome.md\` against the platform schema —
   layout archetypes with normalised 0–1 geometry, an editorial register, copy
   formulas. Set \`evidence.n\` honestly: it is how a reader (and the agent)
   tells an observation from a guess.
4. **Review.** \`genome.md\` is human-readable on purpose. Read what the agent
   concluded your market's grammar is, and correct it, **before** it informs a
   single post.

## Rules that are not style preferences

- **Abstractions, never assets.** The genome carries structure and tone. It
  must never carry, and the contract cannot express, a competitor's pixels.
  Exemplars are third-party copyrighted work — for an art brand, emphatically
  so. Reference informs how a post is built; it never supplies what is in it.
- **Attribution is not a fetch target.** \`sources\` exists for auditability.
- **Staleness is visible.** \`distilledAt\` ages in the open; trends decay, and
  a year-old genome should look a year old.

## Files

| File | What it is |
|---|---|
| \`seeds.md\` | who defines this domain, and why (input to acquisition) |
| \`corpus/\` | raw pulled posts — **gitignored**, never committed |
| \`genome.md\` | the distilled reference the agent actually reads |
`);
}

function socialReadme(opts: ScaffoldSocialOptions): string {
  const stamp = opts.version ? ` (Marketing OS ${opts.version})` : "";
  return file(`
# ${opts.storeName} — Social

The store-repo home for social: strategy, calendar, posts, and the domain
reference${stamp}. **Files are truth**; the database is a rebuildable index.
Future coding-agent sessions: read this file first, then \`strategy.md\`.

## Tree

\`\`\`
social/
├── README.md              # this file
├── strategy.md            # channels, registers, pillars, cadence — the standing strategy
├── calendar/
│   └── {YYYY-MM}.md       # the month's plan, one row per planned post
├── posts/
│   └── {id}/post.md       # the post spec: caption, link, creative binding, provenance
└── reference/
    ├── README.md          # the domain-reference (genome) lane
    ├── seeds.md           # who defines this market, and why
    ├── genome.md          # the distilled layout/tone reference
    └── corpus/            # raw pulled posts — gitignored
\`\`\`

Every artifact is YAML front matter + markdown, the same physical format as
\`brand.md\`, and round-trips exactly: edit it by hand or let the agent write
it, and the other side still parses.

## How the pieces relate

**brand.md → strategy.md → calendar → post → creative → approval → publish.**

The Brand Soul decides who the store is. The strategy turns that into channels,
registers and pillars. The planner lays a month out from the strategy
deterministically. Each post gets a caption, a target link, and a creative
composed on the Design Studio canvas. Publishing is the only gated step.

## Tailoring this store (the part that matters)

Everything here is **meant to be edited**. The scaffold is a starting point,
not a configuration you accept:

- \`strategy.md\` ships full of \`TODO\`s that name exactly which brand.md section
  each decision comes from. Finish them with the owner.
- \`reference/genome.md\` ships with \`evidence.n = 0\` on every archetype — those
  are platform defaults, not observations about your market. Replace them by
  running the acquisition lane in \`reference/README.md\`.
- Post copy is instantiated from the brand's copy formulas, never free-styled.

## Working with a coding agent

This repo is the interface. Three ways in, all editing the same files:

**1. The store console (chat).** Ask in the console attached to this store.
The agent reads and writes these artifacts through its tools —
\`social_plan_propose\` to lay out a month, \`social_post_upsert\` to author,
\`compose_design_surface\` to make the creative, \`social_genome_read\` for domain
grammar. Best for day-to-day authoring; no local setup.

**2. A Claude Code session over MCP.** Connect the store's MCP endpoint and
work conversationally with the same governed tools plus the store's data
(analytics, catalogue). Best for analysis-shaped work — "what actually sold
last month, and what should September say?" — because the agent can query and
author in one thread.

**3. This repo, cloned, with a coding agent in it.** Clone and open a
coding-agent session directly on the files. Best for the deep, structural work:
rewriting \`strategy.md\` from a brand refresh, hand-tuning \`genome.md\` after a
distillation, building the acquisition lane, or bulk-editing a month of posts.
Nothing here needs the platform to be edited — they are plain markdown files.
Commit, and the console picks the changes up.

Whichever you use, the same rules hold:

- **The agent proposes; a human approves.** Drafting is free. Publishing goes
  through the Action gate and a real Slack approval — a review link is a
  conversation, never an authorisation.
- **Say where facts come from.** Every data claim carries \`provenance\` with its
  origin (\`owner\` / \`agent\` / \`data\`).
- **Edit the artifact, not the index.** The database is derived; if it
  disagrees with these files, the files win and the index is rebuilt.

## Guardrails worth knowing before you edit

- Editing a **scheduled** post's caption, link, channel, assets or time voids
  its approval and drops it back to \`asset_ready\` — the approval card re-arms.
  That is deliberate: what was approved is exactly what ships, or it re-asks.
- **Published posts are frozen.** The artifact is the record of what went out;
  work on a new id instead.
- Editing the **canvas** after approval is caught too — the bound design's
  revision is pinned at approval time and re-checked before publishing.
`);
}

function seedsDoc(opts: ScaffoldSocialOptions): string {
  return file(`
# Domain seeds — who defines this market

Input to the acquisition lane. Each row is an account whose social genuinely
shapes what "good" looks like for ${opts.storeName} — a competitor, a category
leader, or a creator whose work the audience already follows.

**A seed list without rationale rots.** Six months on, nobody remembers why a
handle is here, so nobody can tell when it stops belonging. Say why.

| Handle / URL | Kind | Why it belongs |
|---|---|---|
| TODO | retail / creator / editorial | TODO — what this account does that matters |

## Choosing well

- **Curated beats exhaustive.** Fifty accounts you can defend produce a better
  genome than five hundred scraped by category.
- **Retail and creators are different signals.** Storefronts show how a market
  sells; individual creators show what the audience already likes. Keep the
  distinction in \`kind\` so distillation can weight them separately.
- **Adjacent, not identical.** A list of direct competitors teaches the agent
  to look like a competitor. Include the accounts setting the visual standard
  even when they sell something else.
- **Re-read this list when the genome is refreshed.** Trends move; so should
  the seeds.
`);
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * The whole `social/` tree as path → content. Deterministic; the caller
 * decides what to write (the `social_scaffold` tool never overwrites).
 */
export function scaffoldSocialSystem(opts: ScaffoldSocialOptions): Record<string, string> {
  return {
    "social/README.md": socialReadme(opts),
    "social/strategy.md": serializeStrategy(starterStrategy(opts)),
    "social/reference/README.md": referenceReadme(),
    "social/reference/seeds.md": seedsDoc(opts),
    "social/reference/genome.md": serializeGenome(starterGenome(opts)),
    // Raw third-party corpus must never enter version control: it is bulky,
    // it is someone else's copyrighted work, and the genome distilled FROM it
    // is the only thing worth keeping.
    "social/reference/corpus/.gitignore": file(`
# Raw acquired reference content — never committed.
# Bulk third-party copyrighted material; the distilled genome.md is the
# artifact of record. See ../README.md.
*
!.gitignore
`),
    // git does not track empty directories; these keep the tree legible.
    "social/calendar/.gitkeep": "",
    "social/posts/.gitkeep": "",
  };
}
