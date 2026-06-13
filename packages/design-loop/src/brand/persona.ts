/**
 * Persona resolution — the graceful NeuroGraph fork (PRD §4.5).
 *
 * When NeuroGraph is connected, the persona is pulled from the NeuroGraph MCP
 * (Phase 5 fills the real client); otherwise it is elicited in the same shape.
 * Both implement `PersonaSource` so the brand-definition flow is fork-agnostic.
 */
import type { PersonaSection } from "./schema.js";

export interface PersonaInput {
  brandId: string;
  category: string;
}

export type ResolvedPersona = PersonaSection;

export interface PersonaSource {
  resolve(input: PersonaInput): Promise<ResolvedPersona>;
}

/**
 * Elicited persona — a first-pass scaffold the owner refines with the agent.
 * Deliberately generic prompts, not invented specifics: generated-with-the-human.
 */
export const elicitedPersona: PersonaSource = {
  resolve: async ({ category }) => ({
    source: "elicited",
    summary: `Intended buyer for ${category || "this store"} — to be refined with the owner.`,
    drivers: [
      "the primary motivation that brings them to buy (confirm with owner)",
      "what 'good' looks like to them in this category",
    ],
    objections: [
      "the top hesitation that stalls the purchase (confirm with owner)",
      "price/quality/trust uncertainty",
    ],
    trustRequirements: [
      "proof the product delivers (reviews, guarantees, provenance)",
      "clear returns/shipping expectations",
    ],
  }),
};

/**
 * Stub for the NeuroGraph-connected path. Phase 5 replaces this with a real
 * NeuroGraph MCP client that returns the PDO persona pinned at ref@version.
 */
export function neurographPersonaStub(ref: string): PersonaSource {
  return {
    resolve: async () => ({
      source: "neurograph",
      ref,
      summary: `PDO persona ${ref} (pulled via the NeuroGraph MCP).`,
      drivers: ["[from PDO DRIVES edges]"],
      objections: ["[from PDO INHIBITS edges]"],
      trustRequirements: ["[from PDO TRUST concepts]"],
    }),
  };
}
