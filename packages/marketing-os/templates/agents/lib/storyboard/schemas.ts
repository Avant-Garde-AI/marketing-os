/** Vendored from packages/storyboard. Update the canonical source first. */
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
});
export type PlanningContext = z.infer<typeof planningContextSchema>;
export type NarrativePattern = z.infer<typeof patternSchema>;

export const verdictSchema = z.object({
  kill: z.boolean(),
  reason: text,
  score: z.number().finite().min(0).max(1),
  beatId: text.optional(),
  candidateId: text.optional(),
});
export const verdictsSchema = z.object({ verdicts: z.array(verdictSchema).min(1) });
