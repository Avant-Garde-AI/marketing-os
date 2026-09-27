import { describe, expect, it } from "vitest";
import { decideOfferExperiment, MIN_IMPRESSIONS, MIN_CAPTURES } from "../src/decision";
import type { OfferArmDecisionInput } from "../src/types";

function arm(overrides: Partial<OfferArmDecisionInput> & { arm: string }): OfferArmDecisionInput {
  return {
    impressions: 0,
    captures: 0,
    captureRate: null,
    ci95: null,
    pBest: null,
    ...overrides,
  };
}

describe("decideOfferExperiment", () => {
  it("returns null when there is no non-control arm", () => {
    expect(decideOfferExperiment([arm({ arm: "control", impressions: 1000 })])).toBeNull();
  });

  it("continues when samples are below threshold", () => {
    const r = decideOfferExperiment([
      arm({ arm: "control" }),
      arm({ arm: "v1", impressions: 50, captures: 2, pBest: 0.5 }),
    ]);
    expect(r?.decision).toBe("continue");
    expect(r?.actionable).toBe(false);
  });

  it("promotes a clear winner once samples and confidence clear the bar", () => {
    const r = decideOfferExperiment([
      arm({ arm: "control" }),
      arm({ arm: "v1", impressions: MIN_IMPRESSIONS, captures: MIN_CAPTURES, pBest: 0.97, captureRate: 0.041 }),
      arm({ arm: "v2", impressions: MIN_IMPRESSIONS, captures: 3, pBest: 0.03 }),
    ]);
    expect(r?.decision).toBe("promote");
    expect(r?.winner).toBe("v1");
    expect(r?.proposedMode).toBe("promote");
    expect(r?.actionable).toBe(true);
  });

  it("recommends reallocate when signal is forming but not conclusive", () => {
    const r = decideOfferExperiment([
      arm({ arm: "control" }),
      arm({ arm: "v1", impressions: MIN_IMPRESSIONS, captures: MIN_CAPTURES, pBest: 0.8 }),
      arm({ arm: "v2", impressions: MIN_IMPRESSIONS, captures: 6, pBest: 0.2 }),
    ]);
    expect(r?.decision).toBe("reallocate");
    expect(r?.proposedMode).toBe("thompson");
    expect(r?.winner).toBeNull();
  });

  it("calls a wash after high N with no separation", () => {
    const r = decideOfferExperiment([
      arm({ arm: "control" }),
      arm({ arm: "v1", impressions: 2500, captures: 40, pBest: 0.55 }),
      arm({ arm: "v2", impressions: 2500, captures: 38, pBest: 0.45 }),
    ]);
    expect(r?.decision).toBe("wash");
    expect(r?.actionable).toBe(false);
    expect(r?.winner).toBeNull();
  });

  it("ignores the control arm when computing minN across shown arms", () => {
    // control has huge N (it's the largest allocation-free baseline in some
    // deployments); shown arms are still under threshold.
    const r = decideOfferExperiment([
      arm({ arm: "control", impressions: 100_000 }),
      arm({ arm: "v1", impressions: 50, captures: 1, pBest: 0.5 }),
    ]);
    expect(r?.decision).toBe("continue");
  });
});
