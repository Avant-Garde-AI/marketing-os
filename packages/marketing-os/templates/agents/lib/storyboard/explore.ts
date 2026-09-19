/** Vendored from packages/storyboard. Update the canonical source first. */
/**
 * Explore → critique → eliminate (spec 33 §4, criterion 5).
 *
 * The loop that has never existed here. Today's compose path produces exactly
 * one candidate and ships it, which is why nothing in the system has ever
 * declined to publish something dull: no component had the job.
 *
 * This module is pure orchestration over the seams in `types.ts`. It holds no
 * opinion about imagery or taste — those arrive as an `ImageryService` and a
 * `VisualCritic` — so the interesting judgement stays swappable and testable
 * with fakes.
 *
 * Planning branches three whole arcs without imagery. Once a human selects an
 * arc, this utility can explore alternatives per beat. It is NOT an approved
 * spend dispatcher: the runtime must enforce reviewed quotes and dollar limits
 * through the existing Action gate before invoking imagery (spec 33 §10).
 */

import type {
  Beat,
  Candidate,
  ContinuityConstant,
  ImageryService,
  Storyboard,
  Verdict,
  VisualCritic,
} from "./types";

export interface ExploreOptions {
  /** Candidates per beat. */
  n: number;
  /**
   * Hard ceiling on generation calls for the whole storyboard. Reached means
   * stop, and say so — silently producing fewer candidates than asked for is
   * how a budget cap becomes an invisible quality cap.
   */
  maxCalls?: number;
}

export interface BeatOutcome {
  beatId: string;
  /** Survivors, best first. Empty when every candidate was killed. */
  survivors: Candidate[];
  /** Every verdict, including on the killed — the record of WHY. */
  verdicts: Verdict[];
  /** Set when this beat produced nothing usable. */
  failure?: string;
}

export interface ExploreResult {
  outcomes: BeatOutcome[];
  /** Candidate-generation slots reserved, including failed attempts. Services must honor n. */
  calls: number;
  /** True when a cap stopped the run before every beat was explored. */
  truncated: boolean;
  /** Beats that yielded nothing. A storyboard with any of these cannot compose. */
  emptyBeats: string[];
}

/**
 * Rank survivors. Higher score first; an absent score sorts last, because a
 * critic that declined to rank is weaker evidence than one that did.
 */
function rank(candidates: Candidate[], verdicts: Verdict[]): Candidate[] {
  const scoreFor = (c: Candidate): number => {
    const v = verdicts.find((x) => x.candidateId === c.id);
    // `?? -1` and not `|| -1`: a legitimate score of 0 is not "unscored", and
    // conflating them silently dropped every candidate a critic ranked lowest.
    return v?.score ?? -1;
  };
  return [...candidates].sort((a, b) => scoreFor(b) - scoreFor(a));
}

/**
 * Explore one beat: generate N, critique, keep what survives.
 *
 * A service that cannot satisfy the brief fails the beat immediately rather
 * than generating something off-brief and letting the critic discover it. That
 * is what `ImageryService.supports` is for, and it is the cheap half of the
 * bare-artwork problem: a beat needing `store-asset` sourcing should never
 * reach a generator at all.
 */
export async function exploreBeat(
  beat: Beat,
  services: ImageryService[],
  critic: VisualCritic,
  continuity: ContinuityConstant[],
  n: number
): Promise<BeatOutcome> {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("n must be a positive safe integer");
  const service = services.find((s) => s.supports(beat.brief));
  if (!service) {
    return {
      beatId: beat.id,
      survivors: [],
      verdicts: [],
      failure:
        `no imagery service supports this brief (sourcing "${beat.brief.sourcing}"). ` +
        "Refusing beats generating something off-brief and discovering it later",
    };
  }

  let candidates: Candidate[];
  try {
    candidates = await service.explore(beat, n, continuity);
  } catch (error) {
    return {
      beatId: beat.id,
      survivors: [],
      verdicts: [],
      failure: `Generation failed: ${String(error)}`,
    };
  }
  if (
    candidates.length !== n ||
    new Set(candidates.map((c) => c.id)).size !== candidates.length ||
    candidates.some((c) => !c.id.trim() || !c.url.trim() || c.beatId !== beat.id)
  ) {
    return {
      beatId: beat.id,
      survivors: [],
      verdicts: [],
      failure: "Generator returned an incomplete or invalid candidate batch",
    };
  }
  if (!candidates.length) {
    return {
      beatId: beat.id,
      survivors: [],
      verdicts: [],
      failure: `${service.name} returned nothing`,
    };
  }

  let verdicts: Verdict[];
  try {
    verdicts = await critic.critique(beat, candidates);
  } catch (error) {
    return {
      beatId: beat.id,
      survivors: [],
      verdicts: [],
      failure: `Visual critique failed: ${String(error)}`,
    };
  }
  const malformed = verdicts.some(
    (v) =>
      typeof v.kill !== "boolean" ||
      !v.reason?.trim() ||
      (v.beatId !== undefined && v.beatId !== beat.id) ||
      (v.candidateId !== undefined && !candidates.some((c) => c.id === v.candidateId)) ||
      (v.score !== undefined && (!Number.isFinite(v.score) || v.score < 0 || v.score > 1))
  );
  if (malformed)
    return {
      beatId: beat.id,
      survivors: [],
      verdicts,
      failure: "Visual critic returned an invalid or unexplained judgment",
    };
  // Missing judgment is never implicit approval. Preserve the explicit failure in the trace.
  verdicts = [...verdicts];
  for (const c of candidates) {
    const judgments = verdicts.filter((v) => v.candidateId === c.id);
    if (judgments.length !== 1 && !verdicts.some((v) => v.kill && !v.candidateId)) {
      verdicts.push({
        kill: true,
        reason: "Candidate lacks exactly one explicit visual judgment",
        candidateId: c.id,
        beatId: beat.id,
      });
    }
  }

  // A kill with no candidateId is about the BEAT — "all four are the same
  // picture" belongs to no single candidate and takes all of them.
  const beatKill = verdicts.find((v) => v.kill && !v.candidateId);
  const killedIds = new Set(
    verdicts.filter((v) => v.kill && v.candidateId).map((v) => v.candidateId!)
  );
  const survivors = beatKill
    ? []
    : rank(
        candidates.filter((c) => !killedIds.has(c.id)),
        verdicts
      );

  const outcome: BeatOutcome = { beatId: beat.id, survivors, verdicts };
  if (!survivors.length) {
    // Empty string is a missing reason, which `??` would happily pass through.
    // A critic that kills silently must still leave the loop something to say.
    const given = (beatKill ?? verdicts.find((v) => v.kill))?.reason?.trim();
    outcome.failure = given || "every candidate was eliminated and no reason was given";
  }
  return outcome;
}

/**
 * Explore a whole storyboard.
 *
 * Catches generator and critic errors for a single bad beat: one unbuildable beat is information, and
 * failing the batch would hide the beats that DID work. The caller decides
 * whether a partial result is worth composing.
 */
export async function exploreStoryboard(
  storyboard: Storyboard,
  services: ImageryService[],
  critic: VisualCritic,
  options: ExploreOptions
): Promise<ExploreResult> {
  const n = options.n;
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("n must be a positive safe integer");
  if (
    options.maxCalls !== undefined &&
    (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 0)
  ) {
    throw new Error("maxCalls must be a nonnegative safe integer");
  }
  if (n === 1) {
    // Not an error — but it is the configuration that produced the output this
    // spec exists to replace, so it should never be the silent default.
    console.warn(
      "[storyboard] exploring with n=1: nothing can be eliminated, so the critic cannot improve the result"
    );
  }

  const outcomes: BeatOutcome[] = [];
  let calls = 0;
  let truncated = false;

  for (const beat of storyboard.beats) {
    if (options.maxCalls !== undefined && calls + n > options.maxCalls) {
      truncated = true;
      break;
    }
    const outcome = await exploreBeat(beat, services, critic, storyboard.continuity ?? [], n);
    calls += n;
    outcomes.push(outcome);
  }

  return {
    outcomes,
    calls,
    truncated,
    emptyBeats: storyboard.beats
      .filter((b) => !outcomes.some((o) => o.beatId === b.id && o.survivors.length))
      .map((b) => b.id),
  };
}
