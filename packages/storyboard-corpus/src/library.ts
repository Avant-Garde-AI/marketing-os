import { createHash } from "node:crypto";
import { z } from "zod";
import { postSchema, type PostInput } from "./index";
import { observationStageSchema, annotationStageSchema, validateObservations, type PostAnalysisV2 } from "./analysis/v2";

const text = z.string().trim().min(1).max(6000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const libraryScopeSchema = z.object({ kind: z.enum(["domain", "tenant"]), id: text }).strict();
export type LibraryScope = z.infer<typeof libraryScopeSchema>;
const locator = z.object({ observationId: text, ordinal: z.number().int().nonnegative(), mediaRef: text, visible: text }).strict();
const exemplar = z.object({
  id: hash, postRef: text, accountRef: text, snapshotRef: text, inputHash: hash, analysisHash: hash,
  transitionId: text, operation: observationStageSchema.shape.transitions.element.shape.operation,
  from: locator, to: locator, observableChange: text, interpretation: text,
  limitations: z.array(text),
}).strict();
export const transitionPatternProposalSchema = z.object({
  version: z.literal("transition-pattern-proposal-v1"), scope: libraryScopeSchema,
  id: text, revision: z.number().int().positive(), move: text, rationale: text,
  exemplars: z.array(exemplar).min(1).max(100),
}).strict();
export type TransitionPatternProposal = z.infer<typeof transitionPatternProposalSchema>;

function digest(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
    return item;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function patternProposalHash(raw: TransitionPatternProposal): string {
  return digest(transitionPatternProposalSchema.parse(raw));
}

/** Propose an abstraction over selected, ordered still transitions. No count or admission is issued. */
export function proposeTransitionPattern(
  definition: Omit<TransitionPatternProposal, "version" | "exemplars">,
  sources: Array<{ input: PostInput; analysis: PostAnalysisV2; accountRef: string; transitionIds: string[] }>
): TransitionPatternProposal {
  const exemplars: TransitionPatternProposal["exemplars"] = [];
  for (const source of sources) {
    const input = postSchema.parse(source.input);
    const analysis = source.analysis;
    if (analysis.version !== "post-analysis-v2" || analysis.postId !== input.postId ||
        !analysis.mediaCoverage.visualSamplesCovered || !analysis.mediaCoverage.fullVisualStreamCovered || input.format !== "carousel")
      throw new Error("Pattern proposals require complete still-carousel v2 sources with matching identity");
    hash.parse(analysis.inputHash);
    text.parse(analysis.snapshotRef);
    text.parse(source.accountRef);
    const observed = validateObservations({
      snapshotRef: analysis.snapshotRef, coverage: analysis.mediaCoverage,
      post: { input, inputHash: analysis.inputHash, media: input.media.map((m) => ({ ...m, bytes: Buffer.alloc(0), checksum: "" })) },
    }, {
      observations: analysis.observations,
      transitions: analysis.transitions.map(({ id, fromObservationId, toObservationId, observableChange, operation, uncertainty }) => ({ id, fromObservationId, toObservationId, observableChange, operation, ...(uncertainty ? { uncertainty } : {}) })),
      limitations: analysis.limitations,
    });
    const annotations = annotationStageSchema.parse({
      beats: analysis.beats, narrative: analysis.narrative,
      transitionInterpretations: analysis.transitions.map(({ transitionId, interpretation, alternativeReading }) => ({ transitionId, interpretation, ...(alternativeReading ? { alternativeReading } : {}) })),
    });
    if (new Set(annotations.beats.map((b) => b.id)).size !== annotations.beats.length ||
        annotations.beats.some((b) => b.claimRefs.length || new Set(b.supportingObservationIds).size !== b.supportingObservationIds.length || b.supportingObservationIds.some((id) => !observed.observations.some((o) => o.id === id))) ||
        analysis.transitions.some((t) => t.id !== t.transitionId)) throw new Error("Analysis interpretation references invalid source identities");
    if (!source.transitionIds.length || new Set(source.transitionIds).size !== source.transitionIds.length) throw new Error("Select unique source transitions");
    for (const id of source.transitionIds) {
      const t = analysis.transitions.find((item) => item.id === id);
      if (!t) throw new Error("Selected transition is absent from source analysis");
      const from = observed.observations.find((o) => o.id === t.fromObservationId)!;
      const to = observed.observations.find((o) => o.id === t.toObservationId)!;
      const analysisHash = digest(analysis);
      exemplars.push({ id: digest({ postId: input.postId, analysisHash, transitionId: id }), postRef: input.postId,
        accountRef: source.accountRef, snapshotRef: analysis.snapshotRef, inputHash: analysis.inputHash, analysisHash,
        transitionId: id, operation: t.operation,
        from: { observationId: from.id, ordinal: from.ordinal, mediaRef: from.mediaRef, visible: from.visible },
        to: { observationId: to.id, ordinal: to.ordinal, mediaRef: to.mediaRef, visible: to.visible },
        observableChange: t.observableChange, interpretation: t.interpretation,
        limitations: [...new Set([...analysis.limitations, ...(t.uncertainty ? [t.uncertainty] : []), ...(t.alternativeReading ? [t.alternativeReading] : [])])],
      });
    }
  }
  const result = transitionPatternProposalSchema.parse({ ...definition, version: "transition-pattern-proposal-v1", exemplars });
  validateProposal(result);
  return result;
}

function validateProposal(proposal: TransitionPatternProposal): void {
  if (new Set(proposal.exemplars.map((e) => e.id)).size !== proposal.exemplars.length) throw new Error("Duplicate exemplar identities");
  const posts = new Map<string, string>();
  for (const e of proposal.exemplars) {
    if (e.to.ordinal !== e.from.ordinal + 1 || e.to.mediaRef === e.from.mediaRef || e.to.observationId === e.from.observationId)
      throw new Error("Transition exemplar must cite distinct adjacent presentation units");
    const prior = posts.get(e.postRef);
    if (prior && prior !== e.accountRef) throw new Error("One post cannot count as multiple source accounts");
    posts.set(e.postRef, e.accountRef);
  }
}

export const patternReviewDecisionSchema = z.object({
  version: z.literal("pattern-review-v1"), proposalHash: hash,
  decision: z.enum(["admit", "reject"]), reviewerRef: text, reviewRef: text, reviewedAt: z.string().datetime(), reason: text,
  exemplars: z.array(z.object({ id: hash, visibleChangeConfirmed: z.boolean(), interpretationConfirmed: z.boolean(), domainFitConfirmed: z.boolean(), reason: text }).strict()).max(100),
}).strict();
export type PatternReviewDecision = z.infer<typeof patternReviewDecisionSchema>;
export interface PatternReviewAuthority {
  /** Bind to an authenticated review record/approved artifact. A hash or reviewer string alone is not authorization. */
  verifyReview(decision: PatternReviewDecision): Promise<boolean>;
}
export interface PlannerTransitionPattern {
  id: string; basis: "counted"; move: string; rationale: string;
  exemplars: Array<{ postRef: string; fromBeat: number; toBeat: number; mediaRefs: string[]; observation: string }>;
}
const verifiedLibraries = new WeakSet<object>();
function freezeDeep(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === "object") freezeDeep(child);
  Object.freeze(value);
}

/** Compile from owned artifacts + verified review authority; never accept a model-supplied library as trusted. */
export async function compileTransitionLibrary(
  scope: LibraryScope,
  proposals: TransitionPatternProposal[],
  decisions: PatternReviewDecision[],
  authority: PatternReviewAuthority
) {
  const selectedScope = libraryScopeSchema.parse(scope);
  if (proposals.length > 100 || decisions.length > 100) throw new Error("Library compile is bounded to 100 proposals/reviews");
  const parsed = proposals.map((p) => transitionPatternProposalSchema.parse(p));
  const reviews = decisions.map((r) => patternReviewDecisionSchema.parse(r));
  const scopeHash = digest(selectedScope);
  if (parsed.some((p) => digest(p.scope) !== scopeHash)) throw new Error("Library proposal scope does not match retrieval scope");
  if (new Set(parsed.map((p) => p.id)).size !== parsed.length) throw new Error("Library requires one selected revision per pattern ID");
  const hashes = new Set(parsed.map(patternProposalHash));
  if (new Set(reviews.map((r) => r.proposalHash)).size !== reviews.length || reviews.some((r) => !hashes.has(r.proposalHash)))
    throw new Error("Review is duplicate, stale or refers to an absent proposal");
  const entries: Array<{ proposal: TransitionPatternProposal; review: PatternReviewDecision; acceptedExemplarIds: string[]; postCount: number; accountCount: number; plannerPattern: PlannerTransitionPattern }> = [];
  const held: Array<{ id: string; reason: string }> = [];
  for (const proposal of parsed) {
    validateProposal(proposal);
    const review = reviews.find((r) => r.proposalHash === patternProposalHash(proposal));
    if (!review) { held.push({ id: proposal.id, reason: "unreviewed" }); continue; }
    if (!(await authority.verifyReview(review))) throw new Error("Pattern review authority could not be verified");
    if (new Set(review.exemplars.map((e) => e.id)).size !== review.exemplars.length || review.exemplars.some((e) => !proposal.exemplars.some((p) => p.id === e.id)))
      throw new Error("Review contains duplicate or foreign exemplar decisions");
    if (review.decision === "reject") { held.push({ id: proposal.id, reason: "review-rejected" }); continue; }
    const accepted = proposal.exemplars.filter((e) => review.exemplars.some((r) => r.id === e.id && r.visibleChangeConfirmed && r.interpretationConfirmed && r.domainFitConfirmed));
    if (!accepted.length) { held.push({ id: proposal.id, reason: "no-reviewed-support" }); continue; }
    entries.push({ proposal, review, acceptedExemplarIds: accepted.map((e) => e.id),
      postCount: new Set(accepted.map((e) => e.postRef)).size, accountCount: new Set(accepted.map((e) => e.accountRef)).size,
      plannerPattern: { id: `${proposal.id}@${proposal.revision}`, basis: "counted", move: proposal.move, rationale: proposal.rationale,
        // Legacy planner field labels: these are source presentation ordinals, not inferred narrative beat counts.
        exemplars: accepted.map((e) => ({ postRef: e.postRef, fromBeat: e.from.ordinal, toBeat: e.to.ordinal,
          mediaRefs: [e.from.mediaRef, e.to.mediaRef], observation: e.observableChange })) },
    });
  }
  const library = { version: "transition-library-v1" as const, scope: selectedScope, revisionHash: digest({ scope: selectedScope, entries, held }), entries, held };
  freezeDeep(library);
  verifiedLibraries.add(library);
  return library;
}

/** Select bounded planner context from a freshly authority-compiled library, with explicit scope and pattern IDs. */
export function retrieveTransitionPatterns(
  library: Awaited<ReturnType<typeof compileTransitionLibrary>>, scope: LibraryScope, ids: string[]
): PlannerTransitionPattern[] {
  if (!verifiedLibraries.has(library)) throw new Error("Recompile library artifacts through verified review authority before retrieval");
  if (digest(library.scope) !== digest(libraryScopeSchema.parse(scope))) throw new Error("Library retrieval scope mismatch");
  if (ids.length > 6 || new Set(ids).size !== ids.length) throw new Error("Select at most six unique pattern IDs");
  return ids.map((id) => {
    const entry = library.entries.find((e) => e.proposal.id === id);
    if (!entry) throw new Error("Selected pattern has no admitted support");
    return entry.plannerPattern;
  });
}
