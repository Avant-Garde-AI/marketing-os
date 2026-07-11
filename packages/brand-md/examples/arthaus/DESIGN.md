---
version: alpha
name: Arthaus
description: >-
  Effortless sophistication, rooted in the vision-PDP aesthetic: contemplative
  whitespace, editorial serif typography, warm parchment tones, and art
  presented in natural light with real shadow. The design system is a frame,
  not a painting. Soul document: ./brand.md (brand.md/v0, version 2).
colors:
  warm-parchment: "#F5F2ED"
  charcoal: "#2D2D2D"
  warm-gray: "#6B6560"
  bronze: "#B07D4F"
  sage: "#A8B5A0"
  terracotta: "#C4836A"
  dusty-blue: "#8FA3B0"
  deep-ink: "#1A1A2E"
  primary: "{colors.bronze}"
  background: "{colors.warm-parchment}"
  background-transactional: "#FFFFFF"
  text: "{colors.charcoal}"
  text-secondary: "{colors.warm-gray}"
  success: "{colors.sage}"
typography:
  display:
    fontFamily: "Canela, 'Freight Display', 'Noe Display', Georgia, serif"
    fontWeight: 500
    letterSpacing: "0em"
  artwork-title:
    fontFamily: "Canela, 'Freight Display', 'Noe Display', Georgia, serif"
    fontSize: 26px
    fontWeight: 500
  body:
    fontFamily: "Inter, Söhne, Graphik, system-ui, sans-serif"
    fontSize: 17px
    lineHeight: 1.55
    fontWeight: 400
  editorial-description:
    fontFamily: "Inter, Söhne, Graphik, system-ui, sans-serif"
    fontSize: 15px
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
    backgroundColor: "{colors.charcoal}"
    textColor: "#FFFFFF"
    rounded: "{rounded.none}"
    height: 52px
  button-accent:
    backgroundColor: "{colors.bronze}"
    textColor: "#FFFFFF"
    rounded: "{rounded.none}"
  title-divider:
    backgroundColor: "{colors.bronze}"
    width: 40px
    height: 1px
  card:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.none}"
    padding: "{spacing.md}"
  sticky-cta-bar:
    backgroundColor: "{colors.warm-parchment}"
    height: 60px
  badge-collector:
    backgroundColor: "{colors.deep-ink}"
    textColor: "#FFFFFF"
---

## Overview

Arthaus's visual system is rooted in the **vision PDP**: contemplative
whitespace, editorial serif typography, warm parchment tones, and framed art
photographed in natural light with real shadow. It should feel like a gallery
wall in warm afternoon light — the art provides all chromatic energy; the
system provides the frame. This aesthetic is a competitive moat: Minted looks
like e-commerce, Desenio looks like a catalog — Arthaus looks like an
editorial gallery experience that happens to be shoppable.

## Colors

- **Warm Parchment `#F5F2ED`** — the foundation tone of the entire experience;
  the color of good cotton paper and natural linen. Warmer than standard
  white; this is what gives the brand its distinctive warmth. *(v2: replaces
  Soft White `#F7F5F2`.)*
- **Backgrounds alternate by context:** parchment for editorial/browsing
  contexts (collections, PDP hero, Academy), pure white for
  configuration/transactional contexts (size/frame selection, cart, checkout).
- **Charcoal `#2D2D2D`** — primary text; deep but never pure black.
- **Warm Gray `#6B6560`** — secondary text; brown-warm, never blue-gray.
- **Warm Bronze `#B07D4F`** — the single accent: one focal CTA per viewport,
  the thin 40px divider beneath artwork titles, hover/active states. Evokes
  natural wood framing and craftsmanship — never "luxury gold," never body
  text, never large fills.
- Secondary (functional): **Sage** success/in-stock, **Terracotta** warm
  seasonal groupings, **Dusty Blue** navigation/filters and cool groupings,
  **Deep Ink** reserved exclusively for the Collector/Easel layer.
- **Never place colored backgrounds behind art.**

## Typography

- **Display serif** (Canela / Freight Display / Noe Display direction) —
  literary and warm. Used for **artwork titles on PDPs** (large, editorial,
  centered), collection names, pull quotes, and page headings. This treatment
  creates the contemplative, editorial pace that distinguishes Arthaus.
- **Body/UI sans** (Inter / Söhne / Graphik direction), 16–18px, line-height
  1.5–1.6. Editorial descriptions may set italic at ~15px.
- **Monospace for specs** (IBM Plex Mono / JetBrains Mono) — material specs,
  edition details, dimensions. When you see monospace, it's a verified fact.
- All-caps only for very small labels (category tags, nav, trust badges),
  letter-spacing 0.05–0.1em. Never all-caps headings or CTAs.
- **The ARTHAUS wordmark** uses the spaced-letterform serif treatment,
  consistent across all touchpoints.

## Layout

Generous whitespace at vision-PDP density — never compress content to reduce
scroll depth. Grids feel like curated gallery walls with relaxed spacing.
Information layers progressively: first viewport = spatial fit + emotional
resonance; scrolling reveals specs, artist story, companions. Mobile is the
primary design target (single vertical scroll, three-act PDP); desktop uses a
two-column configure zone (sticky hero left, configuration right) and should
feel *more* expansive, not more compressed.

## Elevation & Depth

Flat to near-flat UI; hairline borders and spacing do the separating work.
Physical depth belongs to the *photography*: the canonical hero treatment is
the framed artwork shot at a slight angle with soft natural shadow on a warm
parchment/linen surface — it reads as an object you want to own, not a flat
file on a screen.

## Shapes

Square-edged (radius 0–2px) throughout — the language of frames and gallery
walls. No pills, no heavy rounding.

## Components

- **Primary CTA:** charcoal fill, white text, full-width on mobile, 48–56px
  height. Bronze is reserved for accent moments and focal links.
- **Title divider:** the 40px × 1px bronze line centered beneath artwork
  titles — the signature editorial mark.
- **Sticky CTA bar (PDP):** appears when the user scrolls past the native Add
  to Cart; slim (56–64px), semi-transparent warm parchment with a subtle top
  border; dismisses when scrolling back up.
- **Frame selectors:** real texture photography swatches (natural oak, black,
  white, no frame) — never flat color circles.
- **Material callout card:** subtle background, bold sans label, specs in
  monospace.
- **Trust badges:** four icons in a row (guarantee, shipping, sustainability,
  authenticity), small sans labels.
- **Collector context:** deep-ink treatment appears only in the Easel layer.
- **Natural wood** (raw oak, light ash) recurs as a brand material across
  frame photography, UI accents, and packaging — the tactile expression of
  the archival-quality promise.
- Motion: subtle and smooth. Nothing blinks or bounces.

## Do's and Don'ts

- ✔ Warm parchment backgrounds for editorial contexts — ✘ cool grays or
  stark white as the primary canvas.
- ✔ Framed art with natural shadow as the PDP hero — ✘ flat isolated product
  images as primary presentation.
- ✔ Lifestyle in-room images on collection/browse grids — ✘ flat art grids
  without spatial context.
- ✔ Editorial serif for artwork titles and collection names — ✘ sans-serif
  artwork titles (loses the editorial character).
- ✔ Warm, natural, directional lighting — ✘ cool clinical studio lighting.
- ✔ Real, lived-in rooms with scale cues in every shot — ✘ bare staging or
  art without size reference.
- ✔ Vision-PDP whitespace density — ✘ compressing content to shorten the
  scroll.
- ✔ Real frame-texture swatches — ✘ flat color circles for frame options.
- ✔ Diverse room types and living situations — ✘ only unattainable spaces.
