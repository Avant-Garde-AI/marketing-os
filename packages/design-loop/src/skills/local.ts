/**
 * Bundled v0 design skill-set (PRD §4.3). The deterministic default the agent
 * uses when no remote skill-set registry is configured. These are the seed
 * skills the network learning loop later refines/consolidates/discovers (§5).
 */
import type { DesignSkill, SkillSet } from "./types.js";

const SKILLSET_VERSION = "0.1.0";

const SKILLS: DesignSkill[] = [
  {
    id: "establish-type-scale",
    name: "Establish Type Scale",
    version: "0.1.0",
    description: "Set a consistent modular type scale and heading hierarchy.",
    appliesTo: { intents: ["type", "typography", "scale", "hierarchy", "headline"], sections: ["all", "hero", "product"] },
    procedure: [
      "Pick a modular scale base (e.g. 1.125–1.25) tied to the brand tokens.",
      "Map h1/h2/h3/body/caption to the scale; set line-height per step.",
      "Apply via theme settings/CSS variables, not per-element overrides.",
    ],
  },
  {
    id: "build-pdp-above-fold",
    name: "Build PDP Above-the-Fold",
    version: "0.1.0",
    description: "Compose the product page above-the-fold for fast comprehension and add-to-cart.",
    appliesTo: { intents: ["pdp", "product", "above-fold", "buy", "cart"], sections: ["product", "hero", "buy-box"] },
    procedure: [
      "Single hero product shot; price and primary CTA visible without scrolling.",
      "Place trust signals (returns/shipping/guarantee) adjacent to the buy box.",
      "Order supporting content benefit-first per the persona's drivers.",
    ],
  },
  {
    id: "implement-hero-section",
    name: "Implement Hero Section",
    version: "0.1.0",
    description: "Build a benefit-led hero that activates the persona's top driver.",
    appliesTo: { intents: ["hero", "headline", "cta", "banner"], sections: ["hero"] },
    procedure: [
      "Headline → one-line value prop → primary CTA → single supporting image.",
      "Lead with the persona's top decision driver before product detail.",
      "Ensure CTA contrast clears the WCAG floor.",
    ],
  },
  {
    id: "apply-spacing-system",
    name: "Apply Spacing System",
    version: "0.1.0",
    description: "Apply a consistent spacing scale for rhythm and premium feel.",
    appliesTo: { intents: ["spacing", "whitespace", "layout", "rhythm"], sections: ["all"] },
    procedure: [
      "Adopt an 8px base spacing unit; section padding on a consistent step.",
      "Replace ad-hoc margins with the scale; verify vertical rhythm.",
    ],
  },
  {
    id: "responsive-breakpoint-pass",
    name: "Responsive Breakpoint Pass",
    version: "0.1.0",
    description: "Verify and fix layout at 390/768/1440 breakpoints.",
    appliesTo: { intents: ["responsive", "mobile", "breakpoint", "tablet"], sections: ["all"] },
    procedure: [
      "Check 390/768/1440; ensure no overflow and that the CTA stays in reach.",
      "Add a sticky add-to-cart on mobile where it lifts conversion.",
    ],
  },
  {
    id: "collection-grid-system",
    name: "Collection Grid System",
    version: "0.1.0",
    description: "Build a scannable, consistent collection/PLP grid.",
    appliesTo: { intents: ["collection", "grid", "plp", "catalog"], sections: ["collection"] },
    procedure: [
      "Consistent card aspect ratio, gutters on the spacing scale.",
      "Surface the most decision-relevant attribute per card for the persona.",
    ],
  },
];

export const LOCAL_SKILLSET: SkillSet = {
  manifest: {
    version: SKILLSET_VERSION,
    skills: SKILLS.map((s) => ({ id: s.id, version: s.version })),
  },
  skills: SKILLS,
};

export function loadLocalSkillSet(): SkillSet {
  return LOCAL_SKILLSET;
}
