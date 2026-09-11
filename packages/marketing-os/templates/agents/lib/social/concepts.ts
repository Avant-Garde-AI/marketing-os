/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
/**
 * Post Concepts (spec 29) — the idea layer.
 *
 * A Concept is a standing editorial column, not a template: a premise you run
 * repeatedly with different subjects, interesting because the PREMISE is
 * interesting. It sits above the layout genome — an archetype is a rectangle
 * arrangement, a copy formula is a sentence shape, a pillar is a category, and
 * none of them is an idea. Without this layer every post is invented from
 * scratch, which is how ten posts came to read like one and how captions
 * drifted into describing artworks that were not there: with no premise to be
 * accountable to, the model supplies its own.
 *
 * Concepts are ARTIFACTS, like everything else the agent authors — files in the
 * store repo under `social/concepts/`, served through this pack. There is no
 * concept database; the skill IS the service, and the store keeps its own
 * ideas in its own repo where it can read, diff and revert them.
 *
 * THE TWO LOAD-BEARING FIELDS
 *
 * `payoff` is written in the READER's terms. "Shows our catalogue depth" is a
 * brand's reason to post; "you can tell whether it works in a room like yours"
 * is a reader's reason to stop. A concept that can only state the former is
 * decoration with a schema, and `validateConcept` says so.
 *
 * `needs` is a content contract, and it is what makes "give me five" checkable.
 * If the store cannot satisfy it, the instance is REFUSED with the unmet need
 * named — the same refusal `specFromArchetype` makes for an unfillable
 * archetype, one tier up. This is the structural answer to fabrication: an
 * instance that cannot be grounded is never generated, so there is nothing for
 * a model to paper over.
 */

/**
 * How a concept came to exist. The genome keeps counted / researched /
 * brand-derived apart for a reason and so does this: conflating them lets an
 * idea somebody had in a chat acquire the authority of one distilled from 32
 * exemplars. `n` is meaningful ONLY for `counted`.
 */
export interface ConceptEvidence {
  kind: "counted" | "researched" | "brand-derived";
  /** Exemplars counted. Zero for anything that did not count exemplars. */
  n: number;
}

import {
  frontMatterDocument as document,
  splitFrontMatter,
  validateFrontMatter as validate,
} from "../skill-kit";
import { z } from "zod";

export const CONCEPTS_DIR = "social/concepts/";

/** `social/concepts/<id>.md` */
export function conceptPath(id: string): string {
  return `${CONCEPTS_DIR}${id}.md`;
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/**
 * One clause of the content contract.
 *
 * `description` is prose on purpose (spec 29 D2): a predicate language invented
 * before three real stores exist would encode this store's nouns as if they
 * were universal. The resolver that reads it is per-store; what the platform
 * guarantees is that an unmet need is NAMED rather than silently dropped.
 */
export interface ConceptNeed {
  id: string;
  description: string;
  /** A soft need may go unmet; the instance is still real, just thinner. */
  required?: boolean;
}

/** One frame of a multi-frame expression, with its job in the argument. */
export interface ConceptBeat {
  /** Its role in the argument — "setup", "turn", "payoff", "close". */
  role: string;
  /** Direction for this frame specifically. */
  direction: string;
  /** Which layout archetype this frame composes as, when it is a still. */
  archetypeId?: string;
  /** Seconds, for video beats. */
  seconds?: number;
}

/**
 * Constants held across every frame of a multi-frame expression.
 *
 * Learned the hard way generating a four-stage painting-process sequence: each
 * frame was individually good and the set was unusable, because the board,
 * the surface and the light changed between them. A carousel is ONE argument;
 * if the camera moves between slides the reader reads four unrelated pictures.
 * Per-frame direction cannot express this — it is precisely the thing that must
 * NOT vary — so it lives here and is appended to every frame's instruction.
 */
export type SceneConstants = string[];

export interface SingleExpression {
  archetypeId?: string;
  direction: string;
}

export interface SequenceExpression {
  beats: ConceptBeat[];
  continuity?: SceneConstants;
  /**
   * Whether this store can actually produce this format today. A format that
   * is understood but unavailable (no video model access) is `blocked` with a
   * reason, which is a different and more useful answer than absent.
   */
  availability?: "available" | "blocked";
  availabilityNote?: string;
}

export interface ConceptExpressions {
  single?: SingleExpression;
  carousel?: SequenceExpression;
  video?: SequenceExpression;
}

export type ConceptFormat = keyof ConceptExpressions;

export interface ConceptVoice {
  /** Copy formulas from the genome that suit this idea. */
  copyFormulaRefs?: string[];
  /** The hook shape, in one line. */
  hook?: string;
}

export interface PostConcept {
  id: string;
  name: string;
  /** What the post is about, as a repeatable idea. */
  premise: string;
  /** Why a reader cares, in their terms. */
  payoff: string;
  needs: ConceptNeed[];
  expressions: ConceptExpressions;
  voice?: ConceptVoice;
  /** How often before it stops reading as an idea, e.g. "weekly". */
  cadence?: string;
  /**
   * Counted / researched / brand-derived stay separate here for the same
   * reason they do in the genome: conflating them is how an idea somebody had
   * in a chat acquires the authority of one distilled from 32 exemplars.
   */
  evidence: ConceptEvidence;
  provenance?: string;
  /** Drafts are free; promotion to `active` is the gate (spec 29 D3). */
  status: "draft" | "active" | "retired";
  /** Prose body — the rationale, in the author's own words. */
  body?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConceptProblem {
  field: string;
  detail: string;
  severity: "error" | "warning";
}

/** Brand-side phrasings that signal a payoff written from the wrong chair. */
const BRAND_SIDE = [
  "our catalogue",
  "our catalog",
  "our range",
  "our collection",
  "our brand",
  "drives traffic",
  "drive traffic",
  "boosts engagement",
  "boost engagement",
  "increases sales",
  "increase sales",
  "showcases",
  "showcase our",
  "promotes",
  "brand awareness",
];

/**
 * Check a concept before it is stored.
 *
 * Errors are structural: a concept with no needs cannot be refused, and a
 * concept that cannot be refused will happily instantiate against nothing,
 * which is the failure this whole layer exists to prevent.
 *
 * The `payoff` check is a WARNING, deliberately. It is a heuristic over
 * phrasing, and a heuristic that blocks authoring would train people to write
 * around it rather than to think from the reader's chair.
 */
export function validateConcept(concept: PostConcept): ConceptProblem[] {
  const problems: ConceptProblem[] = [];
  const push = (field: string, detail: string, severity: ConceptProblem["severity"] = "error") =>
    problems.push({ field, detail, severity });

  if (!concept.id.trim()) push("id", "a concept needs an id");
  if (!concept.name.trim()) push("name", "a concept needs a name");
  if (!concept.premise.trim()) push("premise", "a concept needs a premise — what the post is about");
  if (!concept.payoff.trim()) {
    push("payoff", "a concept needs a payoff — why a reader would care, in their terms");
  } else {
    const lower = concept.payoff.toLowerCase();
    const hit = BRAND_SIDE.find((p) => lower.includes(p));
    if (hit) {
      push(
        "payoff",
        `"${hit}" reads as a reason for the BRAND to post, not a reason for a reader to stop. ` +
          `Rewrite the payoff from the reader's chair — what do they get, learn or decide?`,
        "warning",
      );
    }
  }

  if (concept.needs.length === 0) {
    push(
      "needs",
      "a concept with no needs can never be refused, so it will instantiate against nothing — " +
        "state what must exist for an instance to be real",
    );
  }
  const needIds = new Set<string>();
  for (const n of concept.needs) {
    if (!n.id.trim()) push("needs", "every need needs an id");
    else if (needIds.has(n.id)) push("needs", `duplicate need id "${n.id}"`);
    needIds.add(n.id);
    if (!n.description.trim()) push("needs", `need "${n.id}" has no description`);
  }
  if (concept.needs.length > 0 && !concept.needs.some((n) => n.required !== false)) {
    push(
      "needs",
      "every need is optional, which makes the contract unenforceable — at least one must be required",
      "warning",
    );
  }

  const formats = Object.keys(concept.expressions) as ConceptFormat[];
  if (formats.length === 0) push("expressions", "a concept needs at least one format it can take");
  for (const f of ["carousel", "video"] as const) {
    const e = concept.expressions[f];
    if (!e) continue;
    if (e.beats.length < 2) {
      push("expressions", `${f} needs at least two beats — one beat is a single, not a sequence`);
    }
    if (e.availability === "blocked" && !e.availabilityNote?.trim()) {
      push("expressions", `${f} is marked blocked without saying why`, "warning");
    }
    if (!e.continuity?.length) {
      push(
        "expressions",
        `${f} declares no continuity constants. Frames generated independently drift — surface, ` +
          `light and camera change between them and the set reads as unrelated pictures rather ` +
          `than one argument.`,
        "warning",
      );
    }
  }

  if (concept.evidence.n > 0 && concept.evidence.kind !== "counted") {
    push(
      "evidence",
      `n=${concept.evidence.n} on a ${concept.evidence.kind} concept — only a counted concept has exemplars`,
    );
  }

  return problems;
}

/** Throwing form, for callers that have already committed to storing it. */
export function assertConceptValid(concept: PostConcept): void {
  const errors = validateConcept(concept).filter((p) => p.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `concept "${concept.id}" is not storable:\n` + errors.map((e) => `  - ${e.field}: ${e.detail}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// The contract check
// ---------------------------------------------------------------------------

export interface NeedAssessment {
  need: ConceptNeed;
  met: boolean;
  /** Why the resolver decided this, for a reviewable refusal. */
  evidence?: string;
}

export interface SubjectFit {
  /** The store's own id for the candidate subject (a product, artist, set…). */
  subjectId: string;
  assessments: NeedAssessment[];
}

export interface FitVerdict {
  subjectId: string;
  /** Every REQUIRED need met. */
  eligible: boolean;
  unmet: ConceptNeed[];
  /** Soft needs that went unmet — the instance is real but thinner. */
  thin: ConceptNeed[];
}

/**
 * Decide whether a subject can carry this concept.
 *
 * A need the resolver did not assess at all counts as UNMET, never as met.
 * Silence is the most dangerous possible default here: an unassessed need is
 * exactly the case where nobody checked, and treating it as satisfied turns
 * "we could not tell" into "we verified".
 */
export function assessFit(concept: PostConcept, fit: SubjectFit): FitVerdict {
  const byId = new Map(fit.assessments.map((a) => [a.need.id, a]));
  const unmet: ConceptNeed[] = [];
  const thin: ConceptNeed[] = [];
  for (const need of concept.needs) {
    const met = byId.get(need.id)?.met === true;
    if (met) continue;
    if (need.required === false) thin.push(need);
    else unmet.push(need);
  }
  return { subjectId: fit.subjectId, eligible: unmet.length === 0, unmet, thin };
}

export interface SelectionResult {
  /** Subjects that can carry the concept, in the order supplied. */
  chosen: FitVerdict[];
  /** Asked-for minus found. Zero when the request was fully satisfied. */
  shortfall: number;
  /** Why the rejected ones were rejected — the reviewable half. */
  rejected: FitVerdict[];
  /** Sentence-shaped account, for an agent relaying the result. */
  note: string;
}

/**
 * Pick up to `n` subjects that satisfy the concept.
 *
 * Returning fewer than asked, and saying so, is the correct behaviour — this is
 * the function that makes "give me five" safe. Padding the list with subjects
 * that miss a required need is how five grounded posts become three grounded
 * posts and two confident inventions, and nothing downstream can tell which is
 * which.
 */
export function selectSubjects(concept: PostConcept, fits: SubjectFit[], n: number): SelectionResult {
  const verdicts = fits.map((f) => assessFit(concept, f));
  const eligible = verdicts.filter((v) => v.eligible);
  const chosen = eligible.slice(0, Math.max(0, n));
  const rejected = verdicts.filter((v) => !v.eligible);
  const shortfall = Math.max(0, n - chosen.length);

  let note: string;
  if (shortfall === 0) {
    note = `${chosen.length} subject${chosen.length === 1 ? "" : "s"} satisfy "${concept.id}".`;
  } else {
    const reasons = new Map<string, number>();
    for (const r of rejected) for (const u of r.unmet) reasons.set(u.id, (reasons.get(u.id) ?? 0) + 1);
    const why = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${count} missing "${id}"`)
      .join(", ");
    note =
      `Asked for ${n}, found ${chosen.length}. ${rejected.length} candidate` +
      `${rejected.length === 1 ? "" : "s"} did not qualify (${why || "no needs assessed"}). ` +
      `Widen the candidate pool or relax the concept — do NOT fill the gap with unqualified subjects.`;
  }
  return { chosen, shortfall, rejected, note };
}

/**
 * The instruction for one frame: its own direction plus the constants that
 * must not vary across the sequence. Callers hand this to an image or video
 * backend verbatim.
 */
export function beatInstruction(beat: ConceptBeat, continuity: SceneConstants = []): string {
  const constants = continuity.length ? ` Held constant across every frame: ${continuity.join("; ")}.` : "";
  return `${beat.direction}${constants}`;
}

// ---------------------------------------------------------------------------
// Artifact round-trip
//
// Same physical format as every other `social/` artifact: YAML front matter +
// markdown body (artifacts.ts §"Canonical repo paths"). The body is the
// author's rationale in their own words — the part a human actually reads when
// deciding whether an idea is still worth running.
// ---------------------------------------------------------------------------

const beatSchema = z.object({
  role: z.string().min(1),
  direction: z.string().min(1),
  archetypeId: z.string().optional(),
  seconds: z.number().optional(),
});

const sequenceSchema = z.object({
  beats: z.array(beatSchema),
  continuity: z.array(z.string()).optional(),
  availability: z.enum(["available", "blocked"]).optional(),
  availabilityNote: z.string().optional(),
});

const conceptFrontMatterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  premise: z.string().min(1),
  payoff: z.string().min(1),
  needs: z
    .array(z.object({ id: z.string().min(1), description: z.string().min(1), required: z.boolean().optional() }))
    .default([]),
  expressions: z
    .object({
      single: z.object({ archetypeId: z.string().optional(), direction: z.string().min(1) }).optional(),
      carousel: sequenceSchema.optional(),
      video: sequenceSchema.optional(),
    })
    .default({}),
  voice: z
    .object({ copyFormulaRefs: z.array(z.string()).optional(), hook: z.string().optional() })
    .optional(),
  cadence: z.string().optional(),
  evidence: z.object({
    kind: z.enum(["counted", "researched", "brand-derived"]),
    n: z.number().default(0),
  }),
  provenance: z.string().optional(),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
});

export function parseConcept(raw: string, source = `${CONCEPTS_DIR}*.md`): PostConcept {
  const { frontMatter, body } = splitFrontMatter(raw, source);
  const fm = validate(conceptFrontMatterSchema, frontMatter, source);
  const concept: PostConcept = {
    id: fm.id,
    name: fm.name,
    premise: fm.premise,
    payoff: fm.payoff,
    needs: fm.needs ?? [],
    expressions: (fm.expressions ?? {}) as ConceptExpressions,
    evidence: { kind: fm.evidence.kind, n: fm.evidence.n ?? 0 },
    status: fm.status ?? "draft",
    body: body.trim(),
  };
  if (fm.voice !== undefined) concept.voice = fm.voice;
  if (fm.cadence !== undefined) concept.cadence = fm.cadence;
  if (fm.provenance !== undefined) concept.provenance = fm.provenance;
  return concept;
}

export function serializeConcept(concept: PostConcept): string {
  const fm: Record<string, unknown> = {
    id: concept.id,
    name: concept.name,
    premise: concept.premise,
    payoff: concept.payoff,
    needs: concept.needs,
    expressions: concept.expressions,
  };
  if (concept.voice !== undefined) fm.voice = concept.voice;
  if (concept.cadence !== undefined) fm.cadence = concept.cadence;
  fm.evidence = concept.evidence;
  if (concept.provenance !== undefined) fm.provenance = concept.provenance;
  fm.status = concept.status;
  return document(fm, concept.body ?? "");
}
