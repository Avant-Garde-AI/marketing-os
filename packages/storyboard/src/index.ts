/**
 * The Storyboard Harness (spec 33).
 *
 * A social post is a story that happens to be a picture. This package owns the
 * story: a typed, renderer-agnostic IR that is reviewable and rejectable before
 * any imagery is generated, plus the explore/critique loop that today's compose
 * path has never had.
 *
 * SCAFFOLD. The orchestrator (spec 33 §3) and real critics (§4) are
 * deliberately absent — see §6 for what is missing and why shipping a
 * plausible-looking stub would be worse than shipping nothing.
 */

export * from "./types";
export { validateStoryboard, fatalProblems, isBuildable } from "./narrative";
export { exploreBeat, exploreStoryboard } from "./explore";
export type { ExploreOptions, ExploreResult, BeatOutcome } from "./explore";
