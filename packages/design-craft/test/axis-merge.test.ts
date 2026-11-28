import { describe, expect, it } from "vitest";
import { AXIS_JUDGE_SYSTEM, axisMerge, type AxisJudge, type AxisPair } from "../src/axis-merge.js";
import type { Embedder } from "../src/merge.js";
import { debrand } from "../src/debrand.js";
import { emptyVocabulary, isRecognized, mergeAxes, observe, type Vocabulary } from "../src/vocabulary.js";

/** Places each axis (by name, the text before ':' or '.') at a chosen 2-D angle. */
function fakeEmbedder(angles: Record<string, number>): Embedder {
  return {
    id: "fake-embed",
    async embed(texts) {
      return texts.map((t) => {
        const name = t.split(/[:.]/)[0]!.trim().replace(/ /g, "-");
        const deg = angles[name] ?? 90 + Math.random() * 90;
        return [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
      });
    },
  };
}

function fakeJudge(same: (from: string, into: string) => boolean): AxisJudge & { seen: AxisPair[] } {
  const j = {
    id: "fake-judge",
    seen: [] as AxisPair[],
    async judge(pairs: AxisPair[]) {
      j.seen.push(...pairs);
      return pairs.map((p) => ({ id: p.id, same: same(p.from.key, p.into.key), reason: "test" }));
    },
  };
  return j;
}

function vocab(rows: [axis: string, value: string, brand: string][], seeded: string[] = []): Vocabulary {
  const v = emptyVocabulary();
  for (const [axis, value, brand] of rows) observe(v, { axis, value, brand });
  for (const s of seeded) v.axes[s]!.origin = "seeded";
  return v;
}

describe("axisMerge", () => {
  it("folds synonym emergent axes so they cross the recognition gate, and routes later observations", async () => {
    const v = vocab([
      ["sub-category-navigation", "pill-row-below-header", "a.com"],
      ["sub-category-navigation", "pill-row-below-header", "b.com"],
      ["secondary-nav-treatment", "pill-row-below-header", "c.com"],
    ]);
    expect(isRecognized(v, "sub-category-navigation")).toBe(false);
    const r = await axisMerge(v, {
      embedder: fakeEmbedder({ "sub-category-navigation": 0, "secondary-nav-treatment": 10 }),
      judge: fakeJudge(() => true),
    });
    expect(r.merged).toEqual([expect.objectContaining({ from: "secondary-nav-treatment", into: "sub-category-navigation" })]);
    const ax = v.axes["sub-category-navigation"]!;
    expect(ax.axisSupport.sort()).toEqual(["a.com", "b.com", "c.com"]);
    expect(ax.values["pill-row-below-header"]!.admitted).toBe(true);
    expect(ax.aliases).toEqual(["secondary-nav-treatment"]);
    expect(ax.merges![0]).toMatchObject({ key: "secondary-nav-treatment", method: "semantic", judge: "fake-judge", support: ["c.com"] });
    expect(r.recognized).toEqual([{ axis: "sub-category-navigation", brands: 3 }]);
    expect(v.axes["secondary-nav-treatment"]).toBeUndefined();

    // A replayed or new label under the alias lands on the canonical axis.
    const o = observe(v, { axis: "secondary nav treatment", value: "underlined-text-row", brand: "d.com" });
    expect(o.axis).toBe("sub-category-navigation");
    expect(v.axes["secondary-nav-treatment"]).toBeUndefined();
  });

  it("always folds an emergent axis into a seed, never the reverse, and never pairs two seeds", async () => {
    const v = vocab(
      [
        ["buy-box-structure", "right-column", "a.com"],
        ["cart-surface", "slide-out-drawer", "a.com"],
        ["sticky-buy-behavior", "bottom-bar-on-scroll", "b.com"],
        ["sticky-buy-behavior", "bottom-bar-on-scroll", "c.com"],
        ["sticky-buy-behavior", "bottom-bar-on-scroll", "d.com"],
      ],
      ["buy-box-structure", "cart-surface"],
    );
    const judge = fakeJudge(() => true);
    const r = await axisMerge(v, {
      embedder: fakeEmbedder({ "buy-box-structure": 0, "cart-surface": 1, "sticky-buy-behavior": 5 }),
      judge,
    });
    expect(judge.seen.every((p) => p.from.key === "sticky-buy-behavior")).toBe(true);
    expect(r.merged).toEqual([expect.objectContaining({ from: "sticky-buy-behavior", into: expect.stringMatching(/buy-box-structure|cart-surface/) })]);
    expect(mergeAxes(v, "buy-box-structure", "cart-surface", { method: "semantic" })).toBe(false);
  });

  it("respects rejections and reviewer blocks", async () => {
    const v = vocab([
      ["promotional-overlay", "center-modal", "a.com"],
      ["promotional-drawer-treatment", "side-drawer", "b.com"],
      ["button-treatment", "pill-shaped-outline", "c.com"],
    ]);
    const judge = fakeJudge(() => false);
    const r = await axisMerge(v, {
      embedder: fakeEmbedder({ "promotional-overlay": 0, "promotional-drawer-treatment": 5, "button-treatment": 8 }),
      judge,
      blocked: [{ a: "button-treatment", b: "promotional-overlay" }],
    });
    expect(r.merged).toHaveLength(0);
    expect(judge.seen.some((p) => [p.from.key, p.into.key].sort().join() === "button-treatment,promotional-overlay")).toBe(false);
    expect(r.vetoed).toEqual([expect.objectContaining({ why: "reviewer block" })]);
    expect(Object.keys(v.axes)).toHaveLength(3);
  });

  it("never chains: an axis that absorbed another is not itself moved in the same pass", async () => {
    const v = vocab(
      [
        ["nav-architecture", "split-links", "a.com"],
        ["category-navigation", "underlined-tab-row", "b.com"],
        ["category-navigation", "underlined-tab-row", "c.com"],
        ["subcategory-navigation", "underlined-tab-row", "d.com"],
      ],
      ["nav-architecture"],
    );
    // subcategory→category scores highest; category→nav-architecture is accepted too.
    const r = await axisMerge(v, {
      embedder: fakeEmbedder({ "category-navigation": 0, "subcategory-navigation": 2, "nav-architecture": 20 }),
      judge: fakeJudge(() => true),
      candidateThreshold: 0.9,
    });
    expect(r.merged.map((m) => `${m.from}→${m.into}`)).toContain("subcategory-navigation→category-navigation");
    expect(r.deferred.map((m) => m.from)).toContain("category-navigation");
    expect(v.axes["category-navigation"]).toBeDefined();
  });

  it("dry run judges but changes nothing", async () => {
    const v = vocab([
      ["sub-category-navigation", "pill-row", "a.com"],
      ["subnav-treatment", "pill-row", "b.com"],
    ]);
    const before = JSON.stringify(v);
    const r = await axisMerge(v, { embedder: fakeEmbedder({ "sub-category-navigation": 0, "subnav-treatment": 3 }), judge: fakeJudge(() => true), dryRun: true });
    expect(r.merged).toHaveLength(1);
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe("mergeAxes", () => {
  it("folds a colliding value into the existing one instead of overwriting it", () => {
    const v = vocab([
      ["sticky-cta-behavior", "bottom-bar", "a.com"],
      ["sticky-cta-behavior", "bottom-bar", "b.com"],
      ["sticky-buy-behavior", "bottom-bar", "c.com"],
      ["sticky-buy-behavior", "floating-button", "c.com"],
    ]);
    mergeAxes(v, "sticky-buy-behavior", "sticky-cta-behavior", { method: "semantic" });
    const ax = v.axes["sticky-cta-behavior"]!;
    expect(ax.values["bottom-bar"]!.support.sort()).toEqual(["a.com", "b.com", "c.com"]);
    expect(ax.values["bottom-bar"]!.admitted).toBe(true);
    expect(ax.values["floating-button"]!.support).toEqual(["c.com"]);
  });
});

describe("debrand", () => {
  it("marks seed axes as seeded and carries their question", () => {
    const v = emptyVocabulary();
    debrand(v, [
      {
        schema: "design-craft/label@1", brand: "a.com", category: "apparel", pageType: "home", url: "https://a.com/",
        viewport: "desktop", capturedAt: "2026-11-19T00:00:00Z", captureSha256: "a".repeat(64),
        facets: {}, rejectedFacets: [],
        proposals: [{ axis: "nav-architecture", value: "split-links-center-logo" }, { axis: "button-treatment", value: "pill-outline" }],
        labeler: { id: "model:test", vocabularyRef: "test" }, confirmed: false,
      },
    ]);
    expect(v.axes["nav-architecture"]!.origin).toBe("seeded");
    expect(v.axes["nav-architecture"]!.description).toMatch(/\?$/);
    expect(v.axes["button-treatment"]!.origin).toBe("emergent");
  });
});

describe("axis judge contract", () => {
  it("is directional and says doubt means DIFFERENT", () => {
    expect(AXIS_JUDGE_SYSTEM).toMatch(/every value seen under FROM/);
    expect(AXIS_JUDGE_SYSTEM).toMatch(/When unsure, answer DIFFERENT/);
  });
});
