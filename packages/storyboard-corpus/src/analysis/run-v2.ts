import { readFile } from "node:fs/promises";

import { assessSnapshot, corpusSnapshotSchema, type CorpusSnapshot } from "../acquire/manifest";
import {
  JsonlLedger,
  sha256,
  type AcquiredMedia,
  type AcquiredPost,
  type LedgerRow,
  type PostInput,
} from "../index";
import {
  analyzePostV2,
  validateObservations,
  type AnalysisInput,
  type ObservationStage,
  type V2Stages,
} from "./v2";

export type V2Candidate = { snapshotRef: string; snapshot: CorpusSnapshot; caption?: string };
export type V2RunOptions = {
  runId: string;
  ledger: JsonlLedger;
  stages: V2Stages;
  maxPosts: number;
  readMedia?: (localPath: string) => Promise<Buffer>;
  now?: () => Date;
};

function safeDiagnostic(error: unknown): LedgerRow["diagnostics"] {
  const raw = (error as { diagnostic?: unknown })?.diagnostic;
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const usage = d.usage && typeof d.usage === "object" ? (d.usage as Record<string, unknown>) : {};
  return {
    provider: "vertex",
    stage: d.stage === "observation" || d.stage === "annotation" ? d.stage : undefined,
    httpStatus: typeof d.httpStatus === "number" ? d.httpStatus : undefined,
    finishReason: typeof d.finishReason === "string" ? d.finishReason : undefined,
    retryable: d.retryable === true,
    schemaPaths: Array.isArray(d.schemaPaths)
      ? d.schemaPaths.filter((value): value is string => typeof value === "string").slice(0, 20)
      : undefined,
    invalidJson: d.invalidJson === true ? true : undefined,
    usage: {
      inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
      outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
      thinkingTokens: typeof usage.thinkingTokens === "number" ? usage.thinkingTokens : undefined,
    },
  };
}

function localInput(snapshot: CorpusSnapshot, caption?: string): PostInput {
  const children = snapshot.media.actual;
  if (!children.length || children.some((child) => child.modality !== "image"))
    throw new Error("v2 local runner currently accepts complete still-image posts only");
  return {
    postId: snapshot.identity.canonicalPostId,
    format: children.length === 1 ? "single" : "carousel",
    caption,
    media: children.map((child) => ({
      ref: child.childId,
      sourceRef: child.sourceRef,
      localPath: child.localPath,
      kind: "image",
      ordinal: child.ordinal,
    })),
  };
}

function requestHash(candidate: V2Candidate, stages: V2Stages): string {
  const snapshot = candidate.snapshot;
  return sha256(
    JSON.stringify({
      version: "post-analysis-v2",
      snapshotRef: candidate.snapshotRef,
      postId: snapshot.identity.canonicalPostId,
      sourcePostId: snapshot.source.postId,
      expected: snapshot.media.expected.map((child) => ({
        childId: child.childId,
        ordinal: child.ordinal,
        modality: child.modality,
        sourceRef: child.sourceRef,
      })),
      actual: snapshot.media.actual.map((child) => ({
        childId: child.childId,
        ordinal: child.ordinal,
        modality: child.modality,
        checksum: child.checksum,
        assetRole: child.assetRole,
      })),
      coverage: {
        visualSamplesCovered: snapshot.coverage.visualSamplesCovered,
        fullVisualStreamCovered: snapshot.coverage.fullVisualStreamCovered,
        audioCovered: snapshot.coverage.audioCovered,
        transcriptCovered: snapshot.coverage.transcriptCovered,
      },
      caption: candidate.caption ?? "",
      model: stages.model,
      observationPromptHash: stages.observationPromptHash,
      annotationPromptHash: stages.annotationPromptHash,
    })
  );
}

function observationHash(candidate: V2Candidate, stages: V2Stages): string {
  const snapshot = candidate.snapshot;
  return sha256(
    JSON.stringify({
      snapshotRef: candidate.snapshotRef,
      postId: snapshot.identity.canonicalPostId,
      model: stages.model,
      observationPromptHash: stages.observationPromptHash,
      expected: snapshot.media.expected.map((child) => ({
        childId: child.childId,
        ordinal: child.ordinal,
        modality: child.modality,
      })),
      media: snapshot.media.actual.map((child) => ({
        childId: child.childId,
        ordinal: child.ordinal,
        modality: child.modality,
        checksum: child.checksum,
        assetRole: child.assetRole,
      })),
      coverage: snapshot.coverage,
    })
  );
}

/** One local writer, explicit post cap, no retries or source URL fetching. */
export async function runV2Extraction(
  candidates: V2Candidate[],
  options: V2RunOptions
): Promise<LedgerRow[]> {
  if (!options.runId.trim()) throw new Error("runId is required");
  if (!Number.isSafeInteger(options.maxPosts) || options.maxPosts < 1)
    throw new Error("maxPosts must be a positive safe integer");
  const selected = candidates.slice(0, options.maxPosts);
  const ids = selected.map((candidate) => candidate.snapshot?.identity?.canonicalPostId);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error("selected snapshots need unique canonical post IDs");
  const readMedia = options.readMedia ?? readFile;
  const now = options.now ?? (() => new Date());
  const rows: LedgerRow[] = [];

  for (const candidate of selected) {
    const postId = candidate.snapshot.identity.canonicalPostId;
    const previous = await options.ledger.latest(options.runId, postId);
    const snapshotDigest = sha256(JSON.stringify(candidate.snapshot));
    const hash = requestHash(candidate, options.stages);
    const obsHash = observationHash(candidate, options.stages);
    const base: LedgerRow = {
      runId: options.runId,
      postId,
      status: "ready",
      inputHash: hash,
      snapshotRef: candidate.snapshotRef,
      snapshotDigest,
      updatedAt: now().toISOString(),
      attempt: (previous?.attempt ?? 0) + 1,
      model: options.stages.model,
      version: "post-analysis-v2",
      promptHash: sha256(
        `${options.stages.observationPromptHash}:${options.stages.annotationPromptHash}`
      ),
    };
    try {
      if (!candidate.snapshotRef.trim()) throw new Error("snapshot reference is required");
      const snapshot = corpusSnapshotSchema.parse(candidate.snapshot);
      const assessment = assessSnapshot(snapshot);
      if (assessment.status !== "ready" || !assessment.complete)
        throw new Error(
          `incomplete: ${assessment.reasons.join(",") || snapshot.reason || "coverage"}`
        );
      if (snapshot.source.postId !== postId)
        throw new Error("snapshot source and canonical identity differ");
      const post = localInput(snapshot, candidate.caption);
      const media: AcquiredMedia[] = [];
      for (const child of snapshot.media.actual) {
        if (!child.localPath || !child.checksum)
          throw new Error(`incomplete: local mirrored media missing for ${child.childId}`);
        let bytes: Buffer;
        try {
          bytes = await readMedia(child.localPath);
        } catch {
          throw new Error(`incomplete: local mirrored media unreadable for ${child.childId}`);
        }
        if (!bytes.length || sha256(bytes) !== child.checksum)
          throw new Error(`checksum mismatch for ${child.childId}`);
        media.push({
          ref: child.childId,
          sourceRef: child.sourceRef,
          ordinal: child.ordinal,
          kind: "image",
          bytes,
          checksum: child.checksum,
        });
      }
      const acquired: AcquiredPost = { input: post, media, inputHash: hash };
      if (
        previous?.status === "extracted" &&
        previous.validated === true &&
        previous.inputHash === hash
      ) {
        rows.push(previous);
        continue;
      }
      const analysisInput: AnalysisInput = {
        post: acquired,
        snapshotRef: candidate.snapshotRef,
        coverage: {
          visualSamplesCovered: snapshot.coverage.visualSamplesCovered,
          fullVisualStreamCovered: snapshot.coverage.fullVisualStreamCovered,
          audioCovered: snapshot.coverage.audioCovered,
          transcriptCovered: snapshot.coverage.transcriptCovered,
        },
      };
      const ledgerRows = await options.ledger.rows();
      await options.ledger.append(base);
      const reusable = [...ledgerRows]
        .reverse()
        .find(
          (row) =>
            row.runId === options.runId &&
            row.postId === postId &&
            row.status === "observed" &&
            row.validated === true &&
            row.observationHash === obsHash &&
            row.observation !== undefined
        );
      let observedResult: { value: ObservationStage; usage?: import("./v2").StageUsage };
      if (reusable) {
        observedResult = {
          value: reusable.observation as ObservationStage,
          usage: reusable.observationUsage,
        };
        validateObservations(analysisInput, observedResult.value);
      } else {
        const response = await options.stages.observe({
          postId,
          format: acquired.input.format,
          snapshotRef: candidate.snapshotRef,
          coverage: analysisInput.coverage,
          media: acquired.media,
        });
        const value = validateObservations(analysisInput, response.value);
        observedResult = { value, usage: response.usage };
        await options.ledger.append({
          ...base,
          status: "observed",
          observationHash: obsHash,
          observation: value,
          observationUsage: response.usage,
          validated: true,
          media: media.map((item) => ({
            ref: item.ref,
            sourceRef: item.sourceRef,
            ordinal: item.ordinal,
            checksum: item.checksum,
          })),
          updatedAt: now().toISOString(),
        });
      }
      const output = await analyzePostV2(analysisInput, options.stages, observedResult);
      const done: LedgerRow = {
        ...base,
        status: "extracted",
        output,
        validated: true,
        media: media.map((item) => ({
          ref: item.ref,
          sourceRef: item.sourceRef,
          ordinal: item.ordinal,
          checksum: item.checksum,
        })),
        updatedAt: now().toISOString(),
      };
      await options.ledger.append(done);
      rows.push(done);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown extraction failure";
      const failed: LedgerRow = {
        ...base,
        status: message.startsWith("incomplete:") ? "incomplete" : "extraction-failed",
        updatedAt: now().toISOString(),
        error: message,
        diagnostics: safeDiagnostic(error),
      };
      await options.ledger.append(failed);
      rows.push(failed);
    }
  }
  return rows;
}
