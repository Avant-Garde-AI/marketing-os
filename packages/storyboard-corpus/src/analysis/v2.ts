import { z } from "zod";

import { postSchema, type AcquiredPost } from "../index";

const text = z.string().trim().min(1);
const observationSchema = z
  .object({
    id: text,
    mediaRef: text,
    ordinal: z.number().int().nonnegative(),
    visible: text,
    treatmentTags: z.array(text),
    textSpans: z.array(z.object({ text, location: text }).strict()),
    uncertainty: text.optional(),
  })
  .strict();
const transitionSchema = z
  .object({
    id: text,
    fromObservationId: text,
    toObservationId: text,
    observableChange: text,
    operation: z.enum([
      "addition",
      "removal",
      "reveal",
      "reframe",
      "repeat",
      "contrast",
      "process",
      "unknown",
    ]),
    uncertainty: text.optional(),
  })
  .strict();

/** Pixel-grounded observations. Captions and engagement are absent from this call. */
export const observationStageSchema = z
  .object({
    observations: z.array(observationSchema).min(1),
    transitions: z.array(transitionSchema),
    limitations: z.array(text),
  })
  .strict();
export type ObservationStage = z.infer<typeof observationStageSchema>;

/** Interpretation refers only to already grounded observation IDs. */
export const annotationStageSchema = z
  .object({
    beats: z
      .array(
        z
          .object({
            id: text,
            supportingObservationIds: z.array(text).min(1),
            function: text,
            informationAdded: text,
            inferredReaderState: text.optional(),
            claimRefs: z.array(text),
          })
          .strict()
      )
      .min(1),
    transitionInterpretations: z.array(
      z
        .object({
          transitionId: text,
          interpretation: text,
          alternativeReading: text.optional(),
        })
        .strict()
    ),
    narrative: z
      .object({
        mechanism: text,
        hook: text.optional(),
        payoff: text.optional(),
        continuity: z.array(text),
        limitations: z.array(text),
      })
      .strict(),
  })
  .strict();
export type AnnotationStage = z.infer<typeof annotationStageSchema>;

export type AnalysisCoverage = {
  visualSamplesCovered: boolean;
  fullVisualStreamCovered: boolean;
  audioCovered: boolean;
  transcriptCovered: boolean;
};

export type AnalysisInput = {
  post: AcquiredPost;
  snapshotRef: string;
  coverage: AnalysisCoverage;
};

/** The pixel pass receives no caption or engagement. */
export type ObservationInput = {
  postId: string;
  format: "single" | "carousel" | "video";
  snapshotRef: string;
  coverage: AnalysisCoverage;
  media: AcquiredPost["media"];
};

/** The interpretation pass receives grounded findings and labeled caption context, never metrics. */
export type AnnotationInput = {
  postId: string;
  format: "single" | "carousel" | "video";
  snapshotRef: string;
  coverage: AnalysisCoverage;
  caption: string;
  observations: ObservationStage;
};

export type StageUsage = {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
};

export type StageResult<T> = { value: T; usage?: StageUsage };

export interface V2Stages {
  model: string;
  observationPromptHash: string;
  annotationPromptHash: string;
  observe(input: ObservationInput): Promise<StageResult<ObservationStage>>;
  annotate(input: AnnotationInput): Promise<StageResult<AnnotationStage>>;
}

export type PostAnalysisV2 = {
  version: "post-analysis-v2";
  postId: string;
  snapshotRef: string;
  inputHash: string;
  mediaCoverage: AnalysisCoverage;
  observations: ObservationStage["observations"];
  transitions: Array<
    ObservationStage["transitions"][number] & AnnotationStage["transitionInterpretations"][number]
  >;
  beats: AnnotationStage["beats"];
  narrative: AnnotationStage["narrative"];
  limitations: string[];
  review: { state: "unreviewed"; reviewRefs: [] };
  provenance: {
    model: string;
    observationPromptHash: string;
    annotationPromptHash: string;
    observationUsage?: StageUsage;
    annotationUsage?: StageUsage;
  };
};

export class AnalysisContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisContractError";
  }
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validateObservations(input: AnalysisInput, output: ObservationStage): ObservationStage {
  const result = observationStageSchema.parse(output);
  const media = input.post.media;
  if (result.observations.length !== media.length)
    throw new AnalysisContractError("every supplied media item needs one observation");
  if (!unique(result.observations.map((item) => item.id)))
    throw new AnalysisContractError("observation IDs must be unique");
  for (const [index, item] of result.observations.entries()) {
    if (item.ordinal !== index || item.mediaRef !== media[index]?.ref)
      throw new AnalysisContractError("observation locator does not match source media order");
  }
  if (result.transitions.length !== Math.max(0, media.length - 1))
    throw new AnalysisContractError("every adjacent media pair needs one observed transition");
  if (!unique(result.transitions.map((item) => item.id)))
    throw new AnalysisContractError("transition IDs must be unique");
  for (const [index, item] of result.transitions.entries()) {
    if (
      item.fromObservationId !== result.observations[index]?.id ||
      item.toObservationId !== result.observations[index + 1]?.id
    )
      throw new AnalysisContractError("transition locator does not match adjacent observations");
  }
  return result;
}

function validateAnnotation(observed: ObservationStage, output: AnnotationStage): AnnotationStage {
  const result = annotationStageSchema.parse(output);
  const observationIds = new Set(observed.observations.map((item) => item.id));
  if (!unique(result.beats.map((beat) => beat.id)))
    throw new AnalysisContractError("beat IDs must be unique");
  for (const beat of result.beats) {
    if (beat.supportingObservationIds.some((id) => !observationIds.has(id)))
      throw new AnalysisContractError("beat support must cite supplied observations");
    if (!unique(beat.supportingObservationIds))
      throw new AnalysisContractError("beat support IDs must be unique");
    if (beat.claimRefs.length)
      throw new AnalysisContractError("claim references require a supplied claim source");
  }
  const expected = observed.transitions.map((transition) => transition.id);
  const actual = result.transitionInterpretations.map((transition) => transition.transitionId);
  if (
    expected.length !== actual.length ||
    !unique(actual) ||
    expected.some((id, index) => id !== actual[index])
  )
    throw new AnalysisContractError(
      "transition interpretation must follow every observed transition"
    );
  return result;
}

export async function analyzePostV2(
  input: AnalysisInput,
  stages: V2Stages
): Promise<PostAnalysisV2> {
  postSchema.parse(input.post.input);
  if (!input.snapshotRef.trim() || !input.post.inputHash.trim())
    throw new AnalysisContractError("snapshot reference and input hash are required");
  if (
    input.post.media.length !== input.post.input.media.length ||
    input.post.media.some(
      (item, index) =>
        item.ref !== input.post.input.media[index]?.ref ||
        item.ordinal !== index ||
        item.kind !== input.post.input.media[index]?.kind ||
        item.sampleTimeSeconds !== input.post.input.media[index]?.sampleTimeSeconds
    )
  )
    throw new AnalysisContractError("attached media must match the ordered post input");
  if (!input.coverage.visualSamplesCovered)
    throw new AnalysisContractError("visual samples are not covered");
  const observedResult = await stages.observe({
    postId: input.post.input.postId,
    format: input.post.input.format,
    snapshotRef: input.snapshotRef,
    coverage: input.coverage,
    media: input.post.media,
  });
  const observed = validateObservations(input, observedResult.value);
  const annotatedResult = await stages.annotate({
    postId: input.post.input.postId,
    format: input.post.input.format,
    snapshotRef: input.snapshotRef,
    coverage: input.coverage,
    caption: input.post.input.caption ?? "",
    observations: observed,
  });
  const annotation = validateAnnotation(observed, annotatedResult.value);
  const limitations = [
    ...observed.limitations,
    ...annotation.narrative.limitations,
    ...(input.post.input.format === "video" && !input.coverage.fullVisualStreamCovered
      ? ["sampled-video-coverage"]
      : []),
    ...(input.post.input.format === "video" && !input.coverage.audioCovered
      ? ["audio-not-covered"]
      : []),
    ...(input.post.input.format === "video" && !input.coverage.transcriptCovered
      ? ["transcript-not-covered"]
      : []),
  ];
  return {
    version: "post-analysis-v2",
    postId: input.post.input.postId,
    snapshotRef: input.snapshotRef,
    inputHash: input.post.inputHash,
    mediaCoverage: input.coverage,
    observations: observed.observations,
    transitions: observed.transitions.map((transition, index) => ({
      ...transition,
      ...annotation.transitionInterpretations[index]!,
    })),
    beats: annotation.beats,
    narrative: annotation.narrative,
    limitations: [...new Set(limitations)],
    review: { state: "unreviewed", reviewRefs: [] },
    provenance: {
      model: stages.model,
      observationPromptHash: stages.observationPromptHash,
      annotationPromptHash: stages.annotationPromptHash,
      observationUsage: observedResult.usage,
      annotationUsage: annotatedResult.usage,
    },
  };
}
