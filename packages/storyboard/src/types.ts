/**
 * The Storyboard IR (spec 33 §2) — what a post MEANS, before anything about how
 * it looks.
 *
 * The central claim of spec 33 is that a social post is a story that happens to
 * be a picture. So the artifact at the centre of the pipeline is an ordered set
 * of narrative beats, reviewable and rejectable before a pixel is generated,
 * and renderer-agnostic by construction.
 *
 * NOTHING in this package may import a renderer. Penpot is today's target and
 * a canvas/Figma exporter is a second implementation of one interface; a single
 * Penpot type leaking in here would make that a rewrite instead of a swap
 * (spec 33 §5).
 */

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

/**
 * A beat's job in the arc.
 *
 * Named roles rather than indices, because "slide 1, slide 2, slide 3" cannot
 * express the thing that makes a carousel worth swiping and cannot be
 * validated. A three-beat sequence of setup → setup → setup is a catalogue;
 * with roles, a validator can say so (spec 33 §2.1).
 *
 * A single image is not exempt. It is a one-beat arc — `payoff` alone, whose
 * setup is implied — and the good ones imply it hard.
 */
export const BEAT_ROLES = ["setup", "tension", "turn", "payoff", "coda"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

/** Where a claim came from. Mirrors the social pack's provenance vocabulary. */
export const EVIDENCE_ORIGINS = ["data", "owner", "artwork", "agent", "brand"] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

export interface Evidence {
  /** What is asserted, in a sentence a human could disagree with. */
  claim: string;
  origin: EvidenceOrigin;
  /** Where it can be checked — a product handle, a metric, a brand.md anchor. */
  source?: string;
}

/**
 * May this beat's imagery be invented?
 *
 * A catalog render can already contain a frame; feeding it to a mockup engine
 * can create a frame inside a frame. A beat that needs a verified master must REFUSE
 * rather than quietly produce nonsense (spec 33 §2.2).
 */
export const SOURCING = ["generated", "store-asset", "either"] as const;
export type Sourcing = (typeof SOURCING)[number];

/**
 * What the picture must be — the instruction a generator actually receives.
 *
 * Structured and mandatory because of the failure this whole spec responds to:
 * `work-detail`'s creative direction ("a close crop — paper texture, a frame
 * edge, the shadow line") lived in a description field nothing read, so a
 * composer filled its rectangle with a whole catalogue render and produced the
 * exact opposite. Creative direction that is not machine-readable at the point
 * of generation is decoration (spec 33 §0.2).
 */
export interface VisualBrief {
  /** Literally in frame. Concrete nouns, not moods. */
  shows: string;
  /** Register, in the store's own vocabulary — brand.md words, not adjectives. */
  feels: string;
  /**
   * What would ruin it. This is where "no wide lens, no low angle — both
   * flatter the size and both are a lie" stops being prose and starts being
   * enforceable.
   */
  avoid: string[];
  sourcing: Sourcing;
  /** Board aspect this beat is composed for, e.g. "4:5", "1:1", "9:16". */
  aspect?: string;
  /** A store image is not necessarily bare art. Usage is checked against the asset inventory. */
  asset?: { ref: string; use: "as-is" | "detail-crop" | "mockup-input" };
  /** Seconds, for a beat that renders as motion rather than a still. */
  seconds?: number;
}

/**
 * A continuity constant — something that must NOT change across beats.
 *
 * `binding` is the whole point. Learned expensively: four individually
 * convincing video frames whose board, surface and light all changed between
 * them read as four unrelated pictures. The model had followed its prompts
 * exactly; the brief was inconsistent with itself.
 *
 * So a constant must name HOW it is held — a reference frame, a fixed asset, a
 * seed — and `prompt-only` is available but is the weakest form and should be
 * treated as a warning, not a solution (spec 33 §2.3).
 */
export const CONTINUITY_BINDINGS = [
  "reference-frame",
  "fixed-asset",
  "seed",
  "prompt-only",
] as const;
export type ContinuityBinding = (typeof CONTINUITY_BINDINGS)[number];

export interface ContinuityConstant {
  /** What is held: "the same sheet", "one fixed overhead camera", "daylight". */
  what: string;
  binding: ContinuityBinding;
  /** The asset/frame/seed that holds it, when the binding needs one. */
  ref?: string;
}

/** One moment in the arc. */
export interface Beat {
  id: string;
  role: BeatRole;
  /**
   * The ONE thing this beat says, in a sentence a human can disagree with.
   * Deliberately not optional: a beat that asserts nothing is decoration, and
   * the validator should be able to find it.
   */
  assertion: string;
  /** What this beat changes from the preceding beat; references are pattern IDs, not invented counts. */
  transition?: { change: string; why: string; patternRefs: string[] };
  brief: VisualBrief;
  /** Copy that appears ON the surface for this beat, if any. */
  copy?: string;
  /** What backs this beat's assertion. Travels with the beat (spec 33 §2.4). */
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------

export const STORYBOARD_FORMATS = ["single", "carousel", "video"] as const;
export type StoryboardFormat = (typeof STORYBOARD_FORMATS)[number];

export interface Storyboard {
  id: string;
  /** The concept this instantiates, when it came from one (spec 29). */
  conceptId?: string;
  /** Exact catalog subjects selected for this option when planning from a graph packet. */
  subjectHandles?: string[];
  /** Explicit content-contract assessment; model proposals remain subject to independent critique and human review. */
  needAssessments?: Array<{ needId: string; met: boolean; sourceRefs: string[]; reason: string }>;
  format: StoryboardFormat;
  /**
   * The arc in one sentence — what a reader takes away. Written BEFORE the
   * beats; if it cannot be written, there is no story to tell yet.
   */
  premise: string;
  /** Why anyone should care. The concept layer's "payoff", carried through. */
  payoff: string;
  beats: Beat[];
  continuity: ContinuityConstant[];
  /** The caption. Governed by the existing claims guard at save time. */
  caption?: string;
  /** brand.md copy formula this instantiates. */
  copyFormulaRef?: string;
}

// ---------------------------------------------------------------------------
// Critique
// ---------------------------------------------------------------------------

/**
 * A critic's finding. `kill` is the decision; `reason` is what makes it usable.
 *
 * Reasons are required on a PASS as well as a fail. A critic that can only say
 * "fine" cannot be distinguished from a stub that always passes — which is the
 * failure mode spec 33 §4 exists to prevent, and which would recreate the
 * original bug with extra steps.
 */
export interface Verdict {
  kill: boolean;
  /** Why. Required in both directions. */
  reason: string;
  /** 0..1, for ranking survivors. Not a quality score; only a comparator. */
  score?: number;
  /** Which beat this concerns, when the finding is local. */
  beatId?: string;
  /**
   * Which candidate this judges. ABSENT means the verdict is about the beat as
   * a whole — "all four are the same picture" is a real and useful finding that
   * belongs to no single candidate, and a kill at that level takes the beat.
   *
   * Without this field a critic could not say which of N it was rejecting, and
   * the loop had to guess. It guessed wrong.
   */
  candidateId?: string;
}

/** Reads a Storyboard. No pixels, no spend — runs before anything is generated. */
export interface NarrativeCritic {
  readonly name: string;
  critique(storyboard: Storyboard): Promise<Verdict[]>;
}

/** A rendered candidate for one beat, awaiting judgement. */
export interface Candidate {
  /** Unique within a beat's exploration; what a Verdict refers to. */
  id: string;
  beatId: string;
  /** Where the rendered image/clip lives. */
  url: string;
  /** How it was made — model, prompt hash, seed. For provenance and for repeat. */
  origin: Record<string, unknown>;
}

/** Reads rendered candidates against the brief that asked for them. */
export interface VisualCritic {
  readonly name: string;
  critique(beat: Beat, candidates: Candidate[]): Promise<Verdict[]>;
}

// ---------------------------------------------------------------------------
// Imagery
// ---------------------------------------------------------------------------

/**
 * The generation seam. Implementations wrap Gemini scenes, Veo, the AMS mockup
 * engine, or a store-asset lookup.
 *
 * `explore` returns MANY. Returning one would reproduce the defect this spec
 * exists to fix: a pipeline that composes a single candidate has no way to
 * prefer a better one (spec 33 §0.3).
 */
export interface ImageryService {
  readonly name: string;
  /** Can this service satisfy the brief at all? Lets a beat refuse early. */
  supports(brief: VisualBrief): boolean;
  explore(beat: Beat, n: number, continuity: ContinuityConstant[]): Promise<Candidate[]>;
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

/**
 * A validation finding. `fatal` separates "this cannot be built" from "this is
 * probably weak" — both are worth saying, and conflating them is how warnings
 * get ignored.
 */
export interface Problem {
  field: string;
  detail: string;
  fatal: boolean;
}
