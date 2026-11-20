/**
 * DTC seed axis prompts (spec 35 §3.1).
 *
 * These are DIMENSIONS ONLY: named questions a labeler should ask of a page.
 * No values are seeded. Every value must be earned from the corpus through the
 * distinct-brand admission gate, exactly as the Arthaus vocabulary was earned
 * from shipped portfolios. Seeding values would be guessing in a prompt, which
 * is the failure the gate exists to prevent.
 *
 * Descriptions are QUESTIONS WITH NO EXAMPLE ANSWERS. The first live label
 * (Gemini, 2026-11-19) echoed example phrases from the descriptions nearly
 * verbatim ("stark-white", "hard-color-cuts"). Examples in a prompt are seeded
 * values by another name, and they make every brand converge on the same words
 * and pass the recurrence gate artificially. Keep them out.
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
  { axis: "announcement-bar-treatment", pages: ["home", "collection", "product"], description: "What does the strip above the header (if any) do, and how does it behave?" },
  { axis: "nav-architecture", pages: ["home", "collection", "product"], description: "How is primary navigation organized, laid out, and revealed?" },
  { axis: "ground-tone", pages: ["home", "collection", "product", "landing"], description: "What is the page ground, and how does it change down the page?" },
  { axis: "type-voice", pages: ["home", "product", "landing"], description: "What is the typographic register, and how do display and body type relate?" },
  { axis: "accent-economy", pages: ["home", "collection", "product"], description: "How sparingly or liberally is accent color spent, and on which elements?" },
  { axis: "section-seam", pages: ["home", "landing"], description: "How does one section hand off to the next?" },
  { axis: "motion-language", pages: ["home", "product", "landing"], description: "What motion, if any, does the page use, and what triggers it?" },

  // Home / landing
  { axis: "hero-composition", pages: ["home", "landing"], description: "How is the first screen composed: what occupies it and how is it arranged?" },
  { axis: "hero-message-mode", pages: ["home", "landing"], description: "What does the first screen say first, and in what form?" },
  { axis: "merchandising-entry", pages: ["home"], description: "How does the home page route a shopper into products?" },
  { axis: "brand-story-placement", pages: ["home", "landing"], description: "Where and how does the brand's story appear relative to product?" },

  // Collection
  { axis: "collection-grid-density", pages: ["collection"], description: "What is the rhythm of the product grid, and does anything break it?" },
  { axis: "product-card-anatomy", pages: ["collection", "home"], description: "What does a product card show, in what order, and what happens on interaction?" },
  { axis: "filter-presentation", pages: ["collection"], description: "How are filtering and sorting presented?" },

  // Product page
  { axis: "pdp-gallery-behavior", pages: ["product"], description: "How does product imagery behave as the shopper browses it?" },
  { axis: "buy-box-structure", pages: ["product"], description: "How is the purchase column ordered and dressed?" },
  { axis: "variant-selection-style", pages: ["product"], description: "How are product options chosen?" },
  { axis: "offer-framing", pages: ["product", "home", "cart"], description: "How are price and promotion framed?" },
  { axis: "social-proof-density", pages: ["product", "home", "collection"], description: "How much social proof appears, in what forms, and where?" },
  { axis: "trust-signal-placement", pages: ["product", "cart"], description: "Where do guarantees and reassurance sit relative to the call to action?" },
  { axis: "product-detail-disclosure", pages: ["product"], description: "How is long-form product detail disclosed?" },
  { axis: "cross-sell-pattern", pages: ["product", "cart"], description: "How are additional products offered?" },

  // Cart
  { axis: "cart-surface", pages: ["cart", "product"], description: "Where does the cart live, and what does it show besides line items?" },

  // Imagery
  { axis: "photography-register", pages: ["home", "collection", "product", "landing"], description: "What is the photographic language, and does it shift by context?" },
];

export function seedAxesFor(page: PageType): SeedAxis[] {
  return DTC_SEED_AXES.filter((a) => a.pages.includes(page));
}
