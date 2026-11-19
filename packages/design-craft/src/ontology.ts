/**
 * DTC seed axis prompts (spec 35 §3.1).
 *
 * These are DIMENSIONS ONLY: named questions a labeler should ask of a page.
 * No values are seeded. Every value must be earned from the corpus through the
 * distinct-brand admission gate, exactly as the Arthaus vocabulary was earned
 * from shipped portfolios. Seeding values would be guessing in a prompt, which
 * is the failure the gate exists to prevent.
 *
 * A seed axis that never attracts proposals from ≥3 brands simply never becomes
 * recognized. The list is a starting lens, not a schema, and the open register
 * can always name dimensions that aren't here.
 */
import type { AxisPrompt } from "./vocabulary.js";

export type PageType = "home" | "collection" | "product" | "cart" | "landing" | "other";

export interface SeedAxis extends AxisPrompt {
  /** Page types where this dimension is usually visible. */
  pages: PageType[];
}

export const DTC_SEED_AXES: SeedAxis[] = [
  // Global chrome + ground
  { axis: "announcement-bar-treatment", pages: ["home", "collection", "product"], description: "What the top-of-page strip does: rotating offers, a single static claim, a marquee, none." },
  { axis: "nav-architecture", pages: ["home", "collection", "product"], description: "How navigation is organized and revealed: mega-menu with imagery, minimal centered logo, drawer-first, category tabs." },
  { axis: "ground-tone", pages: ["home", "collection", "product", "landing"], description: "The page ground: warm off-white, stark white, saturated brand color blocks, dark mode, alternating bands." },
  { axis: "type-voice", pages: ["home", "product", "landing"], description: "The typographic register: editorial serif display, oversized grotesk, condensed caps, handwritten accents, and how display and body type relate." },
  { axis: "accent-economy", pages: ["home", "collection", "product"], description: "How sparingly the accent color is spent, and on what (CTAs only, badges, section grounds, everywhere)." },
  { axis: "section-seam", pages: ["home", "landing"], description: "How one section hands off to the next: hard color cuts, hairline rules, overlapping cards, full-bleed image breaks, generous whitespace." },
  { axis: "motion-language", pages: ["home", "product", "landing"], description: "The motion register: none, subtle fade-ups, scroll-linked parallax, marquee tickers, hover image swaps." },

  // Home / landing
  { axis: "hero-composition", pages: ["home", "landing"], description: "How the first screen is composed: full-bleed lifestyle image, split product/copy, video loop, product-on-color, editorial collage." },
  { axis: "hero-message-mode", pages: ["home", "landing"], description: "What the hero says first: a benefit claim, a brand manifesto line, an offer, a product name, a social-proof stat." },
  { axis: "merchandising-entry", pages: ["home"], description: "How shoppers are routed into product from home: category tiles, bestseller carousel, shop-by-concern/need, quiz entry, single hero product." },
  { axis: "brand-story-placement", pages: ["home", "landing"], description: "Where and how the founder/mission/ingredients story appears relative to product." },

  // Collection
  { axis: "collection-grid-density", pages: ["collection"], description: "Grid rhythm: products per row, image aspect, inline editorial/promo tiles breaking the grid." },
  { axis: "product-card-anatomy", pages: ["collection", "home"], description: "What a product card shows and in what order: swatches, ratings, badges, price treatment, hover second image, quick-add." },
  { axis: "filter-presentation", pages: ["collection"], description: "How filtering and sorting is presented: sidebar facets, top chips, drawer, none." },

  // Product page
  { axis: "pdp-gallery-behavior", pages: ["product"], description: "How product imagery behaves: sticky thumbnail rail, stacked full-width scroll, carousel with dots, mixed video/UGC tiles." },
  { axis: "buy-box-structure", pages: ["product"], description: "How the purchase column is ordered and dressed: title/price/variant/CTA ordering, subscription toggles, bundle pickers, sticky add-to-cart." },
  { axis: "variant-selection-style", pages: ["product"], description: "How options are chosen: color swatches with imagery, pill buttons, dropdowns, visual size guides." },
  { axis: "offer-framing", pages: ["product", "home", "cart"], description: "How price and promotion are framed: strike-through compare-at, subscribe-and-save percentage, bundle savings, free-shipping threshold, gift-with-purchase." },
  { axis: "social-proof-density", pages: ["product", "home", "collection"], description: "How much social proof appears and in what form: star summary near title, review carousels, UGC photo walls, press logos, counts sold." },
  { axis: "trust-signal-placement", pages: ["product", "cart"], description: "Where guarantees, shipping/returns, payment badges, and certifications sit relative to the CTA." },
  { axis: "product-detail-disclosure", pages: ["product"], description: "How long-form detail is disclosed: accordions, tabs, icon benefit rows, ingredient/material spotlights, comparison tables." },
  { axis: "cross-sell-pattern", pages: ["product", "cart"], description: "How additional products are offered: complete-the-look, frequently-bought-together, recently viewed, routine builders." },

  // Cart
  { axis: "cart-surface", pages: ["cart", "product"], description: "Where the cart lives: slide-out drawer, full page, modal, and what it shows (progress bars, upsells, notes)." },

  // Imagery
  { axis: "photography-register", pages: ["home", "collection", "product", "landing"], description: "The photographic language: studio on seamless, lifestyle in context, flat-lay, macro texture, UGC-style phone shots." },
];

export function seedAxesFor(page: PageType): SeedAxis[] {
  return DTC_SEED_AXES.filter((a) => a.pages.includes(page));
}
