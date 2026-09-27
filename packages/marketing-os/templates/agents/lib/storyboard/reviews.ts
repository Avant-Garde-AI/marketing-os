/** Durable, tenant-scoped planning material. Hashes identify content; they never grant authority. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { planningContextSchema, storyboardSchema, type PlanningContext } from "./schemas";
import { checkGrounding, type StoryReview } from "./plan";
import { fatalProblems, validateStoryboard } from "./narrative";
import type { Storyboard } from "./types";

type Repo = { readFile(path: string): Promise<string | null>; writeFile(path: string, content: string): Promise<void> };
const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const verdictSchema = z.object({ kill: z.boolean(), reason: z.string().min(1), score: z.number().min(0).max(1).optional(), beatId: z.string().optional(), candidateId: z.string().optional() });
const reviewSchema = z.object({ status: z.enum(["awaiting-human-review", "no-survivor"]), reviewHash: hashSchema, options: z.array(z.object({ storyboard: storyboardSchema, verdicts: z.array(verdictSchema).min(1), evidenceStatus: z.enum(["observed", "hypothesis"]), status: z.enum(["eliminated", "reviewable"]) })).length(3), modelCalls: z.number().int().nonnegative(), imageryCalls: z.literal(0), missing: z.array(z.string()) });
const artifactSchema = z.object({ version: z.literal(1), reviewId: idSchema, tenant: z.string().min(1), createdAt: z.string().datetime(), brief: z.string().min(1).max(12000), context: planningContextSchema, contextHash: hashSchema, sources: z.array(z.object({ path: z.string().regex(/^social\/[a-zA-Z0-9_./-]+$/).refine((p) => !p.split("/").includes("..")), hash: hashSchema.nullable() })), review: reviewSchema, reviewHash: hashSchema });
export type DurableStoryboardReview = z.infer<typeof artifactSchema>;
export const storyboardSelectionParamsSchema = z.object({ reviewId: idSchema, reviewHash: hashSchema, storyboardId: z.string().min(1).max(200), affirmSelectedCandidate: z.literal(true), eliminatedStoryboardId: z.string().min(1).max(200), eliminationReason: z.string().trim().min(1).max(12000) }).strict();
export type StoryboardSelectionParams = z.infer<typeof storyboardSelectionParamsSchema>;
const selectionSchema = storyboardSelectionParamsSchema.extend({ version: z.literal(1), tenant: z.string().min(1), selectedAt: z.string().datetime(), storyboardHash: hashSchema, contextHash: hashSchema, selectionHash: hashSchema });
export type StoryboardSelection = z.infer<typeof selectionSchema>;
function selectionParams(s: StoryboardSelection): StoryboardSelectionParams { return { reviewId: s.reviewId, reviewHash: s.reviewHash, storyboardId: s.storyboardId, affirmSelectedCandidate: s.affirmSelectedCandidate, eliminatedStoryboardId: s.eliminatedStoryboardId, eliminationReason: s.eliminationReason }; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function storyboardContentHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function storyboardReviewPath(reviewId: string): string { return `social/storyboards/${idSchema.parse(reviewId)}/review.json`; }
export function storyboardSelectionPath(reviewId: string): string { return `social/storyboards/${idSchema.parse(reviewId)}/selection.json`; }
function reviewMaterial(a: Omit<DurableStoryboardReview, "reviewHash"> | DurableStoryboardReview) { return { version: a.version, reviewId: a.reviewId, tenant: a.tenant, brief: a.brief, context: a.context, contextHash: a.contextHash, sources: a.sources, review: a.review }; }

export async function persistStoryboardReview(input: { repo: Repo; tenant: string; brief: string; context: PlanningContext; review: StoryReview; sources?: Array<{path: string; hash: string | null}> }): Promise<DurableStoryboardReview> {
  const context = planningContextSchema.parse(input.context);
  const material = { version: 1 as const, reviewId: randomUUID(), tenant: input.tenant, createdAt: new Date().toISOString(), brief: input.brief, context, contextHash: storyboardContentHash(context), sources: input.sources ?? [], review: reviewSchema.parse(input.review) };
  const artifact = artifactSchema.parse({ ...material, reviewHash: storyboardContentHash(reviewMaterial(material)) });
  await input.repo.writeFile(storyboardReviewPath(artifact.reviewId), JSON.stringify(artifact, null, 2));
  return artifact;
}
export async function readStoryboardReview(repo: Repo, reviewId: string, expectedHash: string, current: {tenant: string; brand?: string}): Promise<DurableStoryboardReview> {
  const raw = await repo.readFile(storyboardReviewPath(reviewId));
  if (!raw) throw new Error("Storyboard review not found");
  const a = artifactSchema.parse(JSON.parse(raw));
  if (!current.tenant || a.tenant !== current.tenant || a.reviewId !== reviewId) throw new Error("Storyboard review tenant or identity mismatch");
  if (a.reviewHash !== expectedHash || storyboardContentHash(reviewMaterial(a)) !== a.reviewHash || storyboardContentHash(a.context) !== a.contextHash) throw new Error("Storyboard review or context changed; plan and approve again");
  if (current.brand !== undefined && current.brand.trim() !== a.context.brand.content) throw new Error("Brand context changed; plan and approve again");
  for (const source of a.sources) {
    const rawSource = await repo.readFile(source.path);
    if ((rawSource === null ? null : storyboardContentHash(rawSource)) !== source.hash) throw new Error(`Planning source changed: ${source.path}; plan and approve again`);
  }
  if (new Set(a.review.options.map((o) => o.storyboard.id)).size !== a.review.options.length) throw new Error("Duplicate storyboard candidates");
  return a;
}
export function selectedReviewOption(a: DurableStoryboardReview, p: StoryboardSelectionParams) {
  if (a.reviewHash !== p.reviewHash || a.reviewId !== p.reviewId || a.review.status !== "awaiting-human-review") throw new Error("Review is not eligible for selection");
  const option = a.review.options.find((o) => o.storyboard.id === p.storyboardId);
  if (!option || option.status !== "reviewable" || option.verdicts.some((v) => v.kill)) throw new Error("Selected storyboard did not survive independent critique");
  const currentProblems = [
    ...fatalProblems(validateStoryboard(option.storyboard)).map((p) => `${p.field}: ${p.detail}`),
    ...checkGrounding(option.storyboard, a.context).filter((v) => v.kill).map((v) => v.reason),
  ];
  if (currentProblems.length) throw new Error(`Selected storyboard fails current planning validation; plan and approve again: ${currentProblems.join("; ")}`);
  const eliminated = a.review.options.find((o) => o.storyboard.id === p.eliminatedStoryboardId);
  if (!p.affirmSelectedCandidate || !eliminated || eliminated.storyboard.id === option.storyboard.id || eliminated.status !== "eliminated" || !eliminated.verdicts.some((v) => v.kill && v.reason === p.eliminationReason)) throw new Error("Affirm the selected candidate and agree with an exact critic elimination reason for another option");
  return option;
}
/** Called only by the governed Action executor. No model tool exports this mutation. */
export async function persistStoryboardSelection(repo: Repo, a: DurableStoryboardReview, input: StoryboardSelectionParams): Promise<StoryboardSelection> {
  const p = storyboardSelectionParamsSchema.parse(input);
  const option = selectedReviewOption(a, p);
  const material = { ...p, version: 1 as const, tenant: a.tenant, selectedAt: new Date().toISOString(), storyboardHash: storyboardContentHash(option.storyboard), contextHash: a.contextHash };
  const priorRaw = await repo.readFile(storyboardSelectionPath(a.reviewId));
  if (priorRaw) {
    const prior = selectionSchema.parse(JSON.parse(priorRaw));
    const {selectionHash, ...priorMaterial} = prior;
    if (storyboardContentHash(priorMaterial) !== selectionHash) throw new Error("Selected storyboard record changed");
    if (storyboardContentHash(selectionParams(prior)) !== storyboardContentHash(p)) throw new Error("Review already has a different approved selection; create a new review");
    return prior;
  }
  const selection = selectionSchema.parse({ ...material, selectionHash: storyboardContentHash(material) });
  await repo.writeFile(storyboardSelectionPath(a.reviewId), JSON.stringify(selection, null, 2));
  return selection;
}
export async function readSelectedStoryboard(repo: Repo, reviewId: string, expectedReviewHash: string, current: {tenant: string; brand?: string}): Promise<{storyboard: Storyboard; context: PlanningContext; review: DurableStoryboardReview; selection: StoryboardSelection; storyboardHash: string; reviewHash: string}> {
  const review = await readStoryboardReview(repo, reviewId, expectedReviewHash, current);
  const raw = await repo.readFile(storyboardSelectionPath(reviewId));
  if (!raw) throw new Error("Storyboard requires an approved storyboard.select action before realization");
  const selection = selectionSchema.parse(JSON.parse(raw));
  const {selectionHash, ...material} = selection;
  const storyboard = selectedReviewOption(review, selectionParams(selection)).storyboard;
  if (selection.tenant !== current.tenant || selection.reviewId !== reviewId || selection.reviewHash !== expectedReviewHash || selection.contextHash !== review.contextHash || selection.storyboardHash !== storyboardContentHash(storyboard) || selectionHash !== storyboardContentHash(material)) throw new Error("Selected storyboard or planning context changed; plan and approve again");
  return { storyboard, context: review.context, review, selection, storyboardHash: selection.storyboardHash, reviewHash: review.reviewHash };
}
