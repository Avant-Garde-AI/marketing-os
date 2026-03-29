# Avant-Garde — Color System

The palette is built around three core brand colors and pure white. Everything else is achieved through opacity modifiers.

---

## Core Palette

### Navy — Primary Surface & Foreground
The dominant color. Used for backgrounds of dark sections, all primary text, and navigation.

| Property | Value |
|---|---|
| Hex | `#1B263B` |
| RGB | `rgb(27, 38, 59)` |
| HSL | `hsl(218, 37%, 17%)` |
| Tailwind token | `brand-navy` |
| CSS variable | `--color-navy` |

**Use for:** body text, nav bar background, dark section backgrounds, card borders, icon strokes, rule lines.

---

### Gold — Accent
The prestige signal. Used sparingly to direct the eye to what matters most.

| Property | Value |
|---|---|
| Hex | `#C4A47C` |
| RGB | `rgb(196, 164, 124)` |
| HSL | `hsl(34, 33%, 63%)` |
| Tailwind token | `brand-gold` |
| CSS variable | `--color-gold` |

**Use for:** eyebrow / category labels, horizontal rule lines, interactive hover states, quote marks, decorative script accents, CTA arrows, border accents, scrollbar thumb.

**Never use for:** large filled backgrounds, body text, or in a way that makes it "dominant" — gold should always feel earned.

---

### Cream — Default Background
The warm off-white that replaces cold pure white as the default page background. Evokes paper, editorial print.

| Property | Value |
|---|---|
| Hex | `#FAFAF9` |
| RGB | `rgb(250, 250, 249)` |
| HSL | `hsl(40, 14%, 98%)` |
| Tailwind token | `brand-cream` |
| CSS variable | `--color-cream` |

**Use for:** page background, sidebar backgrounds, secondary card surfaces, icon pill backgrounds.

---

### White — Card & Panel Surface
Pure white. Used for elevated card and panel surfaces to create subtle depth against cream.

| Property | Value |
|---|---|
| Hex | `#FFFFFF` |
| RGB | `rgb(255, 255, 255)` |
| HSL | `hsl(0, 0%, 100%)` |
| Tailwind token | `brand-white` |
| CSS variable | `--color-white` |

**Use for:** playbook cards, tool cards, content panels that sit on cream backgrounds.

---

## Opacity Scale

All color usage beyond the four core colors is achieved with Tailwind/CSS opacity modifiers on `brand-navy` and `brand-gold`. These are the established levels:

| Opacity | Usage |
|---|---|
| `brand-navy` (100%) | Primary text, nav, dark backgrounds |
| `brand-navy/80` | Italic body text within dark headlines |
| `brand-navy/70` | Body copy, paragraph text |
| `brand-navy/60` | Secondary body text, descriptions |
| `brand-navy/50` | Labels, metadata, subdued text |
| `brand-navy/40` | Very subdued metadata (categories, dates) |
| `brand-navy/20` | Divider lines (`h-[1px]` horizontal rules) |
| `brand-navy/10` | Card borders, section dividers |
| `brand-navy/5` | Faint decorative vertical lines |
| `brand-gold` (100%) | Active nav links, strong accents |
| `brand-gold/80` | Script accent text in dark sections |
| `brand-gold/30` | Underline highlights under hero text |
| `brand-gold/20` | Subtle gold-tint CTA blocks |
| `brand-gold/10` | Bento grid CTA block background |
| `white/60` | Body text on dark (navy) backgrounds |
| `white/40` | Subdued text on dark backgrounds |
| `white/10` | Dividers on dark backgrounds |

---

## Semantic Mapping (CSS Custom Properties)

These are the shadcn/Radix-compatible semantic tokens used in the site's component system:

```css
/* Light mode */
--background:         hsl(40 14% 98%);    /* cream */
--foreground:         hsl(218 37% 17%);   /* navy */
--primary:            hsl(218 37% 17%);   /* navy */
--primary-foreground: hsl(40 14% 98%);    /* cream */
--secondary:          hsl(34 33% 63%);    /* gold */
--secondary-foreground: hsl(218 37% 17%); /* navy */
--accent:             hsl(34 33% 63%);    /* gold */
--accent-foreground:  hsl(218 37% 17%);   /* navy */
--muted:              hsl(40 14% 95%);    /* near-cream */
--muted-foreground:   hsl(218 37% 40%);   /* mid navy */
--border:             hsl(218 37% 17% / 0.1);
--ring:               hsl(34 33% 63%);    /* gold focus ring */
--radius:             0rem;               /* NO rounded corners */
```

```css
/* Dark mode (navy surface) */
--background:         hsl(218 37% 17%);   /* navy */
--foreground:         hsl(40 14% 98%);    /* cream */
--muted:              hsl(218 37% 25%);   /* lighter navy */
--muted-foreground:   hsl(40 14% 70%);    /* subdued cream */
--border:             hsl(40 14% 98% / 0.1);
```

---

## Color Do's and Don'ts

**Do:**
- Use cream as the default page background
- Use gold exclusively as an accent — never dominant
- Use navy for all primary text on cream backgrounds
- Use white panels on top of cream to create gentle card depth
- Pair gold labels with navy content beneath them

**Don't:**
- Use pure `#000000` black anywhere — navy is the darkest color
- Use bright or saturated secondary colors
- Use rounded corners — the system uses `border-radius: 0`
- Use gold for large background fills
- Use white as the page background (use cream instead)
- Use blue, green, red, or any hue not in the palette for UI elements (only for data/status indicators if truly necessary)
