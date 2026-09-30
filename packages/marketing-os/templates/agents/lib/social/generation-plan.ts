/** Store-owned pilot plan. Validation does not verify file bytes or authorize spending. */
import { createHash } from "node:crypto";
import { z } from "zod";

const token = z.string().trim().min(1).max(1000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({
  sourceRef: token,
  verificationRef: token,
  sourceSha256: digest,
  sourcePath: z.string().min(1),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
}).strict().superRefine((value, ctx) => {
  if (value.sourcePath !== `social/production/sources/${value.sourceSha256}.jpeg.b64`)
    ctx.addIssue({ code: "custom", message: "sourcePath must be content-addressed by sourceSha256" });
});

export const generationPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  postId: token,
  slotId: token,
  recipeId: token,
  mechanic: z.enum(["artwork-loop", "collection-scene"]),
  scene: z.enum(["real-home", "imagined-world"]).optional(),
  sceneComposition: z.literal("single-artwork").optional(),
  sources: z.array(source).min(1).max(20),
  prompt: z.string().trim().min(1).max(20_000),
  caption: z.string().trim().min(1).max(5_000),
  transform: z.object({
    kind: z.literal("contain-pad"),
    width: z.literal(1080),
    height: z.union([z.literal(1920), z.literal(1350)]),
    background: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  }).strict(),
}).strict().superRefine((plan, ctx) => {
  if (plan.mechanic === "artwork-loop" && (plan.sources.length !== 1 || plan.scene || plan.sceneComposition))
    ctx.addIssue({ code: "custom", message: "artwork-loop requires one source and no scene" });
  if (plan.mechanic === "collection-scene" && (plan.sources.length !== (plan.sceneComposition === "single-artwork" ? 1 : 3) || !plan.scene))
    ctx.addIssue({ code: "custom", message: plan.sceneComposition === "single-artwork"
      ? "single-artwork collection-scene requires one source and a scene" : "collection-scene requires three sources and a scene" });
  if (plan.transform.height !== (plan.mechanic === "artwork-loop" ? 1920 : 1350))
    ctx.addIssue({ code: "custom", message: "transform height must match the recipe canvas" });
  const refs = new Set(plan.sources.map((item) => item.sourceRef));
  if (refs.size !== plan.sources.length)
    ctx.addIssue({ code: "custom", message: "sourceRef values must be distinct" });
  if (plan.mechanic === "collection-scene") {
    if (new Set(plan.sources.map((item) => item.sourceSha256)).size !== plan.sources.length)
      ctx.addIssue({ code: "custom", message: "collection-scene source hashes must be distinct" });
    if (new Set(plan.sources.map((item) => item.verificationRef)).size !== plan.sources.length)
      ctx.addIssue({ code: "custom", message: "collection-scene verification receipts must be distinct" });
  }
});

export type GenerationPlan = z.infer<typeof generationPlanSchema>;

/** Binds the prompt, caption and fitting direction in a GenerationRequest. */
export function generationPlanCreativeHash(plan: GenerationPlan): string {
  const parsed = generationPlanSchema.parse(plan);
  return createHash("sha256").update(JSON.stringify({
    mechanic: parsed.mechanic, scene: parsed.scene ?? null,
    ...(parsed.sceneComposition ? { sceneComposition: parsed.sceneComposition } : {}),
    prompt: parsed.prompt, caption: parsed.caption, transform: parsed.transform,
  })).digest("hex");
}
