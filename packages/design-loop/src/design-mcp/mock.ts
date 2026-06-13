/**
 * MockDesignKnowledge — deterministic, in-process Design MCP for development and
 * tests until the hosted knowledge plane lands. Returns canned, ABSTRACTED
 * knowledge; its `validateDesignConformance` reuses the deterministic gates so a
 * mock-backed conformance read is self-consistent with the local veto layer.
 */
import { checkA11y, checkDarkPatterns, checkTokenFidelity } from "../gates.js";
import type { ConformanceResult } from "../types.js";
import {
  assertAbstracted,
  type CategoryConventions,
  type DesignKnowledge,
  type DesignPrinciple,
  type ReferencePattern,
  type TokenRecommendation,
  type ValidateConformanceInput,
} from "./types.js";

export class MockDesignKnowledge implements DesignKnowledge {
  async getCategoryConventions({ taxonomyNode }: { taxonomyNode: string }): Promise<CategoryConventions> {
    return {
      taxonomyNode,
      conventions: [
        "lead the PDP above-the-fold with a single hero product shot",
        "show price and primary CTA without scrolling",
        "place trust signals (returns, shipping) adjacent to the buy box",
      ],
      premiumSignals: ["generous whitespace", "restrained palette", "editorial typography"],
      valueSignals: ["dense grids", "badges and savings callouts", "high-contrast CTAs"],
      highConvertingPatterns: ["sticky add-to-cart on mobile", "benefit-led section ordering"],
    };
  }

  async queryDesignPrinciples({ intent, pattern }: { intent?: string; pattern?: string }): Promise<DesignPrinciple[]> {
    const topic = intent ?? pattern ?? "general";
    return [
      { name: "visual hierarchy", rationale: `Guide the eye to the primary action for "${topic}".`, appliesTo: ["hero", "pdp"] },
      { name: "type scale", rationale: "A consistent modular scale reads as intentional and premium.", appliesTo: ["all"] },
      { name: "contrast", rationale: "Primary CTAs must clear the surrounding contrast floor to convert.", appliesTo: ["cta"] },
    ];
  }

  async retrieveReferencePatterns({ intent, category }: { intent: string; category: string }): Promise<ReferencePattern[]> {
    return assertAbstracted([
      {
        name: "benefit-led hero",
        structure: "headline → one-line value prop → primary CTA → single supporting image",
        approach: `Frame "${intent}" around the persona's top driver before any product detail.`,
        whyItWorks: `Reduces time-to-comprehension for ${category} buyers and front-loads the decision driver.`,
      },
      {
        name: "adjacent trust cluster",
        structure: "buy box with shipping/returns/guarantee chips placed inline",
        approach: "Resolve the top objection at the point of decision rather than in the footer.",
        whyItWorks: "Objection resolution at the buy box lifts add-to-cart by removing hesitation.",
      },
    ]);
  }

  async recommendDesignTokens({ brand }: { brand: { tokens: Record<string, string> } }): Promise<TokenRecommendation> {
    const primary = brand.tokens["primary"] ?? "#111111";
    const bg = brand.tokens["bg"] ?? "#ffffff";
    return {
      colors: { primary, bg, accent: "#7a5cff", muted: "#6b7280" },
      type: { scaleBase: "1.125", headingFamily: "serif", bodyFamily: "sans-serif" },
      spacing: { unit: "8px", section: "64px" },
      rationale: "A restrained palette anchored on the brand primary with an 8px spacing system.",
    };
  }

  async validateDesignConformance(input: ValidateConformanceInput): Promise<ConformanceResult> {
    const { captureBundleRef: bundle, brand, wcag } = input;
    const darkPattern = checkDarkPatterns(bundle);
    const a11y = checkA11y(bundle, wcag);
    const tokenFidelity = checkTokenFidelity(bundle, brand);

    // Simulated persona read: high when the page is clean, penalized by flags.
    const clean = darkPattern.passed && a11y.passed;
    const personaScore = clean ? 0.9 : 0.5;
    const passed = clean && personaScore >= 0.85;

    return {
      score: clean ? personaScore : 0,
      passed,
      personaFit: {
        score: personaScore,
        notes: clean
          ? ["activates the documented decision drivers"]
          : ["guardrail/quality issues block a clean persona read"],
      },
      flags: [],
      gates: { darkPattern, a11y, tokenFidelity },
      source: "design-mcp",
    };
  }
}
