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
 * ## The budget shape is a real, unresolved decision (spec 33 §3.3)
 *
 * This implements per-beat branching: N candidates for each beat, judged
 * independently. The alternative — N whole storyboards, judged end to end —
 * is better at catching an arc that fails as a whole and costs an order of
 * magnitude more. Veo is capped at $2/render by owner instruction, so the
 * choice is not academic. Per-beat is implemented because it is the cheaper
 * thing to have working first, NOT because it is known to be right.
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
  /** Generation calls actually made. */
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
  n: number,
): Promise<BeatOutcome> {
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

  const candidates = await service.explore(beat, n, continuity);
  if (!candidates.length) {
    return { beatId: beat.id, survivors: [], verdicts: [], failure: `${service.name} returned nothing` };
  }

  const verdicts = await critic.critique(beat, candidates);

  // A kill with no candidateId is about the BEAT — "all four are the same
  // picture" belongs to no single candidate and takes all of them.
  const beatKill = verdicts.find((v) => v.kill && !v.candidateId);
  const killedIds = new Set(verdicts.filter((v) => v.kill && v.candidateId).map((v) => v.candidateId!));
  const survivors = beatKill ? [] : rank(candidates.filter((c) => !killedIds.has(c.id)), verdicts);

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
 * Never throws for a single bad beat: one unbuildable beat is information, and
 * failing the batch would hide the beats that DID work. The caller decides
 * whether a partial result is worth composing.
 */
export async function exploreStoryboard(
  storyboard: Storyboard,
  services: ImageryService[],
  critic: VisualCritic,
  options: ExploreOptions,
): Promise<ExploreResult> {
  const n = Math.max(1, options.n);
  if (n === 1) {
    // Not an error — but it is the configuration that produced the output this
    // spec exists to replace, so it should never be the silent default.
    console.warn(
      "[storyboard] exploring with n=1: nothing can be eliminated, so the critic cannot improve the result",
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
    emptyBeats: outcomes.filter((o) => !o.survivors.length).map((o) => o.beatId),
  };
}
