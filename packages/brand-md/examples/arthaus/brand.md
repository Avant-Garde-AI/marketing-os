---
spec: brand.md/v0
name: Arthaus
version: 1
updated: 2026-07-10
source: "Arthaus Brand Definition & Direction Guide v1.0 (April 2026, owner-approved)"
provenance-legend: [owner, agent, data]

essence:
  line: "Art that lives where you do."                          # @owner
  meaning:
    - "Art, not decor — real art by real artists, never intimidating"
    - "Lives — alive, evolving with taste; drops, refreshed curation"
    - "Where you do — start from the buyer's space, not the gallery"
north_star:
  statement: >-                                                  # @owner
    A customer describes Arthaus to a friend as: "It's where I found the
    perfect art for my apartment — they made it so easy to figure out exactly
    what would look good in my space, and I feel great knowing I'm supporting
    real artists."
  signals: [spatial-confidence, ease, visual-fit, ethical-resonance]

positioning:                                                     # @owner
  for: "design-driven professionals (28–40, $80K–$150K HHI) furnishing urban/suburban homes"
  is: "the curated art marketplace"
  that: "makes it effortless to find, visualize, and display real art that belongs in your specific space"
  unlike: ["gallery platforms (Artsy, Saatchi)", "mass-market decor (Society6, Amazon)", "home retailers (CB2, West Elm)"]
  because: "deep art knowledge graph + design-first curation"
  wedge: ["room-first discovery", "pre-curated gallery-wall sets", "turnkey framing & fulfillment"]

promise:                                                         # @owner
  - spatial-confidence   # see it in your space before you buy
  - effortless-quality   # archival, ready to hang, transparent specs
  - artist-connection    # transparent compensation, artist stories

personas:
  primary:                                                       # @owner
    name: "The Modern Nest Curator"
    sketch: "design-driven, time-pressed professional, 28–40, $80K–$150K HHI, urban/suburban US-CA-UK-WEU"
    mental_model: "thinks in rooms, not artists — art is a design decision, not an investment decision"
    decision_hierarchy:            # 0–100 weights; ordered — the single most machine-usable brand asset
      room_first_visual_fit: 98
      curated_sets_discovery: 92
      turnkey_framing_fulfillment: 90
      material_print_quality: 88
      artist_support_ethics: 85
      price_transparency: 80
    discovers_via: [pinterest, instagram-reels, design-blogs, google-longtail, word-of-mouth]
    competitive_set: [CB2, West Elm, Minted, Juniper, Desenio, Framebridge, Etsy-standouts]  # NOT Artsy/Saatchi
  secondary:                                                     # @owner
    name: "The Emerging Collector"
    sketch: "culturally engaged professional, 35–55, $125K–$175K+ HHI, major metro"
    mental_model: "thinks in artists and series — leads with narrative, provenance, edition scarcity"
    served_by: "Easel experience layer (graduation path, behavior-classified — never forced self-identification)"

voice:                                                           # @owner
  essence: "a brilliant friend who happens to have incredible taste — knows art deeply, never makes you feel you should already know it"
  pillars:
    - curatorial-confidence-not-gatekeeping
    - room-forward-not-art-forward
    - artist-intimacy-without-worship
    - effortless-sophistication
  never:
    - "vague superlatives (stunning, breathtaking)"
    - "art-world vocabulary as credentialing"
    - "multiple exclamation marks or ALL CAPS (max one ! per 1,000 words)"
    - "passive voice or hedging (may enhance, could transform)"
    - "'museum quality' without material evidence"
    - "surprise fees or misleading price anchors"
  tone_by_context:
    homepage: "warm, aspirational, inviting"
    product_page: "confident, spatial, specific"
    academy_article: "knowledgeable, helpful, conversational"
    email_nurture: "warm, personal, gently suggestive"
    performance_ads: "direct, visual, benefit-first"
    error_empty_state: "honest, light, human"
    ai_concierge: "friendly expert, never robotic"

ai_voice_rules:                                                  # @owner — inject into every conversational agent turn
  - "Never reference the technology — 'I think this would look beautiful next to the Soto print', never 'based on our AI analysis'"
  - "Always start from the space — 'for that wall above your sofa…', never 'here are some prints you might like'"
  - "Give reasons, not just recommendations — explain why pieces work"
  - "Be opinionated — the concierge has taste ('Honestly? I'd skip the black frame here.')"
  - "Know when to stop — recommend 2–3 options, never 20; the value is the edit"
  - "Entry prompt is spatial-first: 'What room are you working on?'"

conversion:                                                      # @owner
  priorities:
    - "gallery-wall sets as first-class products (the Nest Curator buys in groups of 2–4)"
    - "confidence before conversion (AR/mockup + size guide above the fold)"
    - "room-first discovery (spatial nav primary; genre/medium/artist secondary)"
    - "progressive depth (spatial fit first; specs and artist story layered, never dumped)"
  pricing:
    individual_unframed: "$20–$120"
    individual_framed: "$60–$350"
    sets_framed: "$75–$500+"
    limited_editions: "$150–$800+"
    rules: ["always show framed + unframed side by side", "bundle savings explicit", "total landed cost before checkout", "flexible payment over $100"]

guardrails:                                                      # @owner — non-negotiable
  - "no dark patterns"
  - "no fake urgency or discount shouting"
  - "no surprise fees at any point"
  - "artist compensation stays transparent"
  - "WCAG AA accessibility floor"
  - "never force collector/decor self-identification — classify by behavior"

health_metrics:                                                  # @data — re-derive via semantic layer
  spatial_confidence: [ar_preview_usage, set_vs_individual_cvr, framed_return_rate]
  effortless_quality: [landing_to_purchase_time, checkout_abandonment, repeat_90d]
  artist_connection: [artist_page_views_per_session, meet_the_artist_open_rate]
  business: [aov_by_unit_type, ltv_12m_by_channel, set_attach_rate, collector_graduation_rate]

design_ref: ./DESIGN.md
---

# Arthaus — Brand Soul

> **Art that lives where you do.**
> This document is the organizing principle for everything Arthaus creates,
> communicates, and builds. Every product decision, every piece of copy, every
> UX interaction, and every ad must be traceable back to it.

## Essence & North Star

**Art, not decor.** Real art by real artists — provenance, archival quality,
creative intention — never a print-on-demand commodity, and never intimidating.
**That lives.** Art here is alive: it evolves with your taste, changes a room's
energy, refreshes through drops and thematic curation. **Where you do.** We
start from your space — your living room, your first apartment, your forever
home — not from the gallery.

The brand is succeeding when a customer says: *"It's where I found the perfect
art for my apartment — they made it so easy to figure out exactly what would
look good in my space, and I feel great knowing I'm supporting real artists."*
That sentence contains every signal we engineer for: spatial confidence, ease,
visual fit, ethical resonance.

## Mission, Vision & Purpose

**Mission:** make it effortless for design-conscious people to find and display
art that transforms their homes into spaces that feel unmistakably theirs —
while every purchase directly supports independent artists.

**Vision:** a world where every home has real art on its walls — chosen with
confidence, displayed with pride, connected to the artists who made it.

**Purpose:** two underserved needs meet here. Buyers want real art that fits
their space, but the art world feels gatekept or disconnected from how they
live — so they default to mass-market decor or empty walls. Artists need
sustainable income and direct access to people who'll love their work, but
platforms either commoditize them or gatekeep them. Arthaus bridges the gap
with technology, curatorial intelligence, and design-first presentation.

## Positioning & Promise

We occupy the white space between three competitor classes: the curatorial
credibility and artist connection of a gallery platform, the design-first UX
and spatial visualization of a home retailer, and the accessibility of a modern
marketplace. No one else combines all three.

The promise, in three parts: **spatial confidence** (you see exactly how every
piece looks in your space before you buy), **effortless quality** (archival
standards, ready to hang, transparent specs — never "museum quality" without
evidence), **artist connection** (transparent compensation and the artist's
story — not as a sales tactic, but because it makes the art more meaningful on
your wall).

## Audience Architecture

**The Modern Nest Curator (primary).** She thinks in rooms, not artists:
*"I need something for the wall above the sofa that ties together the warm
tones in the room and feels intentional, not generic."* She wants to feel
design-confident, not art-world literate. Her decision hierarchy (front matter,
weighted) is the single most important input to any creative or merchandising
decision: room-first visual fit (98) leads everything; artist ethics (85) is a
confirming nudge, never the lead pitch. She compares us to CB2, West Elm,
Minted and Framebridge — never to Artsy or Saatchi.

**The Emerging Collector (secondary).** Thinks in artists and series; leads
with narrative, provenance, editions. Served through the Easel experience layer
— a graduation path detected from behavior (artist/edition/provenance
engagement vs. room/set/color engagement), layered on top of the design-first
foundation. Never split the site into "collector" and "decor" sections that
force self-identification.

## Voice & Tone

The voice of **a brilliant friend who happens to have incredible taste** — the
one whose apartment makes you ask "where did you find that?" Warm without
saccharine, knowledgeable without academic, opinionated without pushy,
efficient without cold.

**Pillar 1 — Curatorial confidence, not gallery gatekeeping.** Authority that
makes people feel smarter, never inferior.
✔ *"These three prints share a warm amber undertone that makes them feel
cohesive even though the styles are completely different — that contrast is
what makes a gallery wall interesting."*
✘ *"This triptych employs a harmonious analogous palette with gestural
abstraction that references the post-minimalist tradition."*
✘ *"These prints are pretty and go well together!"*

**Pillar 2 — Room-forward, not art-forward.** Every communication starts from
the space and works backward to the art. This is the single biggest voice
differentiator in the category.
✔ *"Perfect for a large wall that needs a calm, grounding anchor — the muted
earth tones warm up cool-toned rooms without competing with your furniture."*
✘ *"Giclée print on 310gsm Hahnemühle Photo Rag, edition of 100."* (True, but
never the lead.)

**Pillar 3 — Artist intimacy without artist worship.** Artist stories are
enrichment and human context, never credentialing.
✔ *"Maria paints from a small studio in Porto, capturing the specific quality
of late-afternoon Atlantic light. When you hang this piece, you're bringing
that light into your home."*
✘ *"Maria Gonzalez (b. 1987) holds an MFA from Central Saint Martins and has
exhibited at Fondation Cartier."*

**Pillar 4 — Effortless sophistication.** Sophisticated but never stiff; casual
but never sloppy. Confident enough to be understated.
✔ *"Your walls are ready for something real."*
✔ *"Ships framed. Hangs in minutes. Lasts for decades."*
✘ *"Transform your space with STUNNING artwork from talented artists!!!"*

The voice stays constant; the tone modulates by context (front matter table).

## Messaging Framework

All copy ladders from one primary message — **"Arthaus makes it effortless to
find and display real art that belongs in your home"** — through four pillars:
*See It in Your Space* · *Curated for You, Not Curated at You* · *Real Art,
Ready to Hang* · *Art from Artists, Not Algorithms.*

By funnel stage:
- **Awareness** — spatial benefit + emotional payoff, no specs or pricing:
  *"Your living room is one gallery wall away."* / *"That blank wall above the
  sofa? It's not empty — it's ready."*
- **Consideration** — curatorial guidance, make her feel smart and capable:
  *"3 gallery walls, styled 3 ways — all from the same 5 prints."*
- **Conversion** — spatial confidence + logistical ease, eliminate friction:
  *"Ships framed. Hangs in minutes. Lasts for decades."* / *"Complete set: 3
  prints + frames + hardware + spacing template. $189."*
- **Retention** — community and continuation: *"You styled the living room.
  The bedroom is next."*

## Experience Principles

Ordered by priority; these govern every screen and flow.
1. **Room first, always.** Discovery is spatial, not categorical — "What room
   are you styling?" is the entry point; genre/medium/artist are secondary.
2. **Show the set, not the SKU.** Gallery-wall sets are first-class products
   with their own PDPs, AR preview, and one-click whole-set purchase.
3. **Confidence before conversion.** AR/mockup above the fold; size guidance;
   the CTA is a natural conclusion, not a leap of faith.
4. **The art breathes.** Generous whitespace, minimal UI chrome, nothing
   blinks or bounces; grids feel like a curated wall, not search results.
5. **Progressive depth.** Spatial fit and emotional resonance first; specs,
   artist story, and edition detail layered beneath — serving both personas.
6. **Invisible technology.** AI curation and the art graph must feel like good
   taste, not like technology.

## Product & Merchandising Principles

Gallery-wall sets are the primary product unit, not promotions: curated names
and editorial descriptions (*"Quiet Earth: Warm Abstracts for Living Spaces"*,
never *"3-Print Bundle — Abstract"*), multiple size configurations, and always
a physical spacing template + hardware — the tangible expression of "we made
this effortless." Thematic collections (color story, mood, spatial context)
are the discovery backbone and map 1:1 to ad asset groups and Academy
editorial. Pricing architecture and transparency rules are in front matter.

## Brand Architecture

One brand umbrella, one voice, five surfaces: **Marketplace** (myarthaus.com —
the Nest Curator's room-first shopping experience, full voice expression),
**Easel** (artist platform + the collector experience layer; same voice, tone
shifts toward narrative and provenance — still never gatekeeping), **Academy**
(arthaus.academy — the editorial engine: SEO capture, nurture, and persona
classification; the knowledgeable-friend voice at its most helpful),
**MemoryFrame** (digital display product; room-first, never gadget-first), and
the **AI concierge** (internal codename Picasso — the brilliant-friend pillar
made literal; a native feature, never a bolt-on chatbot).

## Governance: Do's & Don'ts

Bright-line rules for evaluating any communication:

| ✔ DO | ✘ DON'T |
|---|---|
| Lead with the room/space context | Lead with medium, technique, or art-world vocabulary |
| Use specific spatial language ("above the sofa") | Use vague superlatives ("stunning", "breathtaking") |
| Write in an active, confident voice | Hedge ("may enhance", "could transform") |
| Give the reader credit for having taste | Talk down or assume ignorance |
| Artist stories as human context | Artist CVs as status signaling |
| State material specs plainly | Claim "museum quality" without evidence |
| Show transparent, all-in pricing | Surprise fees or misleading anchors |
| Show art in room context as primary image | Flat isolated art images as default |
| Real, lived-in rooms; warm natural light | Bare staging, cool clinical lighting |
| Scale cues in every product image | Art without size reference |
| Sets as first-class products | Bundles as afterthought upsells |
| Collector depth revealed by behavior | Forced collector/decor self-identification |

## Competitive Differentiation

vs. **gallery platforms** (Artsy, Saatchi): they organize around art-world
credibility; we organize around spatial confidence — we serve people who know
they want *something* but need help knowing what fits. vs. **curated print
shops** (Minted, Desenio): they sell prints; we sell styled walls. vs.
**print-on-demand** (Society6): they compete on price; we will never compete
at their floor. vs. **home retailers** (CB2, West Elm): art is their add-on
and our entire reason for being. vs. **commodity marketplaces** (Amazon,
Etsy): they serve "something for the wall"; we serve "the right thing for
*this* wall."

## Measurement & Brand Health

Brand health maps to the promise (metric groups in front matter, `@data`):
spatial confidence (AR usage, set-vs-individual CVR, framed return rate),
effortless quality (landing-to-purchase time, checkout abandonment, 90-day
repeat — the "complete the wall" metric), artist connection (artist page
views, "Meet the artist" open rates), and business health (AOV by unit type,
12-month LTV by channel, set attach rate, collector graduation rate).

## Provenance & Change Log

| Version | Date | Change | Origin |
|---|---|---|---|
| 1 | 2026-07-10 | Initial brand.md distilled from the owner-approved "Brand Definition & Direction Guide v1.0" (April 2026). Visual identity extracted to [DESIGN.md](./DESIGN.md). All claims `@owner` unless tagged; `health_metrics` are `@data` hooks for semantic-layer re-derivation. | agent, from owner source |

> *This document is a living guide. It should evolve as the brand evolves —
> but the essence stays.*
