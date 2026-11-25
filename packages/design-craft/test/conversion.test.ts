import { describe, expect, it } from "vitest";
import {
  buildBenchmarks, benchmarkFor, CONVERSION_LENS, treatmentOverlap, resolveAdmitted, resolvedObservations, STROKE_CAVEATS, suggestStrokes, unresolvedProposals,
} from "../src/conversion.js";
import { DTC_SEED_AXES } from "../src/ontology.js";
import { vocabularyReport } from "../src/report.js";
import { applyOverrides, buildTaxonomy, familyOf, parseFamilies, TAXONOMY_SYSTEM } from "../src/taxonomy.js";
import { emptyVocabulary, mergeValues, observe, type Vocabulary } from "../src/vocabulary.js";
import type { LabelRecord } from "../src/labels.js";

function rec(brand: string, category: string, pageType: LabelRecord["pageType"], proposals: [string, string][]): LabelRecord {
  return {
    schema: "design-craft/label@1", brand, category, pageType, url: `https://${brand}/`, viewport: "desktop",
    capturedAt: "2026-11-20T00:00:00Z", captureSha256: "a".repeat(64), facets: {}, rejectedFacets: [],
    proposals: proposals.map(([axis, value]) => ({ axis, value })), labeler: { id: "model:test" }, confirmed: false,
  };
}

/** 6 apparel brands: 5 use stacked-accordions, 1 uses tabbed-detail-panels; 2 beauty brands. */
function corpus(): { v: Vocabulary; records: LabelRecord[] } {
  const records: LabelRecord[] = [];
  const brands = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"];
  brands.forEach((b, i) => {
    records.push(rec(b, "apparel", "product", [
      ["product-detail-disclosure", i < 5 ? "stacked-accordions" : "tabbed-detail-panels"],
      ["type-voice", i < 5 ? "serif-display-sans-body" : "condensed-display-sans"],
      ["trust-signal-placement", "badges-below-cta"],
    ]));
  });
  records.push(rec("g.com", "beauty", "product", [["product-detail-disclosure", "tabbed-detail-panels"]]));
  records.push(rec("h.com", "beauty", "product", [["product-detail-disclosure", "tabbed-detail-panels"]]));
  const v = emptyVocabulary();
  for (const r of records) for (const p of r.proposals) observe(v, { axis: p.axis, value: p.value, brand: r.brand });
  return { v, records };
}

describe("conversion lens", () => {
  it("covers every seed axis", () => {
    for (const s of DTC_SEED_AXES) expect(CONVERSION_LENS[s.axis], s.axis).toBeDefined();
  });
});

describe("resolveAdmitted", () => {
  it("follows value aliases and ignores pending values", () => {
    const v = emptyVocabulary();
    for (const b of ["a.com", "b.com", "c.com"]) observe(v, { axis: "offer-framing", value: "strikethrough-with-badge", brand: b });
    observe(v, { axis: "offer-framing", value: "strikethrough-and-pill-tag", brand: "d.com" });
    observe(v, { axis: "offer-framing", value: "lonely-pending-value", brand: "d.com" });
    mergeValues(v, "offer-framing", "strikethrough-and-pill-tag", "strikethrough-with-badge", { method: "semantic" });
    expect(resolveAdmitted(v, "Offer Framing", "strikethrough and pill tag")).toEqual({ axis: "offer-framing", value: "strikethrough-with-badge" });
    // An exact rewording resolves; a role swap across "with" does not (the existing guard).
    expect(resolveAdmitted(v, "offer-framing", "strikethrough-badge-with")).toEqual({ axis: "offer-framing", value: "strikethrough-with-badge" });
    expect(resolveAdmitted(v, "offer-framing", "badge-with-strikethrough")).toBeNull();
    expect(resolveAdmitted(v, "offer-framing", "lonely-pending-value")).toBeNull();
    expect(unresolvedProposals(v, { proposals: [{ axis: "offer-framing", value: "lonely-pending-value" }] })).toHaveLength(1);
  });
});

describe("buildBenchmarks", () => {
  it("counts distinct brands per category and falls back for small categories", () => {
    const { v, records } = corpus();
    const b = buildBenchmarks(v, records, { minBrands: 5 });
    const pdd = b.categories.apparel!.axes["product-detail-disclosure"]!;
    expect(pdd.brands).toBe(6);
    expect(pdd.values[0]).toMatchObject({ value: "stacked-accordions", brands: 5, share: 0.833 });
    expect(b.categories.beauty).toMatchObject({ brands: 2, fallback: "all" });
    expect(benchmarkFor(b, "beauty").key).toBe("all");
    expect(benchmarkFor(b, "Apparel").key).toBe("apparel");
    expect(b.categories.all!.axes["product-detail-disclosure"]!.brands).toBe(8);
  });
});

describe("suggestStrokes", () => {
  const { v, records } = corpus();
  const benchmarks = buildBenchmarks(v, records, { minBrands: 5 });

  it("suggests aligning a rare choice to the category convention, with evidence and caveats", () => {
    const plan = suggestStrokes({ facets: { "product-detail-disclosure": "tabbed-detail-panels" }, category: "apparel", pageType: "product", benchmarks });
    expect(plan.strokes.find((x) => x.axis === "product-detail-disclosure")).toMatchObject({
      axis: "product-detail-disclosure", from: "tabbed-detail-panels", to: "stacked-accordions", kind: "align", stage: "evaluation",
      evidence: { basis: "corpus-prevalence", level: "value", brands: 5, answering: 6, share: 0.833, currentShare: 0.167 },
    });
    expect(plan.caveats).toEqual(expect.arrayContaining(STROKE_CAVEATS));
  });

  it("reports a match as a strength, not a stroke", () => {
    const plan = suggestStrokes({ facets: { "trust-signal-placement": "badges-below-cta" }, category: "apparel", pageType: "product", benchmarks });
    expect(plan.strokes.find((s) => s.axis === "trust-signal-placement")).toBeUndefined();
    expect(plan.strengths).toEqual([expect.objectContaining({ axis: "trust-signal-placement", share: 1 })]);
  });

  it("never turns an identity axis into a stroke, but does call a rare one distinctive", () => {
    const plan = suggestStrokes({ facets: { "type-voice": "condensed-display-sans" }, category: "apparel", pageType: "product", benchmarks });
    expect(plan.strokes.find((s) => s.axis === "type-voice")).toBeUndefined();
  });

  it("does not ask a page doing something novel to adopt the convention", () => {
    const plan = suggestStrokes({
      facets: {}, novel: [{ axis: "product-detail-disclosure", value: "scrolling-spec-sheet" }], category: "apparel", pageType: "product", benchmarks,
    });
    expect(plan.strokes.find((s) => s.axis === "product-detail-disclosure")).toBeUndefined();
    expect(plan.distinctive).toEqual([expect.objectContaining({ axis: "product-detail-disclosure", value: "scrolling-spec-sheet", share: 0 })]);
    // ... while a page showing nothing there is offered the convention.
    const empty = suggestStrokes({ facets: {}, category: "apparel", pageType: "product", benchmarks });
    expect(empty.strokes.find((s) => s.axis === "trust-signal-placement")).toMatchObject({ kind: "adopt", from: null });
  });

  it("scales by measured outcomes when the vocabulary has them", () => {
    const v2 = structuredClone(v);
    v2.axes["product-detail-disclosure"]!.values["stacked-accordions"]!.reward = { offered: 10, chosen: 1 };
    const base = suggestStrokes({ facets: { "product-detail-disclosure": "tabbed-detail-panels" }, category: "apparel", pageType: "product", benchmarks });
    const tuned = suggestStrokes({ facets: { "product-detail-disclosure": "tabbed-detail-panels" }, category: "apparel", pageType: "product", benchmarks, vocabulary: v2 });
    const s = tuned.strokes.find((x) => x.axis === "product-detail-disclosure")!;
    expect(s.evidence.basis).toBe("corpus-prevalence+outcomes");
    expect(s.score).toBeLessThan(base.strokes.find((x) => x.axis === "product-detail-disclosure")!.score);
  });

  it("holds back motivation strokes when the benchmark is one sale season", () => {
    const records: LabelRecord[] = ["a.com", "b.com", "c.com", "d.com", "e.com"].map((b) => rec(b, "apparel", "home", [["hero-message-mode", "direct-promotional-offer"]]));
    const v = emptyVocabulary();
    for (const r of records) for (const p of r.proposals) observe(v, { axis: p.axis, value: p.value, brand: r.brand });
    const plain = suggestStrokes({ facets: {}, category: "apparel", pageType: "home", benchmarks: buildBenchmarks(v, records) });
    expect(plain.strokes.map((s) => s.axis)).toContain("hero-message-mode");
    const bf = suggestStrokes({ facets: {}, category: "apparel", pageType: "home", benchmarks: buildBenchmarks(v, records, { season: "black-friday-2026" }) });
    expect(bf.strokes.map((s) => s.axis)).not.toContain("hero-message-mode");
    expect(bf.seasonal).toEqual([expect.objectContaining({ axis: "hero-message-mode", brands: 5 })]);
    expect(bf.caveats.join(" ")).toMatch(/black-friday-2026/);
  });

  it("uses the fallback benchmark for a small category and says so", () => {
    const plan = suggestStrokes({ facets: {}, category: "beauty", pageType: "product", benchmarks });
    expect(plan.benchmark).toBe("all");
    expect(plan.caveats.join(" ")).toMatch(/fewer than 5 brands/);
  });
});

describe("viewports and variants", () => {
  it("compares a desktop page with desktop pages only", () => {
    const records: LabelRecord[] = [];
    for (const b of ["a.com", "b.com", "c.com", "d.com", "e.com"]) {
      records.push({ ...rec(b, "apparel", "home", [["nav-architecture", "inline-centered-links"]]), viewport: "desktop" });
      records.push({ ...rec(b, "apparel", "home", [["nav-architecture", "hamburger-and-icons"]]), viewport: "mobile" });
    }
    const v = emptyVocabulary();
    for (const r of records) for (const p of r.proposals) observe(v, { axis: p.axis, value: p.value, brand: r.brand });
    const b = buildBenchmarks(v, records);
    const desk = suggestStrokes({ facets: { "nav-architecture": "inline-centered-links" }, category: "apparel", pageType: "home", viewport: "desktop", benchmarks: b });
    expect(desk.strokes.find((s) => s.axis === "nav-architecture")).toBeUndefined();
    expect(desk.strengths[0]).toMatchObject({ axis: "nav-architecture", share: 1 });
    const mob = suggestStrokes({ facets: { "nav-architecture": "inline-centered-links" }, category: "apparel", pageType: "home", viewport: "mobile", benchmarks: b });
    expect(mob.strokes[0]).toMatchObject({ axis: "nav-architecture", to: "hamburger-and-icons", evidence: { benchmark: "apparel mobile home" } });
    // Pooled, they tie, and the plan says the viewports were pooled.
    expect(suggestStrokes({ facets: {}, category: "apparel", pageType: "home", benchmarks: b }).caveats.join(" ")).toMatch(/pooled/);
  });

  it("compares a product page with product pages when enough brands answer there", () => {
    const records: LabelRecord[] = [];
    for (const b of ["a.com", "b.com", "c.com", "d.com", "e.com"]) {
      records.push(rec(b, "apparel", "product", [["social-proof-density", "title-stars-and-bottom-reviews"]]));
      records.push(rec(b, "apparel", "collection", [["social-proof-density", "card-level-star-ratings"]]));
      records.push(rec(b, "apparel", "home", [["social-proof-density", "card-level-star-ratings"]]));
    }
    const v = emptyVocabulary();
    for (const r of records) for (const p of r.proposals) observe(v, { axis: p.axis, value: p.value, brand: r.brand });
    const b = buildBenchmarks(v, records);
    const pdp = suggestStrokes({ facets: {}, category: "apparel", pageType: "product", viewport: "desktop", benchmarks: b });
    expect(pdp.strokes.find((s) => s.axis === "social-proof-density")).toMatchObject({ to: "title-stars-and-bottom-reviews", evidence: { benchmark: "apparel desktop product", share: 1 } });
    const plp = suggestStrokes({ facets: {}, category: "apparel", pageType: "collection", viewport: "desktop", benchmarks: b });
    expect(plp.strokes.find((s) => s.axis === "social-proof-density")).toMatchObject({ to: "card-level-star-ratings" });
  });

  it("does not suggest a variant of the page's own treatment", () => {
    expect(treatmentOverlap("full-bleed-centered-overlay", "full-bleed-image-overlay")).toBeGreaterThanOrEqual(0.5);
    expect(treatmentOverlap("two-tier-centered-logo", "hamburger-and-icons")).toBe(0);
  });
});

describe("families", () => {
  /** Six variants on one axis: three "static" wordings (4 brands), two "rotating" wordings (2 brands). */
  function famCorpus() {
    const rows: [string, string][] = [
      ["a.com", "static-text-strip"], ["b.com", "static-text-bar"], ["c.com", "solid-color-text-strip"], ["d.com", "static-text-strip"],
      ["e.com", "rotating-message-carousel"], ["f.com", "auto-rotating-ticker"],
    ];
    const records = rows.map(([b, val]) => rec(b, "apparel", "home", [["announcement-bar-treatment", val]]));
    // Re-observe so every value is admitted (3 brands) and the gate isn't what's under test.
    const v = emptyVocabulary({ admissionThreshold: 1 });
    for (const r of records) for (const p of r.proposals) observe(v, { axis: p.axis, value: p.value, brand: r.brand });
    const taxonomy = {
      schema: "design-craft/taxonomy@1" as const, vocabularyRef: "t",
      axes: { "announcement-bar-treatment": { families: [
        { key: "static-bar", label: "Static bar", description: "", values: ["static-text-strip", "static-text-bar", "solid-color-text-strip"] },
        { key: "rotating-bar", label: "Rotating bar", description: "", values: ["rotating-message-carousel", "auto-rotating-ticker"] },
      ] } },
    };
    return { v, records, taxonomy };
  }

  it("measures conventions on decisions: a rare wording of the common decision is a strength", () => {
    const { v, records, taxonomy } = famCorpus();
    const b = buildBenchmarks(v, records, { taxonomy });
    const ax = b.categories.apparel!.axes["announcement-bar-treatment"]!;
    expect(ax.families![0]).toMatchObject({ family: "static-bar", brands: 4, share: 0.667, values: [{ value: "static-text-strip", brands: 2 }, expect.anything(), expect.anything()] });
    // solid-color-text-strip is 1 brand at value level, but the static decision is the convention.
    const plan = suggestStrokes({ facets: { "announcement-bar-treatment": "solid-color-text-strip" }, category: "apparel", pageType: "home", benchmarks: b, taxonomy });
    expect(plan.strengths).toEqual([expect.objectContaining({ axis: "announcement-bar-treatment", family: "static-bar", share: 0.667 })]);
  });

  it("strokes move between families and target the family's most-used value", () => {
    const { v, records, taxonomy } = famCorpus();
    // Make rotating rare: drop one rotating brand.
    const b = buildBenchmarks(v, records.filter((r) => r.brand !== "f.com"), { taxonomy });
    const plan = suggestStrokes({ facets: { "announcement-bar-treatment": "rotating-message-carousel" }, category: "apparel", pageType: "home", benchmarks: b, taxonomy, minAnswering: 3 });
    expect(plan.strokes[0]).toMatchObject({
      axis: "announcement-bar-treatment", from: "rotating-message-carousel", to: "static-text-strip",
      toFamily: { key: "static-bar" }, fromFamily: { key: "rotating-bar" }, evidence: { level: "family", brands: 4, answering: 5 },
    });
  });

  it("parseFamilies always partitions the admitted values", () => {
    const raw = JSON.stringify({ families: [
      { key: "Static Bar", label: "Static", values: ["static-text-strip", "invented-value", "static-text-bar"] },
      { key: "rotating", label: "Rotating", values: ["static-text-bar", "rotating-message-carousel"] },
    ] });
    const { families, repaired } = parseFamilies(raw, ["static-text-strip", "static-text-bar", "rotating-message-carousel", "auto-rotating-ticker"], "x");
    expect(families.map((f) => [f.key, f.values])).toEqual([
      ["static-bar", ["static-text-strip", "static-text-bar"]],
      ["rotating", ["rotating-message-carousel"]],
      ["other", ["auto-rotating-ticker"]],
    ]);
    expect(repaired.map((r) => r.value).sort()).toEqual(["auto-rotating-ticker", "static-text-bar"]);
  });

  it("applies reviewer overrides", () => {
    const { taxonomy } = famCorpus();
    const t = structuredClone(taxonomy) as any;
    applyOverrides(t, [{ axis: "announcement-bar-treatment", value: "solid-color-text-strip", family: "color-block-bar", label: "Color-block bar" }]);
    expect(familyOf(t, "announcement-bar-treatment", "solid-color-text-strip")?.label).toBe("Color-block bar");
    expect(t.axes["announcement-bar-treatment"].families.find((f: any) => f.key === "static-bar").values).not.toContain("solid-color-text-strip");
  });

  it("buildTaxonomy caches by exact input and leaves small axes ungrouped", async () => {
    const { v } = famCorpus();
    let calls = 0;
    const grouper = { id: "g", group: async () => { calls++; return JSON.stringify({ families: [{ key: "static-bar", values: ["static-text-strip", "static-text-bar", "solid-color-text-strip"] }, { key: "rotating-bar", values: ["rotating-message-carousel", "auto-rotating-ticker"] }] }); } };
    const cache = new Map<string, string>();
    const one = await buildTaxonomy(v, { grouper, cache });
    const two = await buildTaxonomy(v, { grouper, cache });
    expect(calls).toBe(1);
    expect(two.report.cached).toBe(1);
    expect(one.taxonomy.axes["announcement-bar-treatment"]!.families).toHaveLength(2);
    expect(TAXONOMY_SYSTEM).toMatch(/exactly one family/);
  });
});

describe("vocabularyReport", () => {
  it("measures M1 and stage coverage", () => {
    const { v, records } = corpus();
    const r = vocabularyReport(v, records);
    expect(r.m1.met).toBe(false);
    expect(r.m1.criteria.find((c) => c.id === "brands")).toMatchObject({ actual: 8, target: 60, met: false });
    expect(r.stages.evaluation.axes).toBeGreaterThan(0);
    expect(r.rewardCoverage.withOutcomes).toBe(0);
    expect(resolvedObservations(v, records[0]!).length).toBe(3);
  });
});
