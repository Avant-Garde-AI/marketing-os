import { describe, expect, it } from "vitest";
import { DelegationService } from "../src/delegation/handlers.js";
import { createStubProviders } from "../src/providers/index.js";
import { loadLocalSkillSet } from "../src/skills/index.js";
import { collectingSink, scrubTrace, assertNoLeak, buildTrace } from "../src/trace/index.js";
import type { TaskSpecInput, WorkReport } from "../src/contract.js";

function task(): TaskSpecInput {
  return {
    taskId: "t-trace-1",
    parent: { id: "planner", kind: "claude-code" },
    intent: "tighten the homepage hero hierarchy",
    brandDesignRef: { path: "docs/brand-design.md", version: "1.0.0" },
    brand: { brandId: "arthaus", tokens: { primary: "#111111", bg: "#ffffff" }, principles: ["quiet luxury"] },
    scope: { pages: ["/"], sections: ["hero"], files: [] },
  };
}

function service(opts: { consent: boolean }) {
  const sink = collectingSink();
  const svc = new DelegationService({
    now: () => "2026-06-13T00:00:00Z",
    traceConsent: opts.consent,
    traceSink: sink,
    buildProviders: async () => ({ ...createStubProviders(), skillSet: loadLocalSkillSet() }),
  });
  return { svc, sink };
}

describe("measure-better traces (PRD §6)", () => {
  it("emits a de-identified trace on completion carrying the §6 signals", async () => {
    const { svc, sink } = service({ consent: true });
    await svc.implement(task(), { async: false });

    expect(sink.traces).toHaveLength(1);
    const t = sink.traces[0]!;
    expect(t.taskId).toBe("t-trace-1");
    expect(t.ownerSignal).toBe("pending");
    expect(t.provenance.skillsInvoked.length).toBeGreaterThan(0);
    expect(t.loopHealth.iterations).toBeGreaterThan(0);
    expect(typeof t.conformance.passed).toBe("boolean");
    expect(t.versionVector.skillset).toBe(loadLocalSkillSet().manifest.version);
  });

  it("never leaks brand tokens or brand id into the trace", async () => {
    const { svc, sink } = service({ consent: true });
    await svc.implement(task(), { async: false });
    const json = JSON.stringify(sink.traces[0]);
    expect(json).not.toContain("#111111");
    expect(json).not.toContain("arthaus");
  });

  it("does not emit when consent is off", async () => {
    const { svc, sink } = service({ consent: false });
    await svc.implement(task(), { async: false });
    expect(sink.traces).toHaveLength(0);
  });

  it("records the owner signal and conversion anchor via recordOutcome", async () => {
    const { svc, sink } = service({ consent: true });
    const { taskId } = await svc.implement(task(), { async: false });
    const trace = await svc.recordOutcome(taskId, {
      ownerSignal: "accepted",
      conversionAnchor: { experimentId: "exp-1", metric: "add_to_cart_rate", lift: 0.07 },
    });
    expect(trace?.ownerSignal).toBe("accepted");
    expect(trace?.conversionAnchor?.lift).toBe(0.07);
    expect(sink.traces.at(-1)?.ownerSignal).toBe("accepted");
  });
});

describe("de-id boundary guard", () => {
  const report: WorkReport = {
    contractVersion: "1.0.0",
    taskId: "leaky",
    status: "completed",
    summary: "",
    changes: { commits: [], touchedFiles: [], diffStat: { files: 0, insertions: 0, deletions: 0 } },
    loopHealth: { iterations: 1, maxIterations: 4, escalated: false, firstPassConformance: true },
    gates: {
      darkPattern: { passed: true, hits: [] },
      a11y: { passed: true, violations: [] },
      tokenFidelity: { passed: true, drift: [] },
    },
    unresolved: [],
    recommendations: [],
    subTasks: [],
    provenance: { skillsInvoked: [], patternsInvoked: [] },
    versionVector: { agent: "a", skillset: "s", mcpSnapshot: "m", brandDoc: "secret-brand" },
  };

  it("assertNoLeak throws when a secret appears in the trace", () => {
    const trace = buildTrace(report, { now: () => "2026-06-13T00:00:00Z" });
    expect(() => assertNoLeak(trace, { brandId: "secret-brand" })).toThrow(/de-id boundary/i);
  });

  it("scrubTrace redacts secrets so the guard passes", () => {
    const trace = buildTrace(report, { now: () => "2026-06-13T00:00:00Z" });
    const scrubbed = scrubTrace(trace, { brandId: "secret-brand" });
    expect(JSON.stringify(scrubbed)).not.toContain("secret-brand");
  });
});
