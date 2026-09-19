/** Vendored from packages/storyboard. Update the canonical source first. */
/**
 * The Storyboard Harness (spec 33).
 *
 * A social post is a story that happens to be a picture. This package owns the
 * story: a typed, renderer-agnostic IR that is reviewable and rejectable before
 * any imagery is generated, plus the explore/critique loop that today's compose
 * path has never had.
 *
 * Planning and model-backed critics return review material before imagery.
 * The runtime binds the model seam to tool-less Mastra agents. Corpus execution
 * and approval-gated imagery dispatch remain integration work (spec 33 §10).
 */

export * from "./types";
export { validateStoryboard, fatalProblems, isBuildable } from "./narrative";
export { exploreBeat, exploreStoryboard } from "./explore";
export type { ExploreOptions, ExploreResult, BeatOutcome } from "./explore";

export * from "./schemas";
export * from "./critics";
export * from "./plan";
