/**
 * LabelRecord: one row of the open dataset (spec 35 §3.2, §4).
 *
 * Carries the three registers for one captured page. Deliberately has NO pixel
 * field. Screenshots stay on the capturing machine and are referenced only by
 * content hash, so the dataset can be redistributed without redistributing
 * third-party storefront imagery.
 */
import { z } from "zod";
import { pageTypeSchema } from "./corpus.js";

export const proposalSchema = z.object({
  axis: z.string().min(1),
  value: z.string().min(1),
  gloss: z.string().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const labelRecordSchema = z.object({
  schema: z.literal("design-craft/label@1").default("design-craft/label@1"),
  brand: z.string().min(1),
  category: z.string().min(1),
  pageType: pageTypeSchema,
  url: z.string().url(),
  viewport: z.enum(["desktop", "mobile"]),
  capturedAt: z.string(),
  /** sha256 of the screenshot the label was made from. Proves provenance without the pixels. */
  captureSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** HARD register: coerced against the admitted vocabulary at label time. */
  facets: z.record(z.string(), z.string().nullable()).default({}),
  /** Facet answers the vocabulary did not admit (kept for review and re-coercion). */
  rejectedFacets: z.array(z.object({ axis: z.string(), value: z.string() })).default([]),
  /** OPEN register. */
  proposals: z.array(proposalSchema).default([]),
  /** PROSE register. Never load-bearing. */
  notes: z.string().optional(),
  labeler: z.object({
    /** `model:<id>` for a VLM, `human:<reviewer>` for a confirmation pass. */
    id: z.string().min(1),
    /** Vocabulary snapshot the label was coerced against (stats hash or version). */
    vocabularyRef: z.string().optional(),
  }),
  /** True when a human confirmed this record. Confirmed proposals observe as `earned`. */
  confirmed: z.boolean().default(false),
});
export type LabelRecord = z.infer<typeof labelRecordSchema>;
