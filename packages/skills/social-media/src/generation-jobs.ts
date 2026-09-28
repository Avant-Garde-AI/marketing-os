/** Provider-independent, single-submission contract for paid social generation. */
import { createHash } from "node:crypto";
import { z } from "zod";

const name = z.string().trim().min(1).max(300);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const credits = z.number().finite().nonnegative();

/** Original and prepared bytes are distinct; media ID exists only after upload. */
export const generationSourceSchema = z.object({
  sourceRef: name,
  sourceSha256: sha256,
  preparedSha256: sha256,
  providerMediaId: name.optional(),
}).strict();

export const generationRequestSchema = z.object({
  tenantId: name,
  postId: name,
  slotId: name,
  recipeId: name,
  sources: z.array(generationSourceSchema).min(1).max(20),
  creativeSha256: sha256,
  provider: name,
  model: name,
  modelVersion: name,
  /** Exact provider settings, including duration, quality and output count. */
  settings: z.record(z.unknown()).refine((value) => {
    try { return JSON.stringify(value).length <= 16_384; } catch { return false; }
  }, "settings must be JSON and at most 16 KiB"),
}).strict().superRefine((request, ctx) => {
  const refs = new Set<string>();
  for (const source of request.sources) {
    if (refs.has(source.sourceRef)) ctx.addIssue({ code: "custom", message: `duplicate sourceRef: ${source.sourceRef}` });
    refs.add(source.sourceRef);
  }
});
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

/** Quote must come from the provider's cost-only call for the exact request. */
const generationQuoteFields = z.object({
  requestHash: sha256,
  estimatedCredits: credits,
  maximumCredits: credits,
  expiresAt: instant,
  providerQuoteId: name.optional(),
  quoteHash: sha256,
}).strict();
export const generationQuoteSchema = generationQuoteFields.refine((quote) => quote.maximumCredits >= quote.estimatedCredits,
  "maximumCredits must cover estimatedCredits");
export type GenerationQuote = z.infer<typeof generationQuoteSchema>;

/** Receipt from the existing Action gate; this record does not grant authority. */
export const generationGateApprovalSchema = z.object({
  actionId: name,
  approvalId: name,
  previewHash: sha256,
  quoteHash: sha256,
  approvedAt: instant,
}).strict();
export type GenerationGateApproval = z.infer<typeof generationGateApprovalSchema>;

export const generationJobPhaseSchema = z.enum([
  "planned", "quoted", "approved", "submitting", "submitted", "succeeded", "failed", "unknown",
]);
export type GenerationJobPhase = z.infer<typeof generationJobPhaseSchema>;

export const generationJobSchema = z.object({
  id: name,
  request: generationRequestSchema,
  requestHash: sha256,
  /** Hash of the pre-upload request, excluding all provider media IDs. */
  preparationHash: sha256,
  /** Existing Action preview hash, computed by the platform over plan/fit/settings/ceiling. */
  approvalMaterialHash: sha256,
  approvedMaximumCredits: credits,
  phase: generationJobPhaseSchema,
  quote: generationQuoteSchema.optional(),
  gateApproval: generationGateApprovalSchema.optional(),
  /** 0 until dispatch is durably claimed; exactly 1 thereafter. */
  attempts: z.number().int().min(0).max(1),
  submittedAt: instant.optional(),
  providerRequestId: name.optional(),
  outputRefs: z.array(name).min(1).max(20).optional(),
  failure: z.object({ code: name, message: name }).strict().optional(),
  unknownReason: name.optional(),
  updatedAt: instant,
}).strict();
export type GenerationJob = z.infer<typeof generationJobSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) throw new Error(`undefined value in ${key}`);
      return `${JSON.stringify(key)}:${canonical(record[key])}`;
    }).join(",")}}`;
  }
  throw new Error("generation material must contain only JSON values");
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function generationRequestHash(request: GenerationRequest): string {
  return hash(generationRequestSchema.parse(request));
}

function quoteMaterial(quote: Omit<GenerationQuote, "quoteHash">): Omit<GenerationQuote, "quoteHash"> {
  return quote;
}

/** Existing Action preview hash supplied at plan time and verified on execute. */
export function generationApprovalMaterialHash(job: GenerationJob): string {
  assertGenerationJob(job);
  return job.approvalMaterialHash;
}

function withoutMediaIds(request: GenerationRequest): GenerationRequest {
  return { ...request, sources: request.sources.map(({ providerMediaId: _providerMediaId, ...source }) => source) };
}

/** Validate a persisted record before using it for a transition. */
export function assertGenerationJob(value: unknown): asserts value is GenerationJob {
  const job = generationJobSchema.parse(value);
  if (generationRequestHash(job.request) !== job.requestHash) throw new Error("generation request hash mismatch");
  if (generationRequestHash(withoutMediaIds(job.request)) !== job.preparationHash)
    throw new Error("generation preparation hash mismatch");
  if (job.phase === "planned" && job.request.sources.some((source) => source.providerMediaId))
    throw new Error("planned job cannot contain provider media ids");
  if (job.phase !== "planned" && job.request.sources.some((source) => !source.providerMediaId))
    throw new Error("quoted job requires confirmed provider media ids");
  if (job.quote) {
    const { quoteHash, ...material } = job.quote;
    if (job.quote.requestHash !== job.requestHash || hash(quoteMaterial(material)) !== quoteHash)
      throw new Error("generation quote binding mismatch");
  }
  if (job.phase !== "planned" && !job.quote) throw new Error("phase requires a quote");
  if (["approved", "submitting", "submitted", "succeeded", "failed", "unknown"].includes(job.phase)) {
    if (!job.gateApproval || job.gateApproval.quoteHash !== job.quote?.quoteHash ||
      job.gateApproval.previewHash !== job.approvalMaterialHash)
      throw new Error("phase requires a matching Action approval receipt");
  }
  if (["submitting", "submitted", "succeeded", "failed", "unknown"].includes(job.phase) && job.attempts !== 1)
    throw new Error("dispatched phase requires exactly one attempt");
  if (["planned", "quoted", "approved"].includes(job.phase) && job.attempts !== 0)
    throw new Error("pre-dispatch phase cannot have an attempt");
  if (["submitted", "succeeded"].includes(job.phase) && !job.providerRequestId)
    throw new Error("submitted phase requires provider request id");
  if (job.phase === "succeeded" && !job.outputRefs?.length)
    throw new Error("succeeded phase requires output refs");
  if (job.phase === "failed" && !job.failure) throw new Error("failed phase requires failure");
  if (job.phase === "unknown" && !job.unknownReason) throw new Error("unknown phase requires reason");
}

function requirePhase(job: GenerationJob, ...phases: GenerationJobPhase[]): void {
  assertGenerationJob(job);
  if (!phases.includes(job.phase)) throw new Error(`cannot transition ${job.phase}; expected ${phases.join(" or ")}`);
}

function validTime(at: string): number { return Date.parse(instant.parse(at)); }

function next(job: GenerationJob): GenerationJob {
  assertGenerationJob(job);
  return job;
}

export function planGenerationJob(
  id: string, request: GenerationRequest, approvalMaterialHash: string, approvedMaximumCredits: number, at: string,
): GenerationJob {
  const parsed = generationRequestSchema.parse(request);
  if (parsed.sources.some((source) => source.providerMediaId)) throw new Error("planned request cannot contain provider media ids");
  validTime(at);
  const requestHash = generationRequestHash(parsed);
  return next({ id: name.parse(id), request: parsed, requestHash, preparationHash: requestHash,
    approvalMaterialHash: sha256.parse(approvalMaterialHash), approvedMaximumCredits: credits.parse(approvedMaximumCredits),
    phase: "planned", attempts: 0, updatedAt: at });
}

export function quoteGenerationJob(
  job: GenerationJob,
  exactRequest: GenerationRequest,
  quote: Omit<GenerationQuote, "quoteHash">,
  at: string,
): GenerationJob {
  requirePhase(job, "planned");
  const prepared = generationRequestSchema.parse(exactRequest);
  if (prepared.sources.some((source) => !source.providerMediaId)) throw new Error("quote requires confirmed provider media ids");
  if (generationRequestHash(withoutMediaIds(prepared)) !== job.preparationHash)
    throw new Error("exact request changed approved source, creative or settings");
  const exactHash = generationRequestHash(prepared);
  if (quote.requestHash !== exactHash) throw new Error("quote does not match exact request");
  if (validTime(quote.expiresAt) <= validTime(at)) throw new Error("quote has expired");
  const material = generationQuoteFields.omit({ quoteHash: true }).parse(quote);
  if (material.maximumCredits < material.estimatedCredits) throw new Error("maximumCredits must cover estimatedCredits");
  if (material.maximumCredits > job.approvedMaximumCredits) throw new Error("quote exceeds approved credit ceiling");
  return next({ ...job, request: prepared, requestHash: exactHash, phase: "quoted",
    quote: { ...material, quoteHash: hash(material) }, updatedAt: at });
}

/** Call only after the platform gate has verified this exact Action execution. */
export function approveGenerationJob(job: GenerationJob, receipt: GenerationGateApproval, at: string): GenerationJob {
  requirePhase(job, "quoted");
  const approval = generationGateApprovalSchema.parse(receipt);
  if (validTime(job.quote!.expiresAt) <= validTime(at)) throw new Error("quote has expired");
  if (approval.quoteHash !== job.quote!.quoteHash || approval.previewHash !== job.approvalMaterialHash)
    throw new Error("Action approval does not match quote and request");
  if (validTime(approval.approvedAt) > validTime(at)) throw new Error("approval time is in the future");
  return next({ ...job, phase: "approved", gateApproval: approval, updatedAt: at });
}

/** Persist this state atomically before making the provider's spending call. */
export function beginGenerationSubmission(job: GenerationJob, at: string): GenerationJob {
  requirePhase(job, "approved");
  if (validTime(job.quote!.expiresAt) <= validTime(at)) throw new Error("quote has expired");
  return next({ ...job, phase: "submitting", attempts: 1, submittedAt: at, updatedAt: at });
}

/** Record the provider id before any poll. */
export function recordGenerationSubmitted(job: GenerationJob, providerRequestId: string, at: string): GenerationJob {
  requirePhase(job, "submitting", "unknown");
  if (job.providerRequestId && job.providerRequestId !== providerRequestId) throw new Error("provider request id changed");
  const { unknownReason: _unknownReason, ...rest } = job;
  return next({ ...rest, phase: "submitted", providerRequestId: name.parse(providerRequestId), updatedAt: at });
}

export function recordGenerationSucceeded(job: GenerationJob, outputRefs: string[], at: string): GenerationJob {
  requirePhase(job, "submitted", "unknown");
  if (!job.providerRequestId) throw new Error("success requires a reconciled provider request id");
  const { unknownReason: _unknownReason, ...rest } = job;
  return next({ ...rest, phase: "succeeded", outputRefs: z.array(name).min(1).max(20).parse(outputRefs), updatedAt: at });
}

/** Use only for a definite provider failure or a resolved negative reconciliation. */
export function recordGenerationFailed(job: GenerationJob, failure: { code: string; message: string }, at: string): GenerationJob {
  requirePhase(job, "submitting", "submitted", "unknown");
  const { unknownReason: _unknownReason, ...rest } = job;
  return next({ ...rest, phase: "failed", failure: z.object({ code: name, message: name }).strict().parse(failure), updatedAt: at });
}

/** An ambiguous submit/poll is terminal for dispatch; only read-only reconciliation may follow. */
export function recordGenerationUnknown(job: GenerationJob, reason: string, at: string): GenerationJob {
  requirePhase(job, "submitting", "submitted");
  return next({ ...job, phase: "unknown", unknownReason: name.parse(reason), updatedAt: at });
}
