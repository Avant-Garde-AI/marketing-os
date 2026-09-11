import { describe, expect, it } from "vitest";
import { estimateVideoCost } from "../src/concepts";

describe("estimateVideoCost", () => {
  it("prices PAIRS, not beats — five beats is four renders", () => {
    const beats = Array.from({ length: 5 }, (_, i) => ({ role: `b${i}`, direction: "", seconds: 4 }));
    const e = estimateVideoCost(beats, 0.15);
    expect(e.renders).toBe(4);
    expect(e.seconds).toBe(16);
    expect(e.cost).toBeCloseTo(2.4, 2);
  });

  it("counts beats with no stated duration rather than skipping them", () => {
    // Skipping them would under-report exactly the beats nobody had costed.
    const e = estimateVideoCost(
      [{ role: "a", direction: "" }, { role: "b", direction: "" }],
      0.2,
      6,
    );
    expect(e.seconds).toBe(6);
    expect(e.cost).toBeCloseTo(1.2, 2);
  });

  it("says a single keyframe is not a video", () => {
    const e = estimateVideoCost([{ role: "only", direction: "" }], 0.15);
    expect(e.renders).toBe(0);
    expect(e.cost).toBe(0);
    expect(e.summary).toMatch(/still, not a video/);
  });

  it("reports the arithmetic it used", () => {
    const e = estimateVideoCost(
      [{ role: "a", direction: "", seconds: 3 }, { role: "b", direction: "", seconds: 5 }],
      0.15,
    );
    expect(e.summary).toMatch(/1 render/);
    expect(e.summary).toMatch(/5s of output/);
  });
});
