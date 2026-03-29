# Avant-Garde — Typography System

Typography is the backbone of the brand. The system is fully serif — there is no sans-serif font in the visual identity. Each typeface has a strict role.

---

## Typeface Roles

### Playfair Display — Display / Headlines
The primary headline font. High-contrast, editorial, dramatic. Used for all H1–H3 headings and any text that needs to command attention.

- **Google Fonts:** `Playfair Display`
- **Tailwind class:** `font-display`
- **CSS:** `font-family: 'Playfair Display', serif`
- **Weights loaded:** 400, 500, 600, 700, 800, 900 (normal + italic)

**Characteristics to lean into:**
- Set large — this font is designed to shine at display sizes (48px+)
- Use italic variants for warmth and elegance (especially in mixed-style headlines)
- Pair roman (upright) with italic in the same headline for contrast: `"Build` *`Forward.`*`"`
- `tracking-tight` is standard at large sizes (`letter-spacing: -0.025em`)
- `leading-[0.9]` or `leading-none` for hero headlines creates editorial density

---

### Lora — Body / UI Text
The reading font. Warm, humanist serif. Used for all body copy, navigation labels, UI text, and any text below ~24px.

- **Google Fonts:** `Lora`
- **Tailwind class:** `font-body` (also mapped to `font-sans` to override defaults)
- **CSS:** `font-family: 'Lora', serif`
- **Weights loaded:** 400, 500, 600, 700 (normal + italic)

**Characteristics to lean into:**
- `font-light` (300) or regular (400) for body paragraphs — never bold body text
- `leading-relaxed` for all paragraph copy
- `font-semibold` + `tracking-widest` + `uppercase` for nav and label text
- Works well at small sizes (12px–16px) for metadata and UI labels

---

### Pinyon Script — Decorative Accent
A calligraphic script used sparingly for signature moments — sign-offs, dates, volume numbers, pull-quote attributions. Think "handwritten note in the margin."

- **Google Fonts:** `Pinyon Script`
- **Tailwind class:** `font-script`
- **CSS:** `font-family: 'Pinyon Script', cursive`
- **Weights loaded:** 400 only

**Characteristics to lean into:**
- Large sizes (24px–48px) only — it becomes illegible at small sizes
- Always used at reduced opacity (`text-brand-navy/60`, `text-brand-gold/80`) for subtlety
- Common contexts: `"2025"` date signatures, `"Avant-Garde."` sign-offs, `"Agentic Commerce"` decorative phrases, volume numbers (`"No. 01"`)
- Never used for functional or interactive text

---

## Google Fonts Import

Add this to your HTML `<head>` (before your CSS):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Pinyon+Script&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">
```

---

## Type Scale

| Role | Size | Font | Weight | Tracking | Leading | Example class |
|---|---|---|---|---|---|---|
| Hero H1 | 96–144px | Playfair Display | 400 | `tracking-tight` | `leading-[0.9]` | `font-display text-9xl tracking-tight` |
| Page H1 | 64–96px | Playfair Display | 400 | `tracking-tight` | `leading-[0.9]` | `font-display text-7xl tracking-tight` |
| Section H2 | 48–64px | Playfair Display | 400 | `tracking-tight` | `leading-none` | `font-display text-5xl tracking-tight` |
| Card H3 | 24–32px | Playfair Display | 400 italic | default | default | `font-display text-2xl italic` |
| Eyebrow Label | 10–12px | Lora | 600 | `tracking-widest` | default | `text-xs font-semibold uppercase tracking-widest text-brand-gold` |
| Nav Link | 12px | Lora | 500 | `tracking-widest` | default | `text-xs font-medium uppercase tracking-widest` |
| Body Large | 18–20px | Lora | 300 | default | `leading-relaxed` | `text-lg md:text-xl font-light leading-relaxed` |
| Body | 16px | Lora | 400 | default | `leading-relaxed` | `text-base leading-relaxed` |
| Body Small | 14px | Lora | 300 | default | `leading-relaxed` | `text-sm font-light leading-relaxed` |
| Metadata | 12px | Lora | 600 | `tracking-widest` | default | `text-xs font-semibold uppercase tracking-widest` |
| Script Accent | 24–48px | Pinyon Script | 400 | default | default | `font-script text-3xl text-brand-navy/60` |

---

## Type Patterns

### The Mixed-Italic Headline
Combines upright roman text with italic for contrast. One of the signature moves of this system.

```html
<!-- "Agentic Commerce, In Practice." -->
<h1 class="font-display text-9xl text-brand-navy leading-[0.9] tracking-tight">
  Agentic <br />
  <i class="italic font-light text-brand-navy/80">Commerce</i>, <br />
  In Practice.
</h1>
```

### The Eyebrow Label
Small uppercase gold label above a section heading. Always with a gold rule line before it.

```html
<div class="flex items-center gap-4">
  <span class="w-12 h-[1px] bg-brand-gold" />
  <span class="text-xs font-semibold text-brand-gold uppercase tracking-[0.2em]">
    Venture Studio
  </span>
</div>
```

### The Script Sign-off
Pinyon Script used as a brand signature or contextual accent.

```html
<span class="font-script text-3xl text-brand-navy/60">Avant-Garde.</span>
<span class="font-script text-xl text-brand-gold/80">2025</span>
<span class="font-script text-2xl text-brand-navy/60">No. 01</span>
```

### Section Subtitle + Script Pair
A horizontal rule + script phrase used to soften section transitions.

```html
<div class="flex items-center gap-4">
  <span class="w-12 h-[1px] bg-brand-navy/20" />
  <span class="font-script text-xl text-brand-navy/60">Swipe to explore</span>
</div>
```

---

## Font Rendering

Always enable subpixel antialiasing for the sharpest serif rendering:

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "liga" 1, "kern" 1;
}
```

---

## Text Selection Style

Override the default blue selection color:

```css
::selection {
  background-color: rgba(196, 164, 124, 0.2); /* brand-gold/20 */
  color: #1B263B; /* brand-navy */
}
```
