---
spec: brand.md/v0
name: Arthaus
version: 2
updated: 2026-07-10
source: "Arthaus Brand Definition & Direction Guide v2.0 (April 2026, owner-approved; iterated from v1.0 via agentic strategy session + vision-PDP design work)"
provenance-legend: [owner, agent, data, research]

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
  moat: "the aesthetic — an editorial gallery experience that happens to be shoppable; no direct competitor has it"   # @owner v2

promise:                                                         # @owner
  - spatial-confidence
  - effortless-quality
  - artist-connection

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

experience:                                                      # @owner v2 — the two-tier architecture
  two_tier:
    collections: "room-forward doorway — primary landing for ALL cold/warm traffic (P-Max, Academy, social); lifestyle hero, featured gallery-wall sets, curatorial narrative, clickable graph tags"
    pdp: "art-forward detail — three acts: Editorial Hero (title in serif, editorial description, framed-with-shadow hero) → Configure & Convert (size, real-texture frame swatches, monospace specs, artist-share callout, sticky CTA) → Deepen & Discover (graph-tag Art Analysis, Meet the Artist, companions, Complete the Wall)"
  rules:
    - "P-Max traffic lands on Collection pages, NEVER directly on a PDP"
    - "Quick Shop overlay from Collection grids for intent-ready buyers (no full PDP required)"
    - "Sticky Add-to-Cart bar once the user scrolls past the native CTA"
    - "PRESERVE WHAT WORKS: existing long-tail PDP URLs/SEO equity are a strategic asset — redesign is additive, never replacive"
  graph_tags: "art-graph concepts surfaced as clickable PDP tags — discovery loop + taste vocabulary + persona classification signal"

voice:                                                           # @owner
  essence: "a brilliant friend who happens to have incredible taste — knows art deeply, never makes you feel you should already know it"
  pillars:
    - curatorial-confidence-not-gatekeeping
    - room-forward-discovery-art-forward-detail    # v2: was room-forward-not-art-forward; now two-phase — spatial in browse, editorial intimacy on the PDP
    - artist-intimacy-without-worship
    - effortless-sophistication
  never:
    - "vague superlatives (stunning, breathtaking, masterpiece)"
    - "art-world vocabulary as credentialing"
    - "multiple exclamation marks or ALL CAPS"
    - "passive voice or hedging (may enhance, could transform)"
    - "'museum quality' without material evidence"
    - "surprise fees or misleading price anchors"
  tone_by_context:                 # v2: split product-page into the two tiers + PDP acts
    collection_page: "warm, spatial, inviting"
    pdp_hero: "editorial, contemplative, intimate"
    pdp_config: "clear, confident, helpful"
    academy_article: "knowledgeable, conversational, helpful"
    email_nurture: "warm, personal, suggestive"
    performance_ads: "direct, visual, benefit-first"
    error_empty_state: "honest, light, human"
    ai_concierge: "friendly expert, opinionated"

art_description_formula:                                         # @owner v2 — highest-volume brand copy; enforce at generation time
  steps:
    - "1. Specific visual observation — name colors, textures, composition, subject; identifiable from the description alone"
    - "2. Spatial recommendation — room, wall position, the space it anchors (what no competitor does)"
    - "3. Emotional/sensory resonance — one sentence: the mood or quality of light it brings"
  banned_words: [stunning, breathtaking, masterpiece, elevate, transform, curated, exquisite, meticulously, effortlessly]
  rules:
    - "name at least one specific color (ochre, terracotta, dusty rose, sage — never 'warm tones')"
    - "at least one spatial recommendation (room type and/or wall position)"
    - "2–4 sentences, 40–80 words; present tense — the art is alive, not historical"
    - "artist attribution carries one humanizing detail (studio location, medium, process note)"
  ai_prompt_template: >-
    Write a 2–4 sentence description of this artwork for an online art
    marketplace. The audience is a design-conscious buyer choosing art for
    their home. Structure: (1) Describe what is visually distinctive about
    this specific piece — name colors, textures, composition, and subject.
    (2) Recommend where in a home this piece belongs (room type, wall
    position, spacing context). (3) Capture the mood or energy the piece
    brings to a space. Rules: No vague superlatives (stunning, breathtaking,
    masterpiece). No art jargon. Name specific colors. Be spatially specific.
    Write in present tense. Max 80 words.

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
    - "confidence before conversion (lifestyle + curatorial narrative on Collections; editorial hero + size guide + frame previews on PDP)"
    - "room-first discovery, art-first detail (the two-tier architecture)"
    - "progressive depth (spatial fit first; specs and artist story layered, never dumped)"
  pricing:
    individual_unframed: "$20–$120"
    individual_framed: "$60–$350"
    sets_framed: "$75–$500+"
    limited_editions: "$150–$800+"
    rules: ["always show framed + unframed side by side", "bundle savings explicit", "total landed cost before checkout", "flexible payment over $100", "transparent artist-share callout at the price ('$25 goes to the artist')"]

guardrails:                                                      # @owner — non-negotiable
  - "no dark patterns"
  - "no fake urgency or discount shouting"
  - "no surprise fees at any point"
  - "artist compensation stays transparent"
  - "WCAG AA accessibility floor"
  - "never force collector/decor self-identification — classify by behavior"
  - "never break long-tail PDP URLs or SEO equity"                # v2

health_metrics:                                                  # @data — re-derive via semantic layer
  spatial_confidence: [ar_preview_usage, set_vs_individual_cvr, framed_return_rate]
  effortless_quality: [landing_to_purchase_time, checkout_abandonment, repeat_90d]
  artist_connection: [artist_page_views_per_session, meet_the_artist_open_rate]
  two_tier_experience: [collection_to_pdp_ctr, quick_shop_vs_full_pdp_rate, graph_tag_ctr, collection_bounce_by_source]   # v2
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

## Mission, Vision & Purpose

**Mission:** make it effortless for design-conscious people to find and display
art that transforms their homes into spaces that feel unmistakably theirs —
while every purchase directly supports independent artists.

**Vision:** a world where every home has real art on its walls — chosen with
confidence, displayed with pride, connected to the artists who made it.

**Purpose:** buyers want real art that fits their space but find the art world
gatekept or disconnected from how they live; artists need sustainable income
and direct access but get commoditized or gatekept. Arthaus bridges the gap
with technology, curatorial intelligence, and design-first presentation.

## Positioning & Promise

We occupy the white space between gallery platforms, mass-market print shops,
and home retailers: the curatorial credibility and artist connection of a
gallery, the design-first UX and spatial visualization of a home retailer, and
the accessibility of a modern marketplace. The promise: **spatial confidence**,
**effortless quality**, **artist connection**.

## Audience Architecture

**The Modern Nest Curator (primary).** Thinks in rooms, not artists: *"I need
something for the wall above the sofa that ties together the warm tones in the
room and feels intentional, not generic."* Her weighted decision hierarchy
(front matter) leads with room-first visual fit (98); artist ethics (85) is a
confirming nudge, never the lead pitch. She compares us to CB2, West Elm,
Minted, Framebridge — never Artsy or Saatchi.

**The Emerging Collector (secondary).** Thinks in artists and series; leads
with narrative, provenance, editions. Served through the Easel layer — a
graduation path detected from behavior, layered on the design-first
foundation. Never split the site into sections that force self-identification.

## The Two-Tier Experience *(v2)*

The structural heart of the redesign: two tiers mapping to the Nest Curator's
two modes.

**Tier 1 — Collection pages (room-forward).** The primary landing for cold and
warm traffic — P-Max ads, Academy funnels, and social all land here, *never*
directly on a PDP. Full-width lifestyle hero, collection name in the editorial
serif, gallery-wall sets featured first-class near the top, a relaxed grid of
individual pieces (lifestyle thumbnails), a 2–3 sentence curatorial narrative
(the graph's intelligence made human), and clickable art-graph tags linking to
adjacent collections — the browse loop. Collections are generated by the art
knowledge graph (color temperature, mood, spatial scale, stylistic affinity)
with editorial review as the quality gate; P-Max asset groups map 1:1.

**Tier 2 — the PDP (art-forward), in three acts.** She's expressed intent; now
the brand earns the right to be art-forward. **Act 1 — Editorial Hero:** title
in large editorial serif, bronze divider, artist name, a 2–3 sentence editorial
description (§Art Description Formula), and the hero image — the framed work
photographed with natural shadow on a warm surface. Emotional resonance:
*"this is beautiful and it belongs in my home."* **Act 2 — Configure &
Convert:** size with guide, frame selection with *real texture* swatches,
material specs in monospace, price with transparent artist-share callout, add
to cart, trust badges — and a sticky CTA bar once she scrolls past, so the
editorial pacing never costs the conversion. **Act 3 — Deepen & Discover:**
Art Analysis (graph tags as rich, clickable descriptors — teaching her a
vocabulary for her taste), Meet the Artist (the confirming nudge; the Easel
gateway for collectors), companions, and Complete the Wall.

**Quick Shop** from Collection grids serves intent-ready buyers without the
full PDP journey. And **preserve what works**: the large existing long-tail
organic traffic landing on PDPs already ranks and converts — the redesign
restyles those pages without touching URL structure or SEO equity. Additive,
not replacive.

## Voice & Tone

The voice of **a brilliant friend who happens to have incredible taste**. Warm
without saccharine, knowledgeable without academic, opinionated without pushy,
efficient without cold.

**Pillar 1 — Curatorial confidence, not gallery gatekeeping.**
✔ *"These three prints share a warm amber undertone that makes them feel
cohesive even though the styles are completely different — that contrast is
what makes a gallery wall interesting."*
✘ *"This triptych employs a harmonious analogous palette with gestural
abstraction that references the post-minimalist tradition."*

**Pillar 2 — Room-forward discovery, art-forward detail** *(v2 revision — was
"room-forward, not art-forward")*. Two phases: in discovery (collections,
homepage, search, ads) we lead with the space. On the PDP, the tone shifts to
editorial intimacy — she's already arrived through a room-forward doorway, so
we reward her attention with contemplative pacing and the work itself.
✔ Collection: *"Warm Earth — Grounding tones for living rooms and reading
corners. Curated to create calm in open-plan spaces."*
✔ PDP within it: *"Kaethe Butcher draws intimacy the way it actually feels —
tangled, tender, blooming. This piece captures two figures wrapped into each
other in a garden that seems to grow from the embrace itself."*

**Pillar 3 — Artist intimacy without artist worship.**
✔ *"Maria paints from a small studio in Porto, capturing the specific quality
of late-afternoon Atlantic light. When you hang this piece, you're bringing
that light into your home."*
✘ *"Maria Gonzalez (b. 1987) holds an MFA from Central Saint Martins."*

**Pillar 4 — Effortless sophistication.** Confident enough to be understated.
The vision-PDP aesthetic — generous whitespace, editorial serif, art framed in
real light with natural shadow — is this pillar's visual expression.
✔ *"Your walls are ready for something real."*
✔ *"Ships framed. Hangs in minutes. Lasts for decades."*

## Messaging Framework

Primary message: **"Arthaus makes it effortless to find and display real art
that belongs in your home"** — through four pillars: *See It in Your Space* ·
*Curated for You, Not Curated at You* · *Real Art, Ready to Hang* · *Art from
Artists, Not Algorithms.*

- **Awareness** — spatial benefit + emotional payoff: *"Your living room is
  one gallery wall away."* / *"Stop scrolling Pinterest. Start hanging."*
- **Consideration** — curatorial confidence-building: *"3 gallery walls,
  styled 3 ways — all from the same 5 prints."*
- **Conversion** — spatial confidence + ease: *"Ships framed. Hangs in
  minutes. Lasts for decades."*
- **Retention** — community and continuation: *"You styled the living room.
  The bedroom is next."*

## Art Description Formula *(v2)*

Art descriptions are the single highest-volume brand copy — every PDP, email,
concierge reply, and Academy piece. The three-part formula (front matter,
with the enforcement prompt for generation at scale): **specific visual
observation** (identifiable from the description alone; name the colors) →
**spatial recommendation** (the room and wall it anchors — what no competitor
does) → **emotional/sensory resonance** (one sentence of mood).

✔ *"Kaethe Butcher draws intimacy the way it actually feels — tangled,
tender, blooming. Two figures are wrapped into each other in a garden that
seems to grow from the embrace itself, rendered in Butcher's signature fine
linework with warm ochre, rust, and deep green. The earthy palette and medium
scale make it a natural anchor for a bedroom wall or a quiet reading corner —
it brings warmth without demanding attention."*
✘ *"A breathtaking masterpiece capturing an intimate moment of embrace
between two connected souls."* (Vague superlative, generic, no spatial
recommendation, could describe any figurative work.)

## Experience Principles

1. **Room-first discovery, art-first detail** — the two-tier architecture is
   the structural expression of Pillar 2.
2. **Show the set, not the SKU.**
3. **Confidence before conversion.**
4. **The art breathes** — the vision PDP's contemplative pacing is the
   reference standard for density.
5. **Progressive depth.**
6. **Invisible technology** — graph curation feels like a human curator's
   brilliant edit.
7. **Preserve what works** *(v2)* — long-tail PDP traffic is a strategic
   asset; new architecture is additive.

## Product & Merchandising Principles

Gallery-wall sets are the primary product unit with curated names and
editorial descriptions, multiple size configurations, and always a spacing
template + hardware. Thematic collections (8–20 pieces + 2–4 sets) are the
discovery backbone, mapping 1:1 to P-Max asset groups and Academy editorial.
**Art-graph tags** (v2) surfaced on PDPs serve three functions: discovery
(each links to a collection), vocabulary (teaching her a language for her
taste), and classification (tag engagement signals Nest-Curator vs. Collector
trajectory).

## Brand Architecture

One brand, one voice, five surfaces: **Marketplace** (two-tier journey),
**Easel** (artist platform + collector layer; tone shifts toward narrative and
provenance, never gatekeeping), **Academy** (editorial engine: SEO capture,
nurture, persona classification), **MemoryFrame** (room-first, never
gadget-first), **AI concierge** (internal codename Picasso; a native feature,
never a bolt-on chatbot).

## Governance: Do's & Don'ts

| ✔ DO | ✘ DON'T |
|---|---|
| Lead with room/space context on Collection pages | Lead with medium/technique on browse pages |
| Shift to editorial intimacy on the PDP | Use the same product-grid voice everywhere |
| Name specific colors (ochre, sage, dusty rose) | Say "warm tones" without specifics |
| Write descriptions in the three-part formula | Generic praise that fits any artwork |
| Give the reader credit for having taste | Talk down or assume ignorance |
| Artist stories as human context | Artist CVs as status signaling |
| Specs plainly, in monospace | "Museum quality" without evidence |
| Transparent all-in pricing | Surprise fees |
| Collections as primary cold-traffic landing | P-Max traffic sent directly to PDPs |
| Sticky CTA bar on the PDP | Forcing a scroll back up to Add to Cart |
| Quick Shop from Collection grids | Full PDP required for every purchase |
| Graph tags as clickable discovery links | Thematic relationships hidden backstage |
| Preserve existing PDP URLs and SEO equity | URL restructuring that breaks long-tail traffic |
| Collector depth revealed by behavior | Forced collector/decor self-identification |

## Competitive Differentiation

vs. **gallery platforms**: they organize around art-world credibility; we
organize around spatial confidence — and our curatorial intelligence is
algorithmic and scalable. vs. **curated print shops**: they sell prints; we
sell styled walls. vs. **print-on-demand**: they compete on price; we never
will. vs. **home retailers**: art is their add-on and our reason for being.
vs. **commodity marketplaces**: they serve "something for the wall"; we serve
"the right thing for *this* wall."

**The aesthetic moat** *(v2)*: contemplative whitespace, editorial serif,
framed art with natural shadow on warm surfaces. Minted looks like e-commerce;
Desenio looks like a catalog; Juniper looks like a boutique. **Arthaus looks
like an editorial gallery experience that happens to be shoppable** — a moat
if executed consistently across every touchpoint.

## Measurement & Brand Health

Metric groups in front matter (`@data`): spatial confidence, effortless
quality, artist connection, **two-tier experience health** (v2: Collection→PDP
click-through, Quick Shop vs. full-PDP rate, graph-tag click-through,
Collection bounce by traffic source), and business health (AOV by unit type,
12-month LTV by channel, set attach rate, collector graduation rate).

## Provenance & Change Log

| Version | Date | Change | Origin |
|---|---|---|---|
| 1 | 2026-07-10 | Initial brand.md distilled from the owner-approved "Brand Definition & Direction Guide v1.0" (April 2026). Visual identity extracted to [DESIGN.md](./DESIGN.md). | agent, from owner source |
| 2 | 2026-07-10 | Distilled from guide v2.0 (owner-approved; produced by agentic strategy iteration + vision-PDP design work). **Strategy revision:** Voice Pillar 2 "room-forward, not art-forward" → **"room-forward discovery, art-forward detail"** (two-phase). **New:** Two-Tier Experience architecture (Collections = cold-traffic landing, never PDPs; three-act PDP; Quick Shop; sticky CTA; preserve-PDP-SEO guardrail); Art Description Formula + banned words + AI generation template; art-graph tags as discovery loop; aesthetic-moat positioning claim; two-tier health metrics. **Visual:** Soft White `#F7F5F2` → Warm Parchment `#F5F2ED` with parchment/white context alternation; natural-wood material texture; vision-PDP hero treatment (→ DESIGN.md). | agent, from owner source v2.0 |

> *This document is a living guide. It should evolve as the brand evolves —
> but the essence stays.*
