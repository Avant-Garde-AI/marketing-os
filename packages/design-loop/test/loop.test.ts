import { describe, expect, it } from "vitest";
import { runRefineLoop } from "../src/refine-loop.js";
import { createStubProviders } from "../src/providers/stub.js";
import type { BrandContext } from "../src/types.js";
import type { RefineLoopInput } from "../src/refine-loop.js";

const brand: BrandContext = {
  brandId: "arthaus",
  category: "Home & Garden > Decor",
  tokens: { primary: "#111111", bg: "#ffffff" },
  persona: "design-led collector, values provenance",
  principles: ["lead with craftsmanship", "quiet luxury typography"],
};

function baseInput(overrides: Partial<RefineLoopInput>): RefineLoopInput {
  return {
    taskId: "t1",
    subTask: "/",
    page: "/",
    intent: "tighten the hero hierarchy",
    brand,
    scope: { pages: ["/"], sections: ["hero"], files: [] },
    wcag: "AA",
    maxIterations: 4,
    acceptThreshold: 0.85,
    workspaceDir: "/tmp/ws",
    outDir: "/tmp/out",
    themeRef: "1.0.0",
    versionVector: { agent: "a", skillset: "s", mcpSnapshot: "m", brandDoc: "b" },
    providers: createStubProviders(),
    now: () => "2026-06-13T00:00:00Z",
    ...overrides,
  };
}

describe("runRefineLoop", () => {
  it("converges and accepts within the cap", async () => {
    const result = await runRefineLoop(baseInput({ providers: createStubProviders() }));
    expect(result.accepted).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.iterations).toBeLessThanOrEqual(4);
    expect(result.best?.conformance.passed).toBe(true);
  });

  it("escalates with the best candidate when it cannot reach the threshold", async () => {
    const result = await runRefineLoop(
      baseInput({ providers: createStubProviders({ personaCeiling: 0.7 }) }),
    );
    expect(result.accepted).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.iterations).toBe(4);
    expect(result.best).not.toBeNull();
    expect(result.critique).toBeTruthy();
  });

  it("hard-fails on a dark pattern regardless of persona fit", async () => {
    const result = await runRefineLoop(
      baseInput({ providers: createStubProviders({ personaStart: 0.95, injectDarkPattern: true }) }),
    );
    expect(result.accepted).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.best?.conformance.gates.darkPattern.passed).toBe(false);
    expect(result.best?.conformance.score).toBe(0);
  });

  it("hard-fails on an accessibility violation", async () => {
    const result = await runRefineLoop(
      baseInput({ providers: createStubProviders({ personaStart: 0.95, injectA11y: true }) }),
    );
    expect(result.best?.conformance.gates.a11y.passed).toBe(false);
    expect(result.accepted).toBe(false);
  });

  it("returns rejected when the implementer refuses on asset-boundary grounds", async () => {
    const result = await runRefineLoop(
      baseInput({
        intent: "recreate brand X's hero exactly",
        providers: createStubProviders({ refuseIfIntentMatches: /recreate/i }),
      }),
    );
    expect(result.rejected).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/asset/i);
  });
});
