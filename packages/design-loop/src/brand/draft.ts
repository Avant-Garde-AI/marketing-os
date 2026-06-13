/**
 * draftBrandDesign — the first-pass Brand Conversion Document the agent presents
 * to the owner (PRD §1 Phase A). Grounded in the Design MCP's category
 * conventions, principles, and token recommendations so the owner reacts to
 * concrete proposals rather than blank fields. The owner then refines it with
 * the agent (generated-with-the-human) before it is committed.
 */
import type { DesignKnowledge } from "../design-mcp/types.js";
import type { BrandContext } from "../types.js";
import { brandDesignDocSchema, type BrandDesignDoc } from "./schema.js";
import type { PersonaSource } from "./persona.js";

export interface DraftInput {
  brandId: string;
  category: string;
  now: () => string;
  knowledge: DesignKnowledge;
  persona: PersonaSource;
  /** Optional signals inferred from the live site (PRD §1 Phase A step 1). */
  storeSignals?: {
    name?: string;
    currentTokens?: Record<string, string>;
  };
}

export async function draftBrandDesign(input: DraftInput): Promise<BrandDesignDoc> {
  const { brandId, category, now, knowledge, persona } = input;

  const brandSeed: BrandContext = {
    brandId,
    category,
    tokens: input.storeSignals?.currentTokens ?? {},
    principles: [],
  };
  const [resolvedPersona, conventions, principles, tokenRec] = await Promise.all([
    persona.resolve({ brandId, category }),
    knowledge.getCategoryConventions({ taxonomyNode: category }),
    knowledge.queryDesignPrinciples({ intent: "brand definition" }),
    knowledge.recommendDesignTokens({ brand: brandSeed }),
  ]);

  // Persona→design mapping: pair the persona's drivers/objections with the
  // category's principles — the agent's decision rubric (PRD §2 §6).
  const designPrinciples = [
    ...principles.map((p) => `${p.name}: ${p.rationale}`),
    ...resolvedPersona.drivers.map((d) => `Activate driver — ${d}`),
    ...resolvedPersona.objections.map((o) => `Resolve objection — ${o}`),
  ];

  const doc: BrandDesignDoc = {
    frontmatter: {
      brandId,
      neurographPersona: resolvedPersona.source === "neurograph" ? (resolvedPersona.ref ?? null) : null,
      category,
      version: "0.1.0",
      updated: now(),
    },
    essence: `${input.storeSignals?.name ?? brandId} — positioning to confirm with the owner. ` +
      `Premium signals for this category: ${conventions.premiumSignals.join(", ")}.`,
    persona: resolvedPersona,
    valueProp: "What's sold and why it wins — to be mapped to the persona's drivers with the owner.",
    visualIdentity: {
      tokens: tokenRec.colors,
      typography: tokenRec.type["headingFamily"] ?? "",
      imagery: "Imagery direction to confirm with the owner.",
      summary: tokenRec.rationale,
    },
    voice: {
      tone: "Tone to confirm with the owner.",
      vocabulary: [],
      donts: [],
    },
    designPrinciples,
    categoryContext: [
      `Conventions: ${conventions.conventions.join("; ")}.`,
      `Premium signals: ${conventions.premiumSignals.join(", ")}.`,
      `Value signals: ${conventions.valueSignals.join(", ")}.`,
    ].join("\n"),
    conversionPriorities: conventions.highConvertingPatterns,
    guardrails: { wcag: "AA", noDarkPatterns: true, custom: [] },
  };

  return brandDesignDocSchema.parse(doc);
}
