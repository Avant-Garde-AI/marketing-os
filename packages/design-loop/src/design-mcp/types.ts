/**
 * Design MCP — the design-knowledge interface the agent consults at decision
 * points (PRD §4.1). Delivered by the knowledge plane (`marketing-os-agents`);
 * we consume the contract. `DesignKnowledge` is transport-agnostic — a mock and
 * a remote MCP client both implement it.
 */
import type { BrandContext, CaptureBundleRef, ConformanceResult } from "../types.js";

export interface CategoryConventions {
  taxonomyNode: string;
  conventions: string[];
  premiumSignals: string[];
  valueSignals: string[];
  highConvertingPatterns: string[];
}

export interface DesignPrinciple {
  name: string;
  rationale: string;
  appliesTo: string[];
}

/**
 * Abstracted pattern descriptions only — structure/approach/why, NEVER source
 * pages, imagery, or verbatim copy (PRD §4.4). Enforced by `assertAbstracted`.
 */
export interface ReferencePattern {
  name: string;
  structure: string;
  approach: string;
  whyItWorks: string;
}

export interface TokenRecommendation {
  colors: Record<string, string>;
  type: Record<string, string>;
  spacing: Record<string, string>;
  rationale: string;
}

export interface ValidateConformanceInput {
  /** Passed BY REFERENCE — never inline the bundle (PRD §4.2). */
  captureBundleRef: CaptureBundleRef;
  brandDesignRef: { path: string; version: string };
  brand: BrandContext;
  intent: string;
  wcag: "A" | "AA" | "AAA";
}

export interface DesignKnowledge {
  getCategoryConventions(input: { taxonomyNode: string }): Promise<CategoryConventions>;
  queryDesignPrinciples(input: { intent?: string; pattern?: string }): Promise<DesignPrinciple[]>;
  retrieveReferencePatterns(input: { intent: string; category: string }): Promise<ReferencePattern[]>;
  recommendDesignTokens(input: { brand: BrandContext }): Promise<TokenRecommendation>;
  validateDesignConformance(input: ValidateConformanceInput): Promise<ConformanceResult>;
}

/**
 * Client-side defense for the asset boundary (PRD §4.4, layer analog): reject any
 * reference pattern that smuggles a source URL or a long verbatim copy block.
 * The MCP egress lint is the server-side layer; this is belt-and-suspenders.
 */
export function assertAbstracted(patterns: ReferencePattern[]): ReferencePattern[] {
  const urlRe = /(https?:\/\/|data:image\/|\.(png|jpe?g|webp|gif|svg)\b)/i;
  for (const p of patterns) {
    const blob = `${p.structure}\n${p.approach}\n${p.whyItWorks}`;
    if (urlRe.test(blob)) {
      throw new Error(`Design MCP returned a non-abstracted reference pattern "${p.name}" (contains a source asset reference).`);
    }
  }
  return patterns;
}
