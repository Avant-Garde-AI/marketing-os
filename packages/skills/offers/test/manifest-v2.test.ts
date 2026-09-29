import { describe, expect, it } from "vitest";
import { compileOfferManifestV2, checkManifestV2Structure, isStoreRelativePath } from "../src/manifest-v2";
import { compileOfferManifest } from "../src/manifest";
import type { OfferConcept } from "../src/schema-v2";
import { IMG, editorialConcept, quizConcept } from "./fixtures-v2";

const sumWeights = (arms: { weight: number }[]) => arms.reduce((t, a) => t + a.weight, 0);

function mutate(c: OfferConcept, fn: (c: OfferConcept) => void): OfferConcept {
  const copy = structuredClone(c);
  fn(copy);
  return copy;
}

describe("compileOfferManifestV2 — shape", () => {
  it("compiles two concepts into control/v1/v2 with weights summing to 1", () => {
    const m = compileOfferManifestV2({ slug: "ofr_harness", concepts: [quizConcept(), editorialConcept()], placement: "takeover" });
    expect(m.version).toBe("2");
    expect(m.experiment.arms.map((a) => a.key)).toEqual(["control", "v1", "v2"]);
    expect(m.experiment.arms.map((a) => a.kind)).toEqual(["control", "variant", "variant"]);
    expect(m.experiment.arms[0]!.weight).toBe(0.34);
    expect(sumWeights(m.experiment.arms)).toBeCloseTo(1, 10);
    expect(m.experiment.id).toBe("exp_ofr_harness");
    expect(m.variants.v1!.archetype).toBe("zero-party-quiz");
    expect(m.variants.v2!.composition).toBe("editorial-type");
    expect(m.consent).toEqual({ capturesEmail: true });
  });

  it("gives the incumbent a variant-equal share; four equal arms by default", () => {
    const m = compileOfferManifestV2({
      slug: "ofr_h2h",
      concepts: [quizConcept(), editorialConcept()],
      incumbent: { vendor: "klaviyo" },
    });
    expect(m.experiment.arms).toEqual([
      { key: "control", weight: 0.25, kind: "control" },
      { key: "v1", weight: 0.25, kind: "variant" },
      { key: "v2", weight: 0.25, kind: "variant" },
      { key: "incumbent", weight: 0.25, kind: "incumbent", vendor: "klaviyo" },
    ]);
    expect(m.variants.incumbent).toBeUndefined();
  });

  it("control absorbs rounding so weights always sum to exactly 1", () => {
    const m = compileOfferManifestV2({
      slug: "ofr_round",
      concepts: [quizConcept(), editorialConcept()],
      incumbent: { vendor: "klaviyo" },
      controlWeight: 0.3,
    });
    const variant = m.experiment.arms.find((a) => a.key === "v1")!.weight;
    const incumbent = m.experiment.arms.find((a) => a.key === "incumbent")!.weight;
    expect(variant).toBe(incumbent);
    expect(sumWeights(m.experiment.arms)).toBeCloseTo(1, 10);
  });

  it("refuses head-to-head against a vendor the runtime cannot observe", () => {
    expect(() =>
      compileOfferManifestV2({ slug: "ofr_privy", concepts: [editorialConcept()], incumbent: { vendor: "privy" } }),
    ).toThrow(/head-to-head supports klaviyo only; "privy"/);
  });

  it("defaults mobile search arrival to teaser-first for overlay/takeover (teaser on), as-desktop for corner-card", () => {
    const t = compileOfferManifestV2({ slug: "ofr_take", concepts: [editorialConcept()], placement: "takeover" });
    expect(t.mobile).toEqual({ searchArrival: "teaser-first" });
    expect(t.teaser).toEqual({ enabled: true });
    const o = compileOfferManifestV2({ slug: "ofr_over", concepts: [editorialConcept()], placement: "overlay" });
    expect(o.mobile?.searchArrival).toBe("teaser-first");
    const c = compileOfferManifestV2({ slug: "ofr_corner", concepts: [editorialConcept()] });
    expect(c.placement).toBe("corner-card");
    expect(c.mobile).toEqual({ searchArrival: "as-desktop" });
    expect(c.teaser).toEqual({ enabled: true });
    const off = compileOfferManifestV2({ slug: "ofr_off", concepts: [editorialConcept()], placement: "overlay", mobileSearchArrival: "as-desktop", teaser: false });
    expect(off.teaser).toBeUndefined();
  });

  it("refuses disabling the teaser while mobile search arrival is teaser-first", () => {
    expect(() =>
      compileOfferManifestV2({ slug: "ofr_x_x", concepts: [editorialConcept()], placement: "takeover", teaser: false }),
    ).toThrow(/teaser-first.*cannot be disabled/);
  });

  it("carries targeting, schedule, pages, trigger, title, teaser label and per-arm trigger", () => {
    const concept = mutate(editorialConcept(), (c) => {
      c.trigger = { kind: "exit-intent" };
    });
    const m = compileOfferManifestV2({
      slug: "ofr_full",
      title: "Collector's list",
      concepts: [concept],
      placement: "overlay",
      targeting: { devices: ["mobile"] },
      schedule: { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" },
      pages: ["home"],
      trigger: { kind: "scroll-dwell", percent: 50, dwellSeconds: 15 },
      teaser: { enabled: true, label: "Join the list" },
      policy: "thompson",
    });
    expect(m.title).toBe("Collector's list");
    expect(m.audience.targeting).toEqual({ devices: ["mobile"] });
    expect(m.schedule?.from).toBe("2026-11-01T00:00:00Z");
    expect(m.audience.pages).toEqual(["home"]);
    expect(m.trigger).toEqual({ kind: "scroll-dwell", percent: 50, dwellSeconds: 15, suppressAfterDismissDays: 14, maxPerSession: 1 });
    expect(m.teaser).toEqual({ enabled: true, label: "Join the list" });
    expect(m.variants.v1!.trigger).toEqual({ kind: "exit-intent" });
    expect(m.experiment.policy).toBe("thompson");
  });

  it("merges style tokens over the defaults — never from the concept", () => {
    const m = compileOfferManifestV2({
      slug: "ofr_style",
      concepts: [editorialConcept()],
      style: { bg: "#f4efe6", fontDisplay: "Canela" },
    });
    expect(m.variants.v1!.style.bg).toBe("#f4efe6");
    expect(m.variants.v1!.style.fontDisplay).toBe("Canela");
    expect(m.variants.v1!.style.ink).toBe("#1a1a1a");
  });

  it("places a concept-level imageSrc as the first block of the hook when no image block exists", () => {
    const concept = mutate(editorialConcept(), (c) => {
      c.composition = "split-image";
      c.imageSrc = IMG;
      c.imageAlt = "A framed print in a hallway";
    });
    const m = compileOfferManifestV2({ slug: "ofr_img", concepts: [concept] });
    expect(m.variants.v1!.steps[0]!.blocks[0]).toEqual({ kind: "image", src: IMG, alt: "A framed print in a hallway" });
  });

  it("defaults unique codes for free-shipping and percent incentives", () => {
    const concept = mutate(editorialConcept(), (c) => {
      c.incentive = { type: "percent", value: 10 };
    });
    const m = compileOfferManifestV2({ slug: "ofr_pct", concepts: [concept] });
    expect(m.variants.v1!.incentive).toEqual({ type: "percent", value: 10, codeMode: "unique" });
  });

  it("does not mutate the input concepts", () => {
    const concept = mutate(editorialConcept(), (c) => {
      c.composition = "split-image";
      c.imageSrc = IMG;
    });
    const before = JSON.stringify(concept);
    compileOfferManifestV2({ slug: "ofr_pure", concepts: [concept] });
    expect(JSON.stringify(concept)).toBe(before);
  });

  it("leaves the v1 compile path unchanged", () => {
    const m = compileOfferManifest({
      surfaceSlug: "ofr_v1",
      variants: { v1: { headline: "Hello there", body: "Body copy here", cta: "Join", success: "Thanks", consent: "We will email you sometimes." } },
    });
    expect((m as { version?: string }).version).toBeUndefined();
    expect(m.experiment.arms).toEqual([
      { key: "control", weight: 0.34 },
      { key: "v1", weight: 0.66 },
    ]);
  });
});

describe("compileOfferManifestV2 — refusals (contract §1.1)", () => {
  const compile = (c: OfferConcept, extra: Partial<Parameters<typeof compileOfferManifestV2>[0]> = {}) =>
    compileOfferManifestV2({ slug: "ofr_refuse", concepts: [c], ...extra });

  it("refuses 0 or 3 concepts, and bad slugs", () => {
    expect(() => compileOfferManifestV2({ slug: "ofr_none", concepts: [] })).toThrow(/1 or 2 concepts/);
    expect(() =>
      compileOfferManifestV2({ slug: "ofr_three", concepts: [editorialConcept(), editorialConcept(), editorialConcept()] }),
    ).toThrow(/1 or 2 concepts/);
    expect(() => compileOfferManifestV2({ slug: "Bad Slug", concepts: [editorialConcept()] })).toThrow(/slug/);
  });

  it("refuses a malformed concept with the zod path", () => {
    const bad = mutate(editorialConcept(), (c) => {
      (c as { archetype: string }).archetype = "spin-to-win";
    });
    expect(() => compile(bad)).toThrow(/concept 1 \("The collector's list"\) is malformed — archetype/);
  });

  it("refuses an email step without consent", () => {
    const bad = mutate(editorialConcept(), (c) => {
      c.steps[0]!.blocks = c.steps[0]!.blocks.filter((b) => b.kind !== "consent");
    });
    expect(() => compile(bad)).toThrow(/variants\.v1\.steps\[0\]: a step with an email field must carry consent/);
  });

  it("refuses a multi-step flow missing progress in a non-reward step", () => {
    const bad = mutate(quizConcept(), (c) => {
      c.steps[1]!.blocks = c.steps[1]!.blocks.filter((b) => b.kind !== "progress");
    });
    expect(() => compile(bad)).toThrow(/variants\.v1\.steps\[1\]: a 3-step flow needs a progress block/);
  });

  it("refuses off-CDN images, including pick images", () => {
    const bad = mutate(quizConcept(), (c) => {
      const img = c.steps[0]!.blocks[0]!;
      if (img.kind === "image") img.src = "https://example.com/room.jpg";
    });
    expect(() => compile(bad)).toThrow(/steps\[0\]\.blocks\[0\]\.src: image must be on the store's Shopify CDN/);
    const badPick = mutate(quizConcept(), (c) => {
      const r = c.steps[2]!.blocks[0]!;
      if (r.kind === "reward") r.picks!.living![0]!.imageSrc = "http://cdn.shopify.com/x.jpg";
    });
    expect(() => compile(badPick)).toThrow(/picks\.living\[0\]\.imageSrc/);
  });

  it("refuses absolute and protocol-relative reward links", () => {
    for (const href of ["https://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
      const bad = mutate(quizConcept(), (c) => {
        const r = c.steps[2]!.blocks[0]!;
        if (r.kind === "reward") r.link = { label: "Go", href };
      });
      expect(() => compile(bad)).toThrow(/reward link must be a store-relative path/);
    }
    expect(isStoreRelativePath("/collections/all?sort=new")).toBe(true);
  });

  it("refuses two email blocks, and a variant with none", () => {
    const two = mutate(quizConcept(), (c) => {
      c.steps[0]!.blocks.push({ kind: "email", cta: "Join" }, { kind: "consent", text: "We will email you sometimes." });
    });
    expect(() => compile(two)).toThrow(/exactly one email; found 2/);
    const none = mutate(editorialConcept(), (c) => {
      c.steps[0]!.blocks = c.steps[0]!.blocks.filter((b) => b.kind !== "email");
    });
    expect(() => compile(none)).toThrow(/found 0 email blocks/);
  });

  it("refuses two choices in one step", () => {
    const bad = mutate(quizConcept(), (c) => {
      const choice = c.steps[0]!.blocks.find((b) => b.kind === "choice")!;
      c.steps[0]!.blocks.push(structuredClone(choice));
    });
    expect(() => compile(bad)).toThrow(/at most one choice per step, has 2/);
  });

  it("refuses a choice with too few options (schema) and picks keyed by a non-answer", () => {
    const few = mutate(quizConcept(), (c) => {
      const ch = c.steps[0]!.blocks.find((b) => b.kind === "choice");
      if (ch?.kind === "choice") ch.options = ch.options.slice(0, 1);
    });
    expect(() => compile(few)).toThrow(/options/);
    const orphan = mutate(quizConcept(), (c) => {
      const r = c.steps[2]!.blocks[0]!;
      if (r.kind === "reward") r.picks!.kitchen = [{ title: "Kitchen art", url: "/collections/kitchen" }];
    });
    expect(() => compile(orphan)).toThrow(/"kitchen" is not a value of any choice option/);
  });

  it("refuses more than three steps (schema)", () => {
    const bad = mutate(quizConcept(), (c) => {
      c.steps.splice(2, 0, { id: "extra", kind: "ask", blocks: [{ kind: "cta", label: "Next" }, { kind: "progress" }] });
    });
    expect(() => compile(bad)).toThrow(/steps/);
  });

  it("refuses a dead-end step and a reward step that is not last", () => {
    const dead = mutate(quizConcept(), (c) => {
      c.steps[0]!.blocks = c.steps[0]!.blocks.filter((b) => b.kind !== "choice");
      const r = c.steps[2]!.blocks[0]!;
      if (r.kind === "reward") {
        r.mode = "message";
        delete r.picks;
      }
    });
    expect(() => compile(dead)).toThrow(/steps\[0\]: every step before the last needs a choice, cta, or email/);
  });

  it("refuses image compositions without an image in the hook", () => {
    const bad = mutate(editorialConcept(), (c) => {
      c.composition = "full-bleed-image";
    });
    expect(() => compile(bad)).toThrow(/composition "full-bleed-image" needs an image block in the first step/);
  });

  it("caps percent incentives at 20 without a margin policy", () => {
    const pct = (value: number) =>
      mutate(editorialConcept(), (c) => {
        c.incentive = { type: "percent", value };
      });
    expect(() => compile(pct(20))).not.toThrow();
    expect(() => compile(pct(25))).toThrow(/25% exceeds the 20% cap/);
  });

  it("caps percent incentives at grossMargin − floor with a margin policy", () => {
    const pct = (value: number) =>
      mutate(editorialConcept(), (c) => {
        c.incentive = { type: "percent", value };
      });
    const margin = { grossMarginPct: 60, floorPct: 45 };
    expect(() => compile(pct(15), { margin })).not.toThrow();
    expect(() => compile(pct(16), { margin })).toThrow(/16% exceeds the 15% cap/);
    expect(() => compile(pct(25), { margin: { grossMarginPct: 70, floorPct: 40 } })).not.toThrow();
    expect(() => compile(pct(10), { margin: { grossMarginPct: 40, floorPct: 50 } })).toThrow(/margin policy needs/);
  });

  it("refuses a control weight outside 0.1–0.5", () => {
    expect(() => compile(editorialConcept(), { controlWeight: 0.05 })).toThrow(/controlWeight must be within 0\.1–0\.5/);
    expect(() => compile(editorialConcept(), { controlWeight: 0.6 })).toThrow(/controlWeight must be within 0\.1–0\.5/);
  });

  it("accepts a 10% holdback, splitting the rest evenly", () => {
    const m = compileOfferManifestV2({ slug: "ofr_holdback", concepts: [quizConcept(), editorialConcept()], controlWeight: 0.1 });
    const w = Object.fromEntries(m.experiment.arms.map((a) => [a.key, a.weight]));
    expect(w).toEqual({ control: 0.1, v1: 0.45, v2: 0.45 });
  });
});

describe("checkManifestV2Structure", () => {
  const base = () => compileOfferManifestV2({ slug: "ofr_check", concepts: [quizConcept(), editorialConcept()] });

  it("finds nothing in a compiled manifest", () => {
    expect(checkManifestV2Structure(base())).toEqual([]);
  });

  it("flags arm/variant inconsistencies and bad weights", () => {
    const m = base();
    m.experiment.arms = m.experiment.arms.filter((a) => a.key !== "control");
    m.experiment.arms.push({ key: "v3", weight: 0.1 });
    const codes = checkManifestV2Structure(m).map((p) => p.code);
    expect(codes).toContain("structure/control-arm");
    expect(codes).toContain("structure/arm-variant");
    expect(codes).toContain("structure/weights-sum");
  });

  it("flags a second incumbent and a non-klaviyo incumbent", () => {
    const m = base();
    m.experiment.arms = [
      { key: "control", weight: 0.25, kind: "control" },
      { key: "v1", weight: 0.25 },
      { key: "v2", weight: 0.25 },
      { key: "incumbent", weight: 0.125, kind: "incumbent", vendor: "privy" },
      { key: "incumbent2", weight: 0.125, kind: "incumbent", vendor: "klaviyo" },
    ];
    const codes = checkManifestV2Structure(m).map((p) => p.code);
    expect(codes).toContain("structure/incumbent-arm");
    expect(codes).toContain("structure/incumbent-vendor");
  });

  it("validates per-cell weights", () => {
    const m = base();
    m.experiment.cells = {
      "mobile.new.search": [
        { key: "control", weight: 0.5 },
        { key: "v1", weight: 0.5 },
      ],
      "desktop.new.direct": [{ key: "nope", weight: 0.4 }],
    };
    const problems = checkManifestV2Structure(m);
    expect(problems.map((p) => p.path)).toEqual(["experiment.cells.desktop.new.direct", "experiment.cells.desktop.new.direct"]);
  });

  it("applies the percent cap only when asked", () => {
    const m = base();
    m.variants.v2!.incentive = { type: "percent", value: 30 };
    expect(checkManifestV2Structure(m)).toEqual([]);
    expect(checkManifestV2Structure(m, { percentCap: 20 }).map((p) => p.code)).toEqual(["structure/incentive-cap"]);
  });
});
