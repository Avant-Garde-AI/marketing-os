# Avant-Garde Brand System

> Design language for the Avant-Garde portfolio of products and ventures.

This directory contains everything needed to apply the Avant-Garde visual identity to any app, tool, or product under the umbrella. It is framework-agnostic at its core and includes drop-in configurations for Tailwind CSS.

---

## Contents

| File | Purpose |
|---|---|
| `colors.md` | Full color palette, hex values, HSL tokens, usage rules |
| `typography.md` | Typefaces, scale, weight, and usage guidance |
| `components.md` | UI patterns — cards, buttons, labels, nav, sections, CTAs |
| `voice-and-tone.md` | Copy style, word choice, tone of voice |
| `tokens.css` | Drop-in CSS custom properties (framework-agnostic) |
| `tailwind-preset.js` | Tailwind CSS preset — extend your config with this |
| `assets/` | Logos, SVGs, reference screenshots |

---

## The Aesthetic in One Sentence

**Quiet luxury meets editorial precision** — dark navy, warm gold, cream paper, serif typefaces, no rounded corners, generous whitespace.

---

## Quick-Start (Tailwind)

1. Copy `tailwind-preset.js` into your project.
2. Reference it in your `tailwind.config.ts`:

```ts
import avantGardePreset from './brand/tailwind-preset.js'

export default {
  presets: [avantGardePreset],
  content: ['./src/**/*.{ts,tsx}'],
}
```

3. Add the Google Fonts link to your HTML `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Pinyon+Script&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">
```

4. Import `tokens.css` at your global CSS entry point:

```css
@import './brand/tokens.css';
```

---

## Quick-Start (Vanilla CSS / Non-Tailwind)

Import `tokens.css` in your global stylesheet and reference the variables directly:

```css
@import './brand/tokens.css';

body {
  background-color: var(--color-cream);
  color: var(--color-navy);
  font-family: var(--font-body);
}

h1, h2, h3 {
  font-family: var(--font-display);
}
```

---

## Design Principles

1. **Restraint over decoration** — every element earns its place.
2. **Serif-first typography** — display headlines in Playfair Display, body in Lora.
3. **Gold as accent only** — never dominant, always purposeful (rules, labels, highlights).
4. **No rounded corners** — sharp edges signal precision and confidence (`border-radius: 0`).
5. **Cream background, navy foreground** — the default surface is warm, never cold white.
6. **Uppercase + widest tracking for labels** — category tags and eyebrow labels use `text-xs uppercase tracking-widest`.
7. **Italic = emotion** — italics are used deliberately to add warmth or emphasis within headlines.
8. **Shadow-offset cards** — featured cards use a navy block offset (translate-x-4 translate-y-4) for depth.

---

## Brand Colors at a Glance

| Role | Name | Hex |
|---|---|---|
| Primary surface | Navy | `#1B263B` |
| Accent | Gold | `#C4A47C` |
| Background | Cream | `#FAFAF9` |
| Card / panel | White | `#FFFFFF` |

---

## Reference Screenshot

See `assets/homepage-reference.png` for the canonical homepage design this system is derived from.
