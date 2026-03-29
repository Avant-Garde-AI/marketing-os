# Avant-Garde — UI Component Patterns

This document catalogs the visual patterns, component recipes, and layout idioms that define the Avant-Garde UI. Copy these patterns directly into any app in the portfolio.

All examples use Tailwind CSS class names. See `tailwind-preset.js` for the full configuration.

---

## Navigation

### Top Bar
Fixed, navy background with gold border-bottom and backdrop blur. Logo on the left, nav links centered (hidden on mobile), "Menu" hamburger on the right.

```html
<nav class="fixed top-0 left-0 right-0 z-50 bg-brand-navy/95 backdrop-blur-sm border-b border-brand-gold/20 px-6 md:px-12 h-20 flex justify-between items-center">
  <!-- Logo -->
  <a href="/">
    <img src="/images/logo.png" alt="Avant-Garde" class="h-8 md:h-10 w-auto" />
  </a>

  <!-- Desktop links -->
  <div class="hidden md:flex gap-10 text-xs font-medium tracking-widest uppercase text-brand-cream/70">
    <a href="/ventures" class="hover:text-brand-gold transition-colors">Ventures</a>
    <a href="/method" class="hover:text-brand-gold transition-colors">Playbooks</a>
    <a href="/about" class="hover:text-brand-gold transition-colors">About</a>
  </div>

  <!-- Hamburger -->
  <button class="flex items-center gap-3 group">
    <span class="text-xs uppercase tracking-widest text-brand-cream group-hover:text-brand-gold transition-colors">Menu</span>
    <div class="space-y-1.5">
      <span class="block w-6 h-[1px] bg-brand-cream group-hover:bg-brand-gold transition-colors" />
      <span class="block w-4 h-[1px] bg-brand-cream ml-auto group-hover:w-6 group-hover:bg-brand-gold transition-all duration-300" />
    </div>
  </button>
</nav>
```

### Mobile Menu Overlay
Full-screen navy overlay with large italic display links.

```html
<div class="fixed inset-0 top-20 bg-brand-navy z-40 flex flex-col items-center justify-center gap-8">
  <a href="/" class="font-display text-4xl italic text-brand-cream hover:text-brand-gold transition-colors">Home</a>
  <a href="/ventures" class="font-display text-4xl italic text-brand-cream hover:text-brand-gold transition-colors">Ventures</a>
  <!-- Decorative sign-off -->
  <div class="mt-12 flex items-center gap-4">
    <span class="w-12 h-[1px] bg-brand-cream/20" />
    <span class="font-script text-2xl text-brand-cream/60">Agentic Commerce</span>
    <span class="w-12 h-[1px] bg-brand-cream/20" />
  </div>
</div>
```

---

## Eyebrow Label

The universal section opener. Gold rule + uppercase gold label. Used at the top of every section heading.

```html
<div class="flex items-center gap-4 mb-8">
  <span class="w-12 h-[1px] bg-brand-gold"></span>
  <span class="text-xs font-semibold text-brand-gold uppercase tracking-[0.2em]">
    Section Name
  </span>
</div>
```

Alternate (no rule, just label):
```html
<span class="text-xs text-brand-gold font-semibold uppercase tracking-widest mb-6 block">
  Category Label
</span>
```

---

## Hero Section

Full-screen height, cream background, grid layout with headline left and quote card right.

```html
<header class="relative min-h-screen w-full flex flex-col justify-center pt-32 pb-12 px-6 md:px-12 bg-brand-cream">
  <!-- Decorative vertical lines -->
  <div class="absolute top-0 right-12 h-full w-[1px] bg-brand-navy/5 hidden md:block"></div>
  <div class="absolute top-0 left-12 h-full w-[1px] bg-brand-navy/5 hidden md:block"></div>

  <div class="max-w-screen-xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
    <!-- Headline column -->
    <div class="lg:col-span-8 space-y-10">
      <!-- Eyebrow -->
      <div class="flex items-center gap-4">
        <span class="w-12 h-[1px] bg-brand-gold"></span>
        <span class="text-xs font-semibold text-brand-gold uppercase tracking-[0.2em]">Venture Studio</span>
      </div>
      <!-- Mixed-italic hero headline -->
      <h1 class="font-display text-6xl md:text-8xl lg:text-9xl text-brand-navy leading-[0.9] tracking-tight">
        Agentic <br />
        <i class="italic font-light text-brand-navy/80">Commerce</i>, <br />
        <span class="relative inline-block">
          In Practice.
          <span class="absolute -bottom-2 left-0 w-full h-1 bg-brand-gold/30"></span>
        </span>
      </h1>
      <!-- Subheadline -->
      <p class="text-lg md:text-xl text-brand-navy/70 leading-relaxed font-light max-w-md">
        We build, scale, and open-source AI-native digital ventures.
        <a href="#" class="text-brand-gold font-medium hover:underline decoration-brand-gold/30 underline-offset-4 transition-all inline-flex items-center gap-1">
          Here's how. →
        </a>
      </p>
    </div>

    <!-- Quote card column -->
    <div class="lg:col-span-4 flex justify-end">
      <div class="bg-brand-navy text-white p-10 max-w-sm relative shadow-2xl">
        <!-- Gold border offset -->
        <div class="absolute -top-4 -left-4 w-full h-full border border-brand-gold -z-10"></div>
        <!-- Quote mark icon -->
        <svg class="w-8 h-8 text-brand-gold mb-6 opacity-80" ...></svg>
        <p class="font-display text-2xl italic leading-relaxed mb-6">
          "The future of commerce isn't just automated. It's autonomous, elegant, and intelligent."
        </p>
        <div class="flex items-center gap-4 pt-6 border-t border-white/10">
          <span class="text-xs uppercase tracking-widest text-brand-gold">Manifesto</span>
          <span class="h-[1px] flex-1 bg-white/10"></span>
          <span class="font-script text-xl text-white/60">2025</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Scroll indicator -->
  <div class="absolute bottom-12 left-1/2 -translate-x-1/2 animate-bounce text-brand-navy/40">
    ↓
  </div>
</header>
```

---

## Cards

### Content Card (White on Cream)
Standard card for playbooks, tools, articles. White background on cream page. Sharp corners. Hover: shadow + accent bar reveal.

```html
<div class="group relative bg-white border border-brand-navy/5 p-10 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-xl transition-all duration-500">
  <!-- Gold accent bar (slides in from top on hover) -->
  <div class="absolute top-0 left-0 w-1 h-full bg-brand-gold scale-y-0 origin-top group-hover:scale-y-100 transition-transform duration-500"></div>

  <!-- Card header -->
  <div class="flex justify-between items-start mb-8">
    <div class="w-12 h-12 bg-brand-cream rounded-full flex items-center justify-center border border-brand-navy/10">
      <!-- Icon -->
    </div>
    <span class="font-serif italic text-brand-navy/40">Vol. 01</span>
  </div>

  <!-- Title (changes to gold on hover) -->
  <h3 class="text-2xl font-display text-brand-navy mb-4 group-hover:text-brand-gold transition-colors">
    Card Title
  </h3>
  <p class="text-brand-navy/60 text-base leading-relaxed mb-8">
    Card description text here.
  </p>

  <!-- CTA slides right on hover -->
  <div class="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-brand-navy group-hover:translate-x-2 transition-transform">
    <span>Read Guide</span>
    <span>→</span>
  </div>
</div>
```

### Tool Card (Cream on White Section)
Used for open-source tools, repos, products. Cream background. Hover: gold border reveal.

```html
<div class="group bg-brand-cream p-8 flex flex-col justify-between border border-transparent hover:border-brand-gold/30 transition-all cursor-pointer">
  <div class="mb-12">
    <div class="flex items-center justify-between mb-6">
      <!-- Icon (stroke-1 for lightness) -->
      <div class="text-brand-navy">
        <svg class="w-8 h-8 stroke-1">...</svg>
      </div>
      <!-- Stars / metadata -->
      <div class="flex items-center gap-2 text-xs text-brand-navy/50 font-mono">
        ★ <span>8.2k</span>
      </div>
    </div>
    <!-- Title: underline in gold on hover -->
    <h3 class="text-2xl font-display text-brand-navy mb-3 group-hover:underline decoration-brand-gold decoration-1 underline-offset-4">
      tool-name
    </h3>
    <p class="text-brand-navy/60 text-sm font-light leading-relaxed">
      Description of the tool.
    </p>
  </div>
  <!-- Footer -->
  <div class="flex justify-between items-center text-xs font-semibold uppercase tracking-widest text-brand-navy/40 border-t border-brand-navy/5 pt-6">
    <span>TypeScript</span>
    <span class="group-hover:text-brand-navy transition-colors flex items-center gap-2">View Repo →</span>
  </div>
</div>
```

### Shadow-Offset Card (Featured)
High-emphasis card with a navy block shadow offset behind a white container.

```html
<div class="relative">
  <!-- Shadow offset block -->
  <div class="absolute top-0 left-0 w-full h-full bg-brand-navy transform translate-x-4 translate-y-4 -z-10"></div>
  <!-- Card body -->
  <div class="bg-white p-12 border border-brand-navy/10">
    <h3 class="font-display text-4xl text-brand-navy italic mb-8">By the numbers</h3>
    <!-- Content -->
  </div>
</div>
```

### Dark Quote Card (Navy, with Gold Offset Border)
Used in hero section and featured callouts.

```html
<div class="bg-brand-navy text-white p-10 relative shadow-2xl">
  <!-- Gold border offset (behind the card) -->
  <div class="absolute -top-4 -left-4 w-full h-full border border-brand-gold -z-10"></div>
  <!-- Body -->
</div>
```

---

## Buttons & CTAs

### Arrow CTA Link (Primary)
The main CTA style — not a traditional button, but a text link + animated arrow in a circle.

```html
<a href="/contact" class="inline-flex items-center gap-4 text-brand-cream hover:text-brand-gold transition-colors group">
  <span class="text-lg font-display italic">Get in Touch</span>
  <span class="w-12 h-12 rounded-full border border-brand-cream/20 flex items-center justify-center group-hover:bg-brand-gold group-hover:border-brand-gold group-hover:text-brand-navy transition-all duration-300">
    →
  </span>
</a>
```

On cream backgrounds:
```html
<a href="#" class="inline-flex items-center gap-4 text-brand-navy hover:text-brand-gold transition-colors group">
  <span class="text-lg font-display italic">Start Building</span>
  <span class="w-12 h-12 rounded-full border border-brand-navy/10 flex items-center justify-center group-hover:bg-brand-navy group-hover:text-brand-gold transition-all duration-300">
    →
  </span>
</a>
```

### Square Icon Button (Nav Arrow)
Sharp square buttons for carousels and pagination.

```html
<button class="w-12 h-12 border border-brand-navy/10 flex items-center justify-center hover:bg-brand-navy hover:text-white transition-colors text-brand-navy">
  ←
</button>
```

### Inline Text Link with Arrow
```html
<button class="text-brand-gold font-medium hover:underline decoration-brand-gold/30 underline-offset-4 transition-all group/link inline-flex items-center gap-1">
  Learn how.
  <span class="group-hover/link:translate-x-1 transition-transform">→</span>
</button>
```

---

## Dark Section (Navy Background)

Used for hero CTAs, quote breaks, and the footer. Always uses the linen texture overlay for warmth.

```html
<section class="relative bg-brand-navy py-24 px-6 md:px-12 overflow-hidden">
  <!-- Linen texture overlay -->
  <div class="absolute inset-0 opacity-10"
       style="background-image: url('https://www.transparenttextures.com/patterns/linen.png')">
  </div>

  <div class="relative z-10 text-center max-w-2xl mx-auto">
    <span class="w-12 h-[1px] bg-brand-gold block mx-auto mb-8"></span>
    <h2 class="text-4xl md:text-6xl font-display text-brand-cream tracking-tight mb-8 leading-snug">
      Build in public. <br />
      <i class="text-brand-gold">Share everything.</i>
    </h2>
    <p class="text-brand-cream/60 text-lg font-light max-w-md mx-auto leading-relaxed">
      Supporting copy goes here.
    </p>
    <span class="font-script text-2xl text-brand-gold/80 mt-8 block">The Avant-Garde Philosophy</span>
  </div>
</section>
```

---

## Marquee / Ticker

Infinite horizontal scroll of keywords. Navy text with gold diamond separators (`✦`).

```html
<div class="border-y border-brand-navy/5 py-6 overflow-hidden bg-white">
  <div class="whitespace-nowrap animate-marquee flex items-center gap-24 text-brand-navy text-sm md:text-base font-display italic tracking-widest">
    <span>AI Agents</span>
    <span class="text-brand-gold text-xs">✦</span>
    <span>Commerce</span>
    <span class="text-brand-gold text-xs">✦</span>
    <span>In Practice</span>
    <span class="text-brand-gold text-xs">✦</span>
    <!-- Duplicate set for seamless loop -->
    <span>AI Agents</span>
    <span class="text-brand-gold text-xs">✦</span>
    <span>Commerce</span>
    <span class="text-brand-gold text-xs">✦</span>
    <span>In Practice</span>
  </div>
</div>
```

Marquee keyframe (add to your CSS or Tailwind config):
```css
@keyframes marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.animate-marquee { animation: marquee 60s linear infinite; }
```

---

## Bento Grid

Mixed-size grid of stat blocks, feature blocks, and CTAs.

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  <!-- 2-col, 2-row dark feature block -->
  <div class="col-span-1 md:col-span-2 row-span-2 relative bg-brand-navy p-10 flex flex-col justify-between group overflow-hidden">
    <div class="absolute inset-0 linen-texture opacity-10"></div>
    <!-- Decorative background icon -->
    <div class="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity">
      <!-- Large icon here -->
    </div>
    <div class="relative z-10">
      <span class="text-xs text-brand-gold uppercase tracking-widest mb-4 block">Weekly Dispatch</span>
      <h3 class="text-4xl font-display text-white mb-4 italic">The Agent</h3>
      <p class="text-white/60 text-lg font-light max-w-sm">Description text.</p>
    </div>
    <div class="relative z-10 mt-12">
      <div class="flex items-center gap-4 text-white/80 hover:text-brand-gold transition-colors cursor-pointer">
        <span class="uppercase tracking-widest text-sm">Subscribe</span>
        <span class="w-12 h-[1px] bg-current"></span>
      </div>
    </div>
  </div>

  <!-- Single stat block -->
  <div class="bg-white border border-brand-navy/5 p-8 flex flex-col justify-center items-center text-center hover:shadow-lg transition-shadow duration-500">
    <span class="text-5xl text-brand-navy font-display mb-2">24K+</span>
    <span class="text-xs uppercase tracking-widest text-brand-navy/40 font-semibold">GitHub Stars</span>
  </div>

  <!-- Gold-tinted CTA block (2-col) -->
  <div class="col-span-1 md:col-span-2 bg-brand-gold/10 border border-brand-gold/20 p-8 flex items-center justify-between group cursor-pointer hover:bg-brand-gold/20 transition-all">
    <div>
      <span class="text-xs text-brand-navy/60 uppercase tracking-widest mb-2 block">Join the Community</span>
      <h4 class="text-xl text-brand-navy font-display italic">4,200+ builders in our Discord</h4>
    </div>
    <div class="w-12 h-12 rounded-full bg-brand-navy text-brand-gold flex items-center justify-center group-hover:scale-110 transition-transform">→</div>
  </div>
</div>
```

---

## Timeline

Vertical timeline with Pinyon Script dates, gold dots, and italic display titles.

```html
<div class="space-y-12">
  <div class="flex items-start gap-8">
    <!-- Date in script -->
    <div class="flex-shrink-0 w-24">
      <span class="font-script text-xl text-brand-gold">Q1 2025</span>
    </div>
    <!-- Gold dot + vertical line -->
    <div class="flex-shrink-0 relative">
      <div class="w-4 h-4 bg-brand-gold rounded-full"></div>
      <div class="absolute top-4 left-1/2 -translate-x-1/2 w-[1px] h-16 bg-brand-navy/10"></div>
    </div>
    <!-- Content -->
    <div class="pb-8">
      <h3 class="text-xl font-display text-brand-navy mb-2 italic">Milestone Title</h3>
      <p class="text-brand-navy/60 font-light leading-relaxed">Milestone description.</p>
    </div>
  </div>
</div>
```

---

## Left Border Accent (Methodology / List Items)

A gold left border used for feature lists, methodology items, and callout blocks.

```html
<div class="border-l-4 border-brand-gold pl-8 py-4">
  <h3 class="text-xl font-display text-brand-navy mb-4 italic">Feature Title</h3>
  <p class="text-brand-navy/60 font-light leading-relaxed">Description text.</p>
</div>
```

---

## Bullet List (Gold Dot)

```html
<ul class="space-y-4">
  <li class="flex items-start gap-4">
    <span class="w-1.5 h-1.5 bg-brand-gold rounded-full mt-2 flex-shrink-0"></span>
    <span class="text-brand-navy/70 font-light leading-relaxed">List item text here.</span>
  </li>
</ul>
```

---

## Footer

Navy background, large display headline, link columns, logo bottom-right.

```html
<footer class="bg-brand-navy pt-24 pb-12 text-brand-cream border-t border-brand-gold">
  <div class="px-6 md:px-12 max-w-screen-xl mx-auto">
    <!-- CTA row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-16 mb-24">
      <div>
        <h2 class="text-5xl md:text-7xl font-display tracking-tight leading-none">
          Build <br />
          <span class="italic text-brand-gold">Forward.</span>
        </h2>
        <p class="text-white/40 max-w-sm font-light mt-6">Tagline here.</p>
      </div>
      <div class="flex flex-col justify-end items-start lg:items-end">
        <a href="/contact" class="group flex items-center gap-6 text-3xl font-display italic font-light hover:text-brand-gold transition-colors">
          Start Building
          <span class="group-hover:translate-x-4 transition-transform duration-500">→</span>
        </a>
      </div>
    </div>

    <!-- Link columns -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-12 border-t border-white/10 pt-12">
      <div class="flex flex-col gap-6">
        <span class="text-xs text-brand-gold uppercase tracking-widest font-semibold">Navigate</span>
        <a href="/ventures" class="text-sm text-white/60 hover:text-white transition-colors">Ventures</a>
      </div>
      <!-- More columns... -->
      <div class="flex flex-col gap-6 justify-end items-end">
        <img src="/images/logo.png" alt="Avant-Garde" class="h-8 w-auto" />
        <span class="text-xs text-white/40 uppercase tracking-widest">© 2025</span>
      </div>
    </div>
  </div>
</footer>
```

---

## Hover & Animation Patterns

### Image Grayscale-to-Color on Parent Hover
```css
.grayscale-hover {
  filter: grayscale(100%) sepia(20%);
  opacity: 0.9;
  transition: all 1s ease-in-out;
}
.group:hover .grayscale-hover {
  filter: grayscale(0%) sepia(0%);
  transform: scale(1.05);
}
```

### Reveal Info on Hover
```css
.reveal-info {
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.5s ease-out;
}
.group:hover .reveal-info {
  opacity: 1;
  transform: translateY(0);
}
```

### Accent Bar Slide-In
```css
.accent-bar {
  position: absolute;
  top: 0; left: 0;
  width: 4px;
  height: 100%;
  background-color: #C4A47C;
  transform: scaleY(0);
  transform-origin: top;
  transition: transform 0.5s ease-out;
}
.group:hover .accent-bar { transform: scaleY(1); }
```

### Standard Transition
```css
.transition-brand {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Scrollbar

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: #f5f5f4; }
::-webkit-scrollbar-thumb { background: #C4A47C; border-radius: 0px; }
::-webkit-scrollbar-thumb:hover { background: #1B263B; }
```

---

## Image Treatment

- Default: grayscale + sepia with transition to color on hover (`.grayscale-hover`)
- Always wrap images in an `overflow-hidden` container
- Add an inset white border overlay for a "matted print" effect:

```html
<div class="relative overflow-hidden">
  <img src="..." class="w-full h-full object-cover grayscale-hover" />
  <!-- White mat border overlay -->
  <div class="absolute inset-0 border-[12px] border-white/50"></div>
</div>
```
