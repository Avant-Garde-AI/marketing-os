import { describe, expect, it } from "vitest";
import {
  admittedValues,
  brandKey,
  emptyVocabulary,
  isRecognized,
  normalizeAxis,
  observe,
  recognizedEmergentAxes,
  rejectReason,
  softPrior,
  validateFacets,
  vocabularyStats,
} from "../src/vocabulary.js";

describe("specificity floor", () => {
  it("rejects generic and single-word values", () => {
    expect(rejectReason("clean")).toMatch(/generic/);
    expect(rejectReason("carousel")).toMatch(/single word/);
    expect(rejectReason("modern minimal")).toMatch(/generic terms/);
    expect(rejectReason("")).toBe("empty");
    expect(rejectReason("one two three four five six seven")).toMatch(/too long/);
  });
  it("accepts compound named treatments", () => {
    expect(rejectReason("sticky-thumb-rail")).toBeNull();
    expect(rejectReason("Subscribe & save toggle")).toBeNull();
  });
});

describe("normalization", () => {
  it("lands camelCase and prose axis names on one key", () => {
    expect(normalizeAxis("pdpGalleryBehavior")).toBe("pdp-gallery-behavior");
    expect(normalizeAxis("PDP gallery behavior")).toBe("pdp-gallery-behavior");
  });
  it("derives a brand key from URLs", () => {
    expect(brandKey("https://www.Example.com/products/x")).toBe("example.com");
    expect(brandKey("shop.example.co.uk")).toBe("shop.example.co.uk");
  });
});

describe("admission gate", () => {
  const obs = (brand: string, value = "sticky-thumb-rail") => ({ axis: "pdp gallery behavior", value, brand });

  it("admits a proposed value only at N distinct brands", () => {
    const v = emptyVocabulary();
    expect(observe(v, obs("a.com")).status).toBe("pending");
    expect(observe(v, obs("b.com")).status).toBe("pending");
    expect(observe(v, obs("c.com")).status).toBe("promoted");
    expect(observe(v, obs("d.com")).status).toBe("admitted");
    expect(admittedValues(v, "pdp-gallery-behavior")).toEqual(["sticky-thumb-rail"]);
  });

  it("never lets one brand promote its own value, however often it repeats", () => {
    const v = emptyVocabulary();
    for (let i = 0; i < 10; i++) observe(v, obs("a.com"));
    expect(v.axes["pdp-gallery-behavior"]!.values["sticky-thumb-rail"]!.support).toEqual(["a.com"]);
    expect(admittedValues(v, "pdp-gallery-behavior")).toEqual([]);
  });

  it("admits human-confirmed (earned) values on sight", () => {
    const v = emptyVocabulary();
    expect(observe(v, { ...obs("a.com"), origin: "earned" }).status).toBe("promoted");
    expect(isRecognized(v, "pdp-gallery-behavior")).toBe(true);
  });

  it("does not run the specificity floor on earned values", () => {
    const v = emptyVocabulary();
    expect(observe(v, { axis: "cart surface", value: "drawer", brand: "a.com", origin: "earned" }).status).toBe("promoted");
  });

  it("recognizes an axis when N brands name it with different values, firing once", () => {
    const v = emptyVocabulary();
    const r1 = observe(v, obs("a.com", "sticky-thumb-rail"));
    const r2 = observe(v, obs("b.com", "stacked-full-width-scroll"));
    const r3 = observe(v, obs("c.com", "dot-paged-carousel"));
    const r4 = observe(v, obs("d.com", "ugc-tile-interleave"));
    expect([r1, r2, r4].some((r) => r.axisRecognized)).toBe(false);
    expect(r3.axisRecognized).toBe(true);
    expect(recognizedEmergentAxes(v)).toEqual([{ axis: "pdp-gallery-behavior", brands: 4, distinctValues: 4 }]);
    expect(admittedValues(v, "pdp-gallery-behavior")).toEqual([]);
  });

  it("folds near-duplicates into the existing value and records the alias", () => {
    const v = emptyVocabulary();
    observe(v, obs("a.com", "sticky-thumbnail-rail-left"));
    const r = observe(v, obs("b.com", "left-sticky-thumbnail-rail"));
    expect(r.key).toBe("sticky-thumbnail-rail-left");
    expect(r.mergedFrom).toBe("left-sticky-thumbnail-rail");
    expect(r.support).toBe(2);
    expect(v.axes["pdp-gallery-behavior"]!.values["sticky-thumbnail-rail-left"]!.aliases).toEqual(["left-sticky-thumbnail-rail"]);
  });

  it("rejects degenerate proposals without touching the store", () => {
    const v = emptyVocabulary();
    expect(observe(v, { axis: "hero", value: "bold", brand: "a.com" }).status).toBe("rejected");
    expect(v.axes).toEqual({});
  });

  it("keeps the first gloss", () => {
    const v = emptyVocabulary();
    observe(v, { ...obs("a.com"), gloss: "first" });
    observe(v, { ...obs("b.com"), gloss: "second" });
    expect(v.axes["pdp-gallery-behavior"]!.values["sticky-thumb-rail"]!.gloss).toBe("first");
  });
});

describe("HARD register", () => {
  const v = emptyVocabulary();
  observe(v, { axis: "cart surface", value: "slide-out-drawer-upsell", brand: "a.com", origin: "earned" });
  observe(v, { axis: "cart surface", value: "upsell-slide-out-drawer", brand: "b.com" }); // alias

  it("keeps admitted values, nulls unknown ones and records them", () => {
    const r = validateFacets({ cartSurface: "full-page-cart", "offer framing": "x-y" }, v);
    expect(r.values["cart-surface"]).toBeNull();
    expect(r.values["offer-framing"]).toBeNull();
    expect(r.rejected).toEqual([
      { axis: "cart-surface", value: "full-page-cart" },
      { axis: "offer-framing", value: "x-y" },
    ]);
  });
  it("accepts an alias of an admitted value as that value", () => {
    expect(validateFacets({ "cart surface": "upsell slide out drawer" }, v).values["cart-surface"]).toBe("slide-out-drawer-upsell");
  });
  it("returns null for admitted axes the labeler skipped", () => {
    expect(validateFacets({}, v).values).toEqual({ "cart-surface": null });
  });
});

describe("SOFT register", () => {
  it("lists admitted values with glosses and seed prompts for uncovered axes", () => {
    const v = emptyVocabulary();
    observe(v, { axis: "cart surface", value: "slide-out-drawer-upsell", brand: "a.com", origin: "earned", gloss: "drawer with upsells" });
    const p = softPrior(v, {
      seedAxes: [
        { axis: "cart surface", description: "seed for cart" },
        { axis: "offer framing", description: "how price is framed" },
      ],
    });
    expect(p).toContain('"slide-out-drawer-upsell": drawer with upsells');
    expect(p).toContain("offer-framing: how price is framed");
    expect(p).not.toContain("seed for cart");
  });
});

describe("stats", () => {
  it("counts brands, axes and values", () => {
    const v = emptyVocabulary();
    observe(v, { axis: "a axis", value: "one-two", brand: "x.com", origin: "earned" });
    observe(v, { axis: "b axis", value: "three-four", brand: "y.com" });
    expect(vocabularyStats(v)).toEqual({ axes: 2, recognizedAxes: 1, admittedAxes: 1, admittedValues: 1, pendingValues: 1, brands: 2 });
  });
});
