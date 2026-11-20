import { describe, expect, it } from "vitest";
import { parseVerdicts } from "../src/adapters/openai-text.js";
import { MERGE_JUDGE_SYSTEM, semanticMerge, valueText, type CandidatePair, type Embedder, type MergeJudge } from "../src/merge.js";
import { admittedValues, emptyVocabulary, mergeValues, observe, type Vocabulary } from "../src/vocabulary.js";

/** Embedder that places named values at chosen 2-D angles, so cosine is exact and readable. */
function fakeEmbedder(angles: Record<string, number>): Embedder & { calls: number } {
  const e = {
    id: "fake-embed",
    calls: 0,
    async embed(texts: string[]) {
      e.calls++;
      return texts.map((t) => {
        const label = t.split(": ")[1]!.split(".")[0]!.replace(/ /g, "-");
        const deg = angles[label] ?? 90 + Math.random() * 90;
        return [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
      });
    },
  };
  return e;
}

function fakeJudge(same: (a: string, b: string) => boolean): MergeJudge & { seen: CandidatePair[] } {
  const j = {
    id: "fake-judge",
    seen: [] as CandidatePair[],
    async judge(_axis: string, pairs: CandidatePair[]) {
      j.seen.push(...pairs);
      return pairs.map((p) => ({ id: p.id, same: same(p.a.key, p.b.key), reason: "test" }));
    },
  };
  return j;
}

function vocab(axis: string, values: [string, string[]][]): Vocabulary {
  const v = emptyVocabulary();
  for (const [value, brands] of values) for (const brand of brands) observe(v, { axis, value, brand });
  return v;
}

// cos(5°) ≈ 0.996, cos(20°) ≈ 0.94, cos(40°) ≈ 0.77
describe("semanticMerge", () => {
  it("never sends a vetoed pair to the judge, however similar", async () => {
    const v = vocab("collection grid density", [
      ["two-column-uniform", ["a.com"]],
      ["four-column-uniform", ["b.com"]],
    ]);
    const judge = fakeJudge(() => true);
    const r = await semanticMerge(v, {
      recognizedOnly: false, embedder: fakeEmbedder({ "two-column-uniform": 0, "four-column-uniform": 1 }), judge });
    expect(judge.seen).toHaveLength(0);
    expect(r.vetoed).toHaveLength(1);
    expect(r.merged).toHaveLength(0);
  });

  it("merges judged synonyms, unions support, records provenance, and can promote", async () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com", "b.com"]],
      ["strikethrough-with-value-badge", ["c.com"]],
    ]);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "strikethrough-and-pill-tag": 0, "strikethrough-with-value-badge": 20 }),
      judge: fakeJudge(() => true),
    });
    expect(r.merged).toEqual([expect.objectContaining({ from: "strikethrough-with-value-badge", into: "strikethrough-and-pill-tag" })]);
    const e = v.axes["offer-framing"]!.values["strikethrough-and-pill-tag"]!;
    expect(e.support.sort()).toEqual(["a.com", "b.com", "c.com"]);
    expect(e.aliases).toEqual(["strikethrough-with-value-badge"]);
    expect(e.merges![0]).toMatchObject({ key: "strikethrough-with-value-badge", method: "semantic", judge: "fake-judge", support: ["c.com"] });
    expect(r.promoted).toEqual([{ axis: "offer-framing", key: "strikethrough-and-pill-tag", support: 3 }]);
    expect(admittedValues(v, "offer-framing")).toEqual(["strikethrough-and-pill-tag"]);
  });

  it("does not merge what the judge rejects, or what is below the candidate threshold", async () => {
    const v = vocab("hero composition", [
      ["split-image-and-copy", ["a.com"]],
      ["full-bleed-video-loop", ["b.com"]],
      ["product-on-flat-ground", ["c.com"]],
    ]);
    const judge = fakeJudge(() => false);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "split-image-and-copy": 0, "full-bleed-video-loop": 20, "product-on-flat-ground": 60 }),
      judge,
    });
    expect(judge.seen.map((p) => [p.a.key, p.b.key])).toEqual([["split-image-and-copy", "full-bleed-video-loop"]]);
    expect(r.rejected).toHaveLength(1);
    expect(Object.keys(v.axes["hero-composition"]!.values)).toHaveLength(3);
  });

  it("never chains: A≈B and B≈C do not make A≈C", async () => {
    const v = vocab("announcement bar treatment", [
      ["rotating-text-strip", ["a.com", "b.com"]],
      ["paginated-text-strip", ["c.com"]],
      ["paginated-link-row", ["d.com"]],
    ]);
    // A–B at 5°, B–C at 5°, A–C at 10°: all retrieved, but the judge says A≉C.
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "rotating-text-strip": 0, "paginated-text-strip": 5, "paginated-link-row": 10 }),
      judge: fakeJudge((a, b) => !(new Set([a, b]).has("rotating-text-strip") && new Set([a, b]).has("paginated-link-row"))),
    });
    expect(r.merged.map((m) => m.from)).toEqual(["paginated-text-strip"]);
    expect(r.deferred.map((m) => m.from)).toContain("paginated-link-row");
    expect(Object.keys(v.axes["announcement-bar-treatment"]!.values).sort()).toEqual(["paginated-link-row", "rotating-text-strip"]);
  });

  it("never merges or judges a reviewer-blocked pair", async () => {
    const v = vocab("merchandising entry", [
      ["hero-cta-to-featured-product", ["a.com"]],
      ["hero-cta-to-featured-section", ["b.com"]],
    ]);
    const judge = fakeJudge(() => true);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "hero-cta-to-featured-product": 0, "hero-cta-to-featured-section": 5 }),
      judge,
      blocked: [{ axis: "merchandising-entry", a: "hero-cta-to-featured-section", b: "hero-cta-to-featured-product" }],
    });
    expect(judge.seen).toHaveLength(0);
    expect(r.merged).toHaveLength(0);
  });

  it("survives a failed judge batch and leaves those pairs unmerged", async () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com"]],
      ["strikethrough-with-value-badge", ["b.com"]],
    ]);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "strikethrough-and-pill-tag": 0, "strikethrough-with-value-badge": 5 }),
      judge: { id: "down", judge: async () => { throw new Error("429 quota"); } },
    });
    expect(r.errors).toEqual([{ axis: "offer-framing", pairs: 1, error: "429 quota" }]);
    expect(r.merged).toHaveLength(0);
    expect(Object.keys(v.axes["offer-framing"]!.values)).toHaveLength(2);
  });

  it("skips an axis whose embeddings fail and still merges the others", async () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com"]],
      ["strikethrough-with-value-badge", ["b.com"]],
    ]);
    for (const [value, brand] of [["two-column-uniform", "a.com"], ["two-column-even", "b.com"]]) observe(v, { axis: "collection grid density", value, brand });
    const cache = new Map<string, number[]>([
      ["cached|offer framing: strikethrough and pill tag", [1, 0]],
      ["cached|offer framing: strikethrough with value badge", [Math.cos(0.05), Math.sin(0.05)]],
    ]);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: { id: "cached", embed: async () => { throw new Error("spend cap"); } },
      judge: fakeJudge(() => true),
      cache,
    });
    expect(r.errors).toEqual([{ axis: "collection-grid-density", pairs: 0, error: "embed: spend cap" }]);
    expect(r.merged.map((m) => m.axis)).toEqual(["offer-framing"]);
    expect(Object.keys(v.axes["collection-grid-density"]!.values)).toHaveLength(2);
  });

  it("skips unrecognized axes by default", async () => {
    const v = emptyVocabulary();
    observe(v, { axis: "rare axis", value: "one-two", brand: "a.com" });
    observe(v, { axis: "rare axis", value: "one-two-three", brand: "a.com" });
    const judge = fakeJudge(() => true);
    await semanticMerge(v, { embedder: fakeEmbedder({ "one-two": 0, "one-two-three": 1 }), judge });
    expect(judge.seen).toHaveLength(0);
    await semanticMerge(v, { embedder: fakeEmbedder({ "one-two": 0, "one-two-three": 1 }), judge, recognizedOnly: false });
    expect(judge.seen).toHaveLength(1);
  });

  it("reuses cached verdicts, so a dry run makes the real run free", async () => {
    const mk = () =>
      vocab("offer framing", [
        ["strikethrough-and-pill-tag", ["a.com"]],
        ["strikethrough-with-value-badge", ["b.com"]],
      ]);
    const verdictCache = new Map<string, { same: boolean; reason?: string }>();
    const emb = fakeEmbedder({ "strikethrough-and-pill-tag": 0, "strikethrough-with-value-badge": 5 });
    const judge = fakeJudge(() => true);
    await semanticMerge(mk(), { recognizedOnly: false, embedder: emb, judge, verdictCache, dryRun: true });
    const v = mk();
    const r = await semanticMerge(v, { recognizedOnly: false, embedder: emb, judge, verdictCache });
    expect(judge.seen).toHaveLength(1);
    expect(r.cachedVerdicts).toBe(1);
    expect(r.merged).toHaveLength(1);
  });

  it("dry run judges but changes nothing", async () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com"]],
      ["strikethrough-with-value-badge", ["b.com"]],
    ]);
    const before = JSON.stringify(v);
    const r = await semanticMerge(v, {
      recognizedOnly: false,
      embedder: fakeEmbedder({ "strikethrough-and-pill-tag": 0, "strikethrough-with-value-badge": 5 }),
      judge: fakeJudge(() => true),
      dryRun: true,
    });
    expect(r.merged).toHaveLength(1);
    expect(JSON.stringify(v)).toBe(before);
  });

  it("reuses cached vectors", async () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com"]],
      ["free-ship-threshold-bar", ["b.com"]],
    ]);
    const emb = fakeEmbedder({ "strikethrough-and-pill-tag": 0, "free-ship-threshold-bar": 80 });
    const cache = new Map<string, number[]>();
    await semanticMerge(v, {
      recognizedOnly: false, embedder: emb, judge: fakeJudge(() => false), cache });
    await semanticMerge(v, {
      recognizedOnly: false, embedder: emb, judge: fakeJudge(() => false), cache });
    expect(emb.calls).toBe(1);
  });
});

describe("after a merge", () => {
  it("routes a re-observed alias to its canonical value", () => {
    const v = vocab("offer framing", [
      ["strikethrough-and-pill-tag", ["a.com"]],
      ["strikethrough-with-value-badge", ["b.com"]],
    ]);
    mergeValues(v, "offer-framing", "strikethrough-with-value-badge", "strikethrough-and-pill-tag", { method: "semantic" });
    const r = observe(v, { axis: "offer framing", value: "strikethrough with value badge", brand: "c.com" });
    expect(r.key).toBe("strikethrough-and-pill-tag");
    expect(r.status).toBe("promoted");
  });
});

describe("judge contract", () => {
  it("states that doubt means DIFFERENT", () => {
    expect(MERGE_JUDGE_SYSTEM).toMatch(/When unsure, answer DIFFERENT/);
  });
  it("only a literal true merges; unknown ids are dropped", () => {
    const out = parseVerdicts('{"verdicts":[{"id":"0:1","same":true},{"id":"0:2","same":"yes"},{"id":"9:9","same":true}]}', ["0:1", "0:2"]);
    expect(out).toEqual([
      { id: "0:1", same: true, reason: undefined },
      { id: "0:2", same: false, reason: undefined },
    ]);
  });
  it("embeds axis, label and gloss together", () => {
    expect(valueText("offer-framing", "strikethrough-and-pill-tag", "struck price beside a pill")).toBe(
      "offer framing: strikethrough and pill tag. struck price beside a pill",
    );
  });
});
