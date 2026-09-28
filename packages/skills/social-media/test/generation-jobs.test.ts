import { describe, expect, it } from "vitest";
import {
  approveGenerationJob, assertGenerationJob, beginGenerationSubmission,
  generationApprovalMaterialHash, generationRequestHash, planGenerationJob,
  quoteGenerationJob, recordGenerationFailed, recordGenerationSubmitted,
  recordGenerationSucceeded, recordGenerationUnknown,
  type GenerationRequest,
} from "../src/generation-jobs";

const t0 = "2026-09-28T12:00:00Z";
const t1 = "2026-09-28T12:01:00Z";
const expiry = "2026-09-28T12:10:00Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

const request: GenerationRequest = {
  tenantId: "tenant-1", postId: "post-1", slotId: "2026-10-instagram-01", recipeId: "artwork-loop",
  sources: [{ sourceRef: "ams://work/1/flat", sourceSha256: hashA, preparedSha256: hashB }],
  creativeSha256: hashB, provider: "higgsfield", model: "kling3_0", modelVersion: "3.0",
  settings: { duration: 5, resolution: "standard", audio: false },
};

function quoted() {
  const planned = planGenerationJob("job-1", request, hashA, 10, t0);
  const exact = { ...request, sources: request.sources.map((source) => ({ ...source, providerMediaId: "media-123" })) };
  return quoteGenerationJob(planned, exact, {
    requestHash: generationRequestHash(exact), estimatedCredits: 7.5, maximumCredits: 10,
    expiresAt: expiry, providerQuoteId: "cost-check-1",
  }, t1);
}

function approved() {
  const job = quoted();
  return approveGenerationJob(job, {
    actionId: "social.generation_submit", approvalId: "decision-1",
    previewHash: generationApprovalMaterialHash(job), quoteHash: job.quote!.quoteHash,
    approvedAt: t1,
  }, t1);
}

describe("governed generation job", () => {
  it("binds exact source bytes, provider media id, creative and settings independent of key order", () => {
    expect(generationRequestHash(request)).toBe(generationRequestHash({ ...request,
      settings: { audio: false, resolution: "standard", duration: 5 } }));
    for (const changed of [
      { ...request, sources: [{ ...request.sources[0]!, sourceSha256: hashB }] },
      { ...request, sources: [{ ...request.sources[0]!, preparedSha256: hashA }] },
      { ...request, creativeSha256: hashA },
      { ...request, settings: { ...request.settings, duration: 10 } },
    ]) expect(generationRequestHash(changed)).not.toBe(generationRequestHash(request));
    expect(() => planGenerationJob("job-1", { ...request, settings: { seed: undefined } }, hashA, 10, t0)).toThrow();
  });

  it("rejects mismatched or expired quotes and Action approvals", () => {
    const planned = planGenerationJob("job-1", request, hashA, 10, t0);
    const exact = { ...request, sources: request.sources.map((source) => ({ ...source, providerMediaId: "media-123" })) };
    expect(() => quoteGenerationJob(planned, exact, { requestHash: hashA, estimatedCredits: 7.5,
      maximumCredits: 10, expiresAt: expiry }, t1)).toThrow(/exact request/);
    expect(() => quoteGenerationJob(planned, exact, { requestHash: generationRequestHash(exact), estimatedCredits: 11,
      maximumCredits: 10, expiresAt: expiry }, t1)).toThrow(/maximumCredits/);
    expect(() => quoteGenerationJob(planned, exact, { requestHash: generationRequestHash(exact), estimatedCredits: 7.5,
      maximumCredits: 11, expiresAt: expiry }, t1)).toThrow(/approved credit ceiling/);
    expect(() => quoteGenerationJob(planned, { ...exact, settings: { duration: 10 } }, { requestHash: generationRequestHash(exact),
      estimatedCredits: 7.5, maximumCredits: 10, expiresAt: expiry }, t1)).toThrow(/changed approved/);
    const job = quoted();
    const receipt = { actionId: "social.generation_submit", approvalId: "decision-1",
      previewHash: generationApprovalMaterialHash(job), quoteHash: job.quote!.quoteHash, approvedAt: t1 };
    expect(() => approveGenerationJob(job, { ...receipt, quoteHash: hashA }, t1)).toThrow(/does not match/);
    expect(() => approveGenerationJob(job, receipt, expiry)).toThrow(/expired/);
    expect(() => beginGenerationSubmission(approved(), expiry)).toThrow(/expired/);
  });

  it("persists submitting before the spending call and never permits a second dispatch", () => {
    const dispatching = beginGenerationSubmission(approved(), "2026-09-28T12:02:00Z");
    expect(dispatching).toMatchObject({ phase: "submitting", attempts: 1 });
    expect(() => beginGenerationSubmission(dispatching, t1)).toThrow(/cannot transition/);
    const unknown = recordGenerationUnknown(dispatching, "submit timed out", "2026-09-28T12:03:00Z");
    expect(unknown).toMatchObject({ phase: "unknown", attempts: 1, unknownReason: "submit timed out" });
    expect(() => beginGenerationSubmission(unknown, t1)).toThrow(/cannot transition/);
    expect(() => quoteGenerationJob(unknown, unknown.request, { requestHash: unknown.requestHash,
      estimatedCredits: 7.5, maximumCredits: 10, expiresAt: expiry }, t1)).toThrow(/cannot transition/);
    const reconciled = recordGenerationSubmitted(unknown, "provider-request-1", "2026-09-28T12:04:00Z");
    const completed = recordGenerationSucceeded(reconciled, ["provider-output-1"], "2026-09-28T12:05:00Z");
    expect(completed).toMatchObject({ phase: "succeeded", attempts: 1, providerRequestId: "provider-request-1" });
    expect(() => beginGenerationSubmission(completed, t1)).toThrow(/cannot transition/);
  });

  it("distinguishes definite failure and ambiguous outcome", () => {
    const dispatching = beginGenerationSubmission(approved(), "2026-09-28T12:02:00Z");
    const failed = recordGenerationFailed(dispatching, { code: "rejected", message: "provider rejected" }, t1);
    expect(failed.phase).toBe("failed");
    expect(() => beginGenerationSubmission(failed, t1)).toThrow();
    const unknown = recordGenerationUnknown(dispatching, "connection lost", t1);
    expect(() => recordGenerationSucceeded(unknown, ["output-1"], t1)).toThrow(/request id/);
    const repaired = recordGenerationFailed(unknown, { code: "not_found", message: "confirmed absent" }, t1);
    expect(repaired.phase).toBe("failed");
  });

  it("detects persisted hash tampering before transition", () => {
    const job = quoted();
    expect(() => assertGenerationJob({ ...job, request: { ...job.request, creativeSha256: hashA } })).toThrow(/request hash mismatch/);
    expect(() => assertGenerationJob({ ...job, quote: { ...job.quote, maximumCredits: 99 } })).toThrow(/quote binding mismatch/);
  });
});
