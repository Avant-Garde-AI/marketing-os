import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  taskSpecSchema,
  workReportSchema,
  type TaskSpecInput,
} from "../src/contract.js";

const minimalTask: TaskSpecInput = {
  taskId: "t-123",
  parent: { id: "claude-code-run-1", kind: "claude-code" },
  intent: "improve the PDP above-the-fold",
  brandDesignRef: { path: "docs/brand-design.md", version: "1.2.0" },
  brand: { brandId: "arthaus" },
};

describe("Design Work Contract", () => {
  it("applies defaults when parsing a minimal TaskSpec", () => {
    const spec = taskSpecSchema.parse(minimalTask);
    expect(spec.contractVersion).toBe(CONTRACT_VERSION);
    expect(spec.constraints.maxIterations).toBe(4);
    expect(spec.guardrails.wcag).toBe("AA");
    expect(spec.guardrails.noDarkPatterns).toBe(true);
    expect(spec.scope.pages).toEqual([]);
  });

  it("rejects a TaskSpec that tries to disable the no-dark-patterns guardrail", () => {
    const bad = { ...minimalTask, guardrails: { wcag: "AA", noDarkPatterns: false } };
    expect(() => taskSpecSchema.parse(bad)).toThrow();
  });

  it("validates a WorkReport round-trip", () => {
    const report = workReportSchema.parse({
      taskId: "t-123",
      status: "completed",
      summary: "done",
      changes: { touchedFiles: ["sections/hero.liquid"] },
      loopHealth: { iterations: 2, maxIterations: 4, escalated: false, firstPassConformance: false },
      gates: {
        darkPattern: { passed: true },
        a11y: { passed: true },
        tokenFidelity: { passed: true },
      },
      versionVector: { agent: "a", skillset: "s", mcpSnapshot: "m", brandDoc: "b" },
    });
    expect(report.status).toBe("completed");
    expect(report.changes.diffStat.files).toBe(0);
    expect(report.provenance.skillsInvoked).toEqual([]);
  });
});
