import { describe, expect, it } from "vitest";
import { DelegationService } from "../src/delegation/handlers.js";
import { createStubProviders, type StubScenario } from "../src/providers/index.js";
import type { TaskSpecInput } from "../src/contract.js";

function task(overrides: Partial<TaskSpecInput> = {}): TaskSpecInput {
  return {
    taskId: "t-deleg-1",
    parent: { id: "planner-1", kind: "claude-code" },
    intent: "tighten the hero hierarchy and CTA contrast",
    brandDesignRef: { path: "docs/brand-design.md", version: "1.0.0" },
    brand: {
      brandId: "arthaus",
      tokens: { primary: "#111111", bg: "#ffffff" },
      principles: ["quiet luxury"],
    },
    scope: { pages: ["/", "/collections/all"], sections: ["hero"], files: [] },
    ...overrides,
  };
}

function service(scenario?: StubScenario, now = () => "2026-06-13T00:00:00Z") {
  return new DelegationService({
    now,
    buildProviders: async () => createStubProviders(scenario),
  });
}

describe("DelegationService (Design Work Contract end-to-end)", () => {
  it("runs TaskSpec → deep agent → WorkReport across multiple pages", async () => {
    const svc = service();
    const { taskId, status } = await svc.implement(task(), { async: false });
    expect(status).toBe("completed");

    const { report } = svc.getReport(taskId);
    expect(report).not.toBeNull();
    expect(report?.status).toBe("completed");
    expect(report?.subTasks).toHaveLength(2);
    expect(report?.changes.touchedFiles.length).toBeGreaterThan(0);
    expect(report?.gates.darkPattern.passed).toBe(true);
    expect(report?.versionVector.agent).toBeTruthy();
  });

  it("returns task_id immediately in async mode, then completes on poll", async () => {
    const svc = service();
    const start = await svc.implement(task(), { async: true });
    expect(start.status).toBe("running");
    const envelope = await svc.wait(start.taskId);
    expect(envelope.status).toBe("completed");
    expect(envelope.progress.length).toBeGreaterThan(0);
  });

  it("propagates a guardrail refusal as a rejected WorkReport", async () => {
    const svc = service({ refuseIfIntentMatches: /recreate/i });
    const { taskId, status } = await svc.implement(
      task({ intent: "recreate competitor's homepage hero" }),
      { async: false },
    );
    expect(status).toBe("rejected");
    const { report } = svc.getReport(taskId);
    expect(report?.status).toBe("rejected");
    expect(report?.recommendations.join(" ")).toMatch(/refused/i);
  });

  it("escalates and lists unresolved sub-tasks the planner can replan", async () => {
    const svc = service({ personaCeiling: 0.7 });
    const { taskId, status } = await svc.implement(task(), { async: false });
    expect(status).toBe("escalated");
    const { report } = svc.getReport(taskId);
    expect(report?.loopHealth.escalated).toBe(true);
    expect(report?.unresolved.length).toBeGreaterThan(0);
  });

  it("accepts a revision and re-runs the loop", async () => {
    const svc = service();
    const first = await svc.implement(task(), { async: false });
    const revised = await svc.revise({
      taskId: first.taskId,
      feedback: "increase CTA prominence",
      failedCriteria: ["cta-contrast"],
    });
    expect(revised.taskId).toBe(first.taskId);
    const envelope = await svc.wait(revised.taskId);
    expect(["completed", "escalated"]).toContain(envelope.status);
  });
});
