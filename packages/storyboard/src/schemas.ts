import { z } from "zod";
import {
  BEAT_ROLES,
  EVIDENCE_ORIGINS,
  SOURCING,
  STORYBOARD_FORMATS,
  CONTINUITY_BINDINGS,
} from "./types";

const text = z.string().trim().min(1);
export const storyboardSchema = z.object({
  id: text,
  conceptId: text.optional(),
  subjectHandles: z.array(text).min(1).max(6).optional(),
  needAssessments: z.array(z.object({ needId: text, met: z.boolean(), sourceRefs: z.array(text), reason: text })).max(20).optional(),
  format: z.enum(STORYBOARD_FORMATS),
  premise: text,
  payoff: text,
  beats: z
    .array(
      z.object({
        id: text,
        role: z.enum(BEAT_ROLES),
        assertion: text,
        transition: z.object({ change: text, why: text, patternRefs: z.array(text) }).optional(),
        brief: z.object({
          shows: text,
          feels: text,
          avoid: z.array(text).min(1),
          sourcing: z.enum(SOURCING),
          aspect: text.optional(),
          seconds: z.number().finite().positive().optional(),
          asset: z
            .object({ ref: text, use: z.enum(["as-is", "detail-crop", "mockup-input"]) })
            .optional(),
        }),
        copy: z.string().optional(),
        evidence: z
          .array(z.object({ claim: text, origin: z.enum(EVIDENCE_ORIGINS), source: text }))
          .min(1),
      })
    )
    .min(1)
    .max(10),
  continuity: z.array(
    z.object({ what: text, binding: z.enum(CONTINUITY_BINDINGS), ref: text.optional() })
  ),
  caption: z.string().optional(),
  copyFormulaRef: text.optional(),
});

/** Counted support is derived from unique inspected posts, never supplied by a model. */
export const patternSchema = z.discriminatedUnion("basis", [
  z
    .object({
      id: text,
      basis: z.literal("counted"),
      move: text,
      rationale: text,
      exemplars: z
        .array(
          z.object({
            postRef: text,
            fromBeat: z.number().int().nonnegative(),
            toBeat: z.number().int().positive(),
            mediaRefs: z.array(text).min(2),
            observation: text,
          })
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      id: text,
      basis: z.enum(["researched", "brand-derived"]),
      move: text,
      rationale: text,
      sources: z.array(text).min(1),
    })
    .strict(),
]);

export const planningContextSchema = z.object({
  brand: z.object({ source: text, content: text.max(60000) }),
  facts: z.array(z.object({ source: text, content: text })).max(40),
  patterns: z.array(patternSchema).max(6),
  priorPosts: z.array(z.object({ source: text, premise: text, moves: z.array(text) })).max(12),
  assets: z
    .array(
      z.object({
        ref: text,
        kind: z.enum(["bare-artwork", "framed-render", "photograph", "unknown"]),
        verifiedBy: text.optional(),
      })
    )
    .max(40),
  copyFormulas: z.array(z.object({ id: text, source: text, definition: text.max(12000) }).strict()).max(20).optional(),
  concept: z.object({
    id: text, source: text, premise: text, payoff: text,
    needs: z.array(z.object({ id: text, description: text, required: z.boolean() })).max(20),
    formats: z.array(z.enum(STORYBOARD_FORMATS)).min(1),
    voice: z.object({ copyFormulaRefs: z.array(text).max(20).optional(), hook: text.max(12000).optional() }).optional(),
  }).optional(),
  subjects: z.array(z.object({ handle: text, assetRef: text, sourceRefs: z.array(text).min(2) })).max(6).optional(),
});
export type PlanningContext = z.infer<typeof planningContextSchema>;

/** Copy rules are acquired creative definitions, never counted performance evidence. */
export function copyFormulaProblems(context: PlanningContext): string[] {
  const problems: string[] = [];
  const formulas = context.copyFormulas ?? [];
  const sources = new Set([context.brand.source, ...context.facts.map((fact) => fact.source)]);
  if (new Set(formulas.map((formula) => formula.id)).size !== formulas.length)
    problems.push("Copy formula definitions contain duplicate IDs");
  for (const formula of formulas) {
    if (!formula.definition?.trim()) problems.push(`Copy formula '${formula.id}' has no acquired definition`);
    if (!sources.has(formula.source)) problems.push(`Copy formula '${formula.id}' cites an unavailable definition source`);
  }
  const configured = context.concept?.voice?.copyFormulaRefs ?? [];
  const conceptFact = context.concept && context.facts.find((fact) => fact.source === context.concept!.source);
  if (conceptFact) {
    let acquired: unknown;
    try { acquired = JSON.parse(conceptFact.content); } catch { /* A generic fact need not be a concept JSON document. */ }
    if (acquired && typeof acquired === "object" && !Array.isArray(acquired)) {
      const voice = (acquired as { voice?: { copyFormulaRefs?: unknown } }).voice;
      const refs = voice?.copyFormulaRefs;
      if (Array.isArray(refs) && refs.length &&
          (refs.length !== configured.length || refs.some((ref) => typeof ref !== "string" || !configured.includes(ref)))) {
        problems.push("Concept voice was not compiled; replan with acquired definitions");
      }
    }
  }
  if (new Set(configured).size !== configured.length) problems.push("Content concept voice contains duplicate copy formula references");
  for (const ref of configured)
    if (!formulas.some((formula) => formula.id === ref && formula.definition?.trim() && sources.has(formula.source)))
      problems.push(`Content concept requires an unavailable copy formula definition: ${ref}`);
  return problems;
}
export type NarrativePattern = z.infer<typeof patternSchema>;

export const verdictSchema = z.object({
  kill: z.boolean(),
  reason: text,
  score: z.number().finite().min(0).max(1),
  beatId: text.optional(),
  candidateId: text.optional(),
});
export const verdictsSchema = z.object({ verdicts: z.array(verdictSchema).min(1) });
