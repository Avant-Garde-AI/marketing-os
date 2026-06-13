/**
 * The Brand Conversion Document (`brand-design.md`) — PRD §2.
 *
 * The persisted brand definition authored in Phase A, committed to the client
 * repo, and the contract the design-code agent adheres to. Structured front
 * matter + 9 sections.
 */
import { z } from "zod";

export const brandFrontmatterSchema = z.object({
  brandId: z.string(),
  /** PDO persona ref@version when NeuroGraph is connected, else null (PRD §4.5). */
  neurographPersona: z.string().nullable().default(null),
  /** Shopify taxonomy node. */
  category: z.string().default(""),
  version: z.string().default("0.1.0"),
  updated: z.string(),
});
export type BrandFrontmatter = z.infer<typeof brandFrontmatterSchema>;

export const personaSectionSchema = z.object({
  source: z.enum(["elicited", "neurograph"]).default("elicited"),
  ref: z.string().optional(),
  summary: z.string().default(""),
  drivers: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  trustRequirements: z.array(z.string()).default([]),
});
export type PersonaSection = z.infer<typeof personaSectionSchema>;

export const visualIdentitySchema = z.object({
  /** Machine-readable bridge to theme code (PRD §2 §4). */
  tokens: z.record(z.string(), z.string()).default({}),
  typography: z.string().default(""),
  imagery: z.string().default(""),
  summary: z.string().default(""),
});
export type VisualIdentity = z.infer<typeof visualIdentitySchema>;

export const voiceSchema = z.object({
  tone: z.string().default(""),
  vocabulary: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
});
export type Voice = z.infer<typeof voiceSchema>;

export const brandGuardrailsSchema = z.object({
  wcag: z.enum(["A", "AA", "AAA"]).default("AA"),
  noDarkPatterns: z.literal(true).default(true),
  custom: z.array(z.string()).default([]),
});
export type BrandGuardrails = z.infer<typeof brandGuardrailsSchema>;

export const brandDesignDocSchema = z.object({
  frontmatter: brandFrontmatterSchema,
  essence: z.string().default(""),
  persona: personaSectionSchema.default({}),
  valueProp: z.string().default(""),
  visualIdentity: visualIdentitySchema.default({}),
  voice: voiceSchema.default({}),
  /** The persona→design mapping — the agent's decision rubric (PRD §2 §6). */
  designPrinciples: z.array(z.string()).default([]),
  categoryContext: z.string().default(""),
  conversionPriorities: z.array(z.string()).default([]),
  guardrails: brandGuardrailsSchema.default({ wcag: "AA", noDarkPatterns: true, custom: [] }),
});
export type BrandDesignDoc = z.infer<typeof brandDesignDocSchema>;
export type BrandDesignDocInput = z.input<typeof brandDesignDocSchema>;
