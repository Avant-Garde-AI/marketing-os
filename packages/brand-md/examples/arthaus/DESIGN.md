---
version: alpha
name: Arthaus
description: >-
  Effortless sophistication — elevated enough to signal quality and curatorial
  credibility, warm enough to feel approachable and livable, restrained enough
  to let the art be the hero. The design system is a frame, not a painting.
  Soul document: ./brand.md (brand.md/v0).
colors:
  soft-white: "#F7F5F2"
  charcoal: "#2D2D2D"
  warm-gray: "#6B6560"
  bronze: "#B07D4F"
  sage: "#A8B5A0"
  terracotta: "#C4836A"
  dusty-blue: "#8FA3B0"
  deep-ink: "#1A1A2E"
  primary: "{colors.bronze}"
  background: "{colors.soft-white}"
  text: "{colors.charcoal}"
  text-secondary: "{colors.warm-gray}"
  success: "{colors.sage}"
typography:
  display:
    fontFamily: "Canela, 'Freight Display', 'Noe Display', Georgia, serif"
    fontWeight: 500
    letterSpacing: "0em"
  body:
    fontFamily: "Inter, Söhne, Graphik, system-ui, sans-serif"
    fontSize: 17px
    lineHeight: 1.55
    fontWeight: 400
  label:
    fontFamily: "Inter, Söhne, Graphik, system-ui, sans-serif"
    fontSize: 12px
    letterSpacing: "0.08em"
    fontWeight: 500
  specs:
    fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace"
    fontSize: 14px
rounded:
  none: 0px
  subtle: 2px
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 48px
  xl: 96px
components:
  button-primary:
    backgroundColor: "{colors.bronze}"
    textColor: "{colors.soft-white}"
    rounded: "{rounded.none}"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.none}"
  card:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.none}"
    padding: "{spacing.md}"
  badge-collector:
    backgroundColor: "{colors.deep-ink}"
    textColor: "{colors.soft-white}"
---

## Overview

Arthaus's visual system embodies **effortless sophistication**. The palette is
drawn from the warmth of natural materials — linen, clay, raw wood, aged paper
— and is intentionally neutral: it is a canvas for the art itself. The
experience should feel like a well-lit gallery in a lived-in home — calm,
considered, warm.

## Colors

- **Soft White `#F7F5F2`** — primary background. Warm, never stark; the color
  of good linen paper. Backgrounds are always Soft White or pure white.
- **Charcoal `#2D2D2D`** — primary text and headings. Deep but not pure black.
- **Warm Gray `#6B6560`** — secondary text and captions; brown-warm, never a
  cold blue-gray.
- **Warm Bronze `#B07D4F`** — the single accent. CTAs, accent lines, highlight
  moments. Evokes framing and craftsmanship, never "luxury gold." Used for
  **one focal CTA per viewport** — never body text, never large fills.
- Secondary (functional, not decorative): **Muted Sage** for success/in-stock,
  **Soft Terracotta** for warm seasonal groupings, **Dusty Blue** for
  navigation/filters and cool groupings, **Deep Ink** only in the collector
  (Easel) experience layer to signal premium context.
- **Never place colored backgrounds behind art** — the art provides its own
  color. The palette should feel like a gallery wall: neutral, warm, breathing.

## Typography

- **Display/headings:** a modern serif with editorial character (Canela /
  Freight Display / Noe Display direction) — literary and warm, not geometric-
  cold, not decorative. Signals that Arthaus takes art and storytelling
  seriously without feeling museum-institutional.
- **Body/UI:** a humanist sans (Inter / Söhne / Graphik direction), 16–18px,
  line-height 1.5–1.6 — modern, readable, warm; not clinical, not trendy.
- **Specs:** a clean monospace (IBM Plex Mono / JetBrains Mono), used
  exclusively for material specifications, edition numbers, and dimensions —
  visually separating factual claims from editorial voice.
- All-caps only for very small labels (category tags, nav, "NEW" badges),
  letter-spacing 0.05–0.1em. **Never all-caps headings or CTAs.**
- Pull quotes and artist quotes: serif, larger size, warm gray — editorial
  moments.

## Layout

Generous whitespace; minimal UI chrome; the art provides the visual energy.
Grid layouts should feel like a curated gallery wall, not a search results
page. Information is layered (progressive depth): first viewport = spatial fit
and emotional resonance; scrolling reveals specs, artist story, companions.

## Elevation & Depth

Flat to near-flat. Hairline borders and generous spacing do the separating
work; shadows, if used, are barely perceptible. Nothing floats, pops, or
demands attention.

## Shapes

Square-edged (radius 0–2px) throughout — the language of frames and gallery
walls. No pills, no heavy rounding.

## Components

- **Primary button:** bronze fill, soft-white label text, square corners — one
  per viewport.
- **Cards / product tiles:** white on soft-white, hairline separation, art
  image dominant (in-room lifestyle shot as the default primary image, never a
  flat isolated artwork).
- **Collector badge/context:** deep-ink treatment appears only in the Easel
  layer.
- Motion: subtle and smooth. Nothing blinks or bounces.

## Do's and Don'ts

- ✔ Show art in room context as the primary image — ✘ flat isolated art as
  the default presentation.
- ✔ Warm, natural, directional lighting (golden-hour window light) — ✘ cool,
  clinical studio lighting.
- ✔ Real, lived-in rooms with furniture, plants, books — ✘ bare staging or
  minimalist voids.
- ✔ Include a scale cue in every product image (sofa, chair, figure) — ✘ art
  without size reference.
- ✔ Neutral UI; the art carries the color — ✘ colored backgrounds or
  competing graphics behind art.
- ✔ Generous whitespace, calm layouts — ✘ cramming, flashing, or
  attention-seeking UI.
- ✔ Diverse room types and living situations — ✘ only unattainable
  aspirational spaces.
