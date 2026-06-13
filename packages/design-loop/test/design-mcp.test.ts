import { describe, expect, it } from "vitest";
import { DelegationService } from "../src/delegation/handlers.js";
import { createStubProviders, type StubScenario } from "../src/providers/index.js";
import { MockDesignKnowledge } from "../src/design-mcp/mock.js";
import { mockSignedUrlUploader } from "../src/upload.js";
import { assertAbstracted } from "../src/design-mcp/types.js";
import type { TaskSpecInput } from "../src/contract.js";

function task(overrides: Partial<TaskSpecInput> = {}): TaskSpecInput {
  return {
    taskId: "t-mcp-1",
    parent: { id: "planner-1", kind: "claude-code" },
    intent: "tighten the homepage hero hierarchy",
    brandDesignRef: { path: "docs/brand-design.md", version: "2.1.0" },
    brand: { brandId: "arthaus", tokens: { primary: "#111111", bg: "#ffffff" }, principles: ["quiet luxury"] },
    scope: { pages: ["/"], sections: ["hero"], files: [] },
    ...overrides,
  };
}

function mcpService(scenario?: StubScenario) {
  return new DelegationService({
    now: () => "2026-06-13T00:00:00Z",
    buildProviders: async () => ({
      ...createStubProviders(scenario),
      knowledge: new MockDesignKnowledge(),
      uploader: mockSignedUrlUploader(),
    }),
  });
}

describe("Design MCP knowledge (mock)", () => {
  it("returns canned, abstracted knowledge for the 5 tools", async () => {
    const k = new MockDesignKnowledge();
    expect((await k.getCategoryConventions({ taxonomyNode: "Home" })).conventions.length).toBeGreaterThan(0);
    expect((await k.queryDesignPrinciples({ intent: "hero" })).length).toBeGreaterThan(0);
    expect((await k.retrieveReferencePatterns({ intent: "hero", category: "Home" })).length).toBeGreaterThan(0);
    expect((await k.recommendDesignTokens({ brand: { tokens: { primary: "#111111" } } })).colors.primary).toBe("#111111");
  });

  it("assertAbstracted rejects a reference pattern carrying a source asset", () => {
    expect(() =>
      assertAbstracted([{ name: "x", structure: "see https://brand.com/hero.png", approach: "a", whyItWorks: "b" }]),
    ).toThrow(/non-abstracted/i);
  });
});

describe("conformance routed through the Design MCP", () => {
  it("uses the MCP persona read (source=design-mcp) and uploads the bundle by reference", async () => {
    const svc = mcpService();
    const { taskId, status } = await svc.implement(task(), { async: false });
    expect(status).toBe("completed");

    const { report } = svc.getReport(taskId);
    expect(report?.conformance?.source).toBe("design-mcp");
    expect(report?.captureBundleRef?.location.startsWith("gs://")).toBe(true);
  });

  it("local deterministic gates still veto a dark pattern even via the MCP", async () => {
    const svc = mcpService({ injectDarkPattern: true });
    const { taskId, status } = await svc.implement(task(), { async: false });
    expect(status).not.toBe("completed");

    const { report } = svc.getReport(taskId);
    expect(report?.conformance?.source).toBe("design-mcp");
    expect(report?.gates.darkPattern.passed).toBe(false);
    expect(report?.gates.darkPattern.hits.length).toBeGreaterThan(0);
  });
});
