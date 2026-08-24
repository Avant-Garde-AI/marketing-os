---
audiences:
  # Rotation audiences ONLY. The 1-profile preview-test segment (HzdbZb) is a
  # pre-send QA step, NOT a campaign audience — listing it here would round-robin
  # real campaigns onto a test segment. See "Preview before every send" below.
  - key: newsletter
    klaviyoRef: { type: list, id: HRSdjT }
    description: Arthaus Newsletter subscribers — the primary campaign audience (browsers and buyers).
    cadenceCap: 4
archetypes:
  # artist-drop leads the rotation — Arthaus is actively adding artists, and each
  # new artist is a campaign moment. ~1/3 of sends.
  - name: artist-drop
    messagingRef: "Art from Artists, Not Algorithms — artist intimacy without worship"
    weight: 4
  - name: editorial
    messagingRef: "Consideration — curatorial confidence ('3 gallery walls, styled 3 ways')"
    weight: 2
  - name: set-feature
    messagingRef: "Real Art, Ready to Hang — a curated gallery-wall set"
    weight: 2
  - name: room-recommendation
    messagingRef: "See It in Your Space — room-forward discovery"
    weight: 2
  - name: new-arrivals
    messagingRef: "Awareness — 'your living room is one gallery wall away'"
    weight: 1
  - name: seasonal
    messagingRef: "Retention — a seasonal palette moment, not a sale"
    weight: 1
campaignsPerMonth: 4
sendDays: [tuesday, thursday]
sendTime: "10:00"
seasonalArcs:
  - name: Autumn palette
    months: ["2026-09", "2026-10", "2026-11"]
    description: Warm earth tones — ochre, rust, sage; lean the palette warm across editorial and seasonal slots.
  - name: Holiday gifting
    months: ["2026-11", "2026-12"]
    description: Art as a considered gift. Gentle, never a discount blast — Arthaus gifts taste, not urgency.
guardrails:
  maxCampaignsPerWeek: 2
  quietPeriods: []
---

# Arthaus email campaign strategy

Standing strategy for one-off **campaign** sends (not the triggered lifecycle
flows — welcome series, cart-abandon, order updates — which live as automations
in `emails/` and are managed separately). Every campaign traces to brand.md and
is grounded in the store's art knowledge graph.

## The design system is `emails/` — match it, and author back into it

The store's email design system lives in `marketplace/emails/`. It is BOTH the
aesthetic source and the delivery home:

- **Compose on the real frame.** Use `emails/partials/` (head, header, footer,
  divider, product-card) and the established rhythm: a **bronze uppercase
  eyebrow** (11px, letter-spacing 0.08em) → a **Playfair Display headline at
  weight 400** (never bold) → **DM Sans** body (16px/1.6, warm-gray) → a CTA
  button with a trailing arrow. Segment sections by alternating backgrounds
  (`#FAF8F5` → `#FFFFFF` → `#F5F2ED` → charcoal `#2D2D2D` band). Tokens:
  parchment `#F5F2ED`, charcoal `#2D2D2D`, bronze `#B07D4F`, warm-gray `#6B6560`.
- **Author output into `emails/`.** A drafted campaign lands as
  `emails/templates/<slug>.html` (leading `<!--PARTIAL:head-->`, closing
  `</body></html>`), is registered in `emails/klaviyo-registry.json`, and is
  pushed as a Klaviyo library template (`npm run push:template <slug>`). Slug
  campaigns `campaign-<id>`; lifecycle templates keep their human slugs.
- **Klaviyo is Django, not Liquid.** Never write Shopify Liquid filters
  (`|money`, `|split`, `|truncatewords`) — they break Klaviyo rendering. Keep
  merge tags verbatim, fail soft (`{{ first_name|default:"art lover" }}`), and
  gate every optional/dynamic section with `{% if %}`. Never put template
  syntax inside HTML comments. Validate with `node scripts/render-drafts.js`.

## Lead creative exploration with the art knowledge graph

Arthaus's Picasso art graph (connected MCP) is the source for what to feature
and how to describe it — see `AGENT.md`. Per archetype: walk `explore_concept`
/ `search_artworks` / `recommend_similar`, pull real facets with
`get_artwork_facets`, ground each art description in the piece's actual palette
and subject (the three-part formula), and link every piece by Shopify handle.
Never feature a piece the graph didn't surface for the theme.

## The archetypes (rotation weighted above)

| Archetype | Job | `emails/` basis | Graph query |
|---|---|---|---|
| **editorial** | Mood-led collection announcement | `editorial.html` | `explore_concept(mood)` |
| **artist-drop** | Introduce a newly added artist + their work | `artist.html` + welcome tone | `search_artworks(artist)` |
| **set-feature** | A dramatic, cohesive gallery-wall set | `set.html` | seed → `recommend_similar` |
| **room-recommendation** | Art for a specific room ("see it in your space") | `room.html` | spatial `explore_concept` / facets |
| **new-arrivals** | Energetic "just landed" roundup | `editorial.html` grid | `explore_concept(bold/new)` |
| **seasonal** | A seasonal palette moment (never a sale) | `guide.html`/`editorial.html` | palette `explore_concept` |

Each slot in a proposed plan carries its why (archetype rotation, audience
cadence, seasonal arc, graph provenance). Copy instantiates a named brand.md
formula — never free-styled.

## Guardrails (brand `never` list governs)

No urgency clichés, no discount shouting, no "museum quality" without evidence,
no generic superlatives that fit any artwork. Every campaign serves the brand
AND a commercial intent; a slot with no honest why is left a gap and named.
Writes stay gated: draft → human approval → Klaviyo, each send approved
individually.

**Preview before every send.** Every campaign goes to the 1-profile
`preview-test` segment (Klaviyo segment `HzdbZb`) for a live inbox look before
the real audience — a QA step on the way to sending, never a campaign audience
in the rotation.
