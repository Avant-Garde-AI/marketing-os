import { describe, expect, it } from "vitest";
import {
  OfferQuotaError,
  createAuditCurrentOfferTool,
  createDesignOfferChallengersTool,
  createGetOfferJobTool,
  offerJobPhase,
  type CreateOfferJobToolsDeps,
} from "../src/tools";
import { instructions } from "../src/instructions";
import type { OfferJobState, OfferPlatformClient } from "../src/types";

function platform(jobs: OfferJobState[], over: Partial<OfferPlatformClient> = {}) {
  const calls = { startAudit: 0, getJob: [] as string[], startDesign: [] as unknown[] };
  const client: OfferPlatformClient = {
    async stageSurface() {
      throw new Error("the harness tools must never stage");
    },
    async getStats() {
      return { surfaces: [] };
    },
    async reallocate() {
      throw new Error("the harness tools must never reallocate");
    },
    async startAudit() {
      calls.startAudit += 1;
      return { jobId: "job_1" };
    },
    async startDesign(goal, constraints) {
      calls.startDesign.push({ goal, constraints });
      return { jobId: "job_2" };
    },
    async getJob(jobId) {
      calls.getJob.push(jobId);
      return jobs.shift() ?? { status: "RUNNING" };
    },
    async latestAudit() {
      return null;
    },
    ...over,
  };
  return { client, calls };
}

function deps(client: OfferPlatformClient, over: Partial<CreateOfferJobToolsDeps> = {}): CreateOfferJobToolsDeps {
  let t = 0;
  return {
    platform: client,
    onUnavailable: (err, what) => ({ unavailable: true, reason: `${what} unavailable: ${err instanceof Error ? err.message : "?"}` }),
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    ...over,
  };
}

describe("offerJobPhase", () => {
  it("normalises orchestrator statuses", () => {
    expect(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "done", "error"].map(offerJobPhase)).toEqual([
      "running",
      "running",
      "succeeded",
      "failed",
      "succeeded",
      "failed",
    ]);
  });
});

describe("audit_current_offer", () => {
  it("starts the audit and returns the report when the job finishes inside the budget", async () => {
    const report = { grade: "C", score: 72 };
    const { client, calls } = platform([{ status: "RUNNING" }, { status: "SUCCEEDED", result: report }]);
    const tool = createAuditCurrentOfferTool(deps(client));
    expect(tool.id).toBe("audit_current_offer");
    const out = await tool.execute({});
    expect(out).toMatchObject({ jobId: "job_1", status: "succeeded", report });
    expect(calls.startAudit).toBe(1);
    expect(calls.getJob).toEqual(["job_1", "job_1"]);
  });

  it("hands back the jobId as still running once the ~50 s budget is spent", async () => {
    const { client, calls } = platform([]);
    const out = await createAuditCurrentOfferTool(deps(client)).execute({});
    expect(out).toMatchObject({ jobId: "job_1", status: "running" });
    expect("note" in out && out.note).toMatch(/get_offer_job/);
    expect(calls.getJob.length).toBeGreaterThan(5);
    expect(calls.getJob.length).toBeLessThanOrEqual(13);
  });

  it("reports a failed job without inventing a grade", async () => {
    const { client } = platform([{ status: "FAILED", error: "storefront password-protected" }]);
    const out = await createAuditCurrentOfferTool(deps(client)).execute({});
    expect(out).toMatchObject({ status: "failed", error: "storefront password-protected" });
    expect("report" in out).toBe(false);
  });

  it("degrades to unavailable when the platform is unreachable", async () => {
    const { client } = platform([], {
      async startAudit() {
        throw new Error("not configured");
      },
    });
    const out = await createAuditCurrentOfferTool(deps(client)).execute({});
    expect(out).toEqual({ unavailable: true, reason: "Offer audit unavailable: not configured" });
  });
});

describe("design_offer_challengers", () => {
  it("enqueues the harness with goal + constraints and says where the result arrives", async () => {
    const { client, calls } = platform([]);
    const tool = createDesignOfferChallengersTool(deps(client));
    const input = tool.inputSchema.parse({
      goal: "grow the list without discounting",
      constraints: { placement: "takeover", incentiveTypes: ["content", "early-access"] },
    });
    const out = await tool.execute(input);
    expect(out).toMatchObject({ jobId: "job_2", status: "queued" });
    expect("note" in out && out.note).toMatch(/approval card in Reviews/);
    expect("note" in out && out.note).toMatch(/Starter/);
    expect(calls.startDesign).toEqual([
      { goal: "grow the list without discounting", constraints: { placement: "takeover", incentiveTypes: ["content", "early-access"] } },
    ]);
  });

  it("explains the free-tier quota honestly", async () => {
    const { client } = platform([], {
      async startDesign() {
        throw new OfferQuotaError("2026-10-20T00:00:00Z");
      },
    });
    const out = await createDesignOfferChallengersTool(deps(client)).execute({ goal: "grow the list" });
    expect(out).toMatchObject({ quota: true, retryAfter: "2026-10-20T00:00:00Z" });
    expect("note" in out && out.note).toMatch(/one challenger design run every 30 days/);
  });

  it("rejects an empty goal", () => {
    const { client } = platform([]);
    expect(createDesignOfferChallengersTool(deps(client)).inputSchema.safeParse({ goal: "" }).success).toBe(false);
  });
});

describe("get_offer_job", () => {
  it("returns the normalised status, progress and result", async () => {
    const { client } = platform([{ status: "RUNNING", progress: { step: "render", done: 3, of: 8 } }]);
    const out = await createGetOfferJobTool(deps(client)).execute({ jobId: "job_2" });
    expect(out).toEqual({ jobId: "job_2", status: "running", progress: { step: "render", done: 3, of: 8 } });
  });
});

describe("instructions", () => {
  it("routes popup work to audit → design and states the plan split", () => {
    expect(instructions).toMatch(/audit_current_offer/);
    expect(instructions).toMatch(/design_offer_challengers/);
    expect(instructions).toMatch(/Never hand-author a multi-step \(v2\) offer/);
    expect(instructions).toMatch(/Free:/);
    expect(instructions).toMatch(/Starter \(\$15\/month\)/);
  });
});
