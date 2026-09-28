import { describe, expect, it } from "vitest";
import { collectVariantCopy, gateOfferManifestV2, scanDeclineCopy, scanOfferCopy, validateOfferManifest } from "../src/gates-v2";
import { compileOfferManifestV2 } from "../src/manifest-v2";
import { compileOfferManifest } from "../src/manifest";
import type { Block, OfferManifestV2 } from "../src/types";
import { editorialConcept, quizConcept } from "./fixtures-v2";

function manifest(): OfferManifestV2 {
  return compileOfferManifestV2({
    slug: "ofr_gate",
    concepts: [quizConcept(), editorialConcept()],
    placement: "overlay",
    teaser: { enabled: true, label: "Your picks" },
  });
}

function findBlock<K extends Block["kind"]>(m: OfferManifestV2, variant: string, kind: K): Extract<Block, { kind: K }> {
  for (const s of m.variants[variant]!.steps) {
    const b = s.blocks.find((x) => x.kind === kind);
    if (b) return b as Extract<Block, { kind: K }>;
  }
  throw new Error(`no ${kind} block`);
}

describe("gateOfferManifestV2", () => {
  it("passes a clean compiled manifest, in the v1 result shape plus per-variant findings", () => {
    const g = gateOfferManifestV2(manifest());
    expect(g.passed).toBe(true);
    expect(g.darkPattern).toEqual({ passed: true, findings: [] });
    expect(g.consentPresent).toBe(true);
    expect(g.componentGuarantees.length).toBeGreaterThan(0);
    expect(g.structure).toEqual({ passed: true, findings: [] });
    expect(Object.keys(g.variants)).toEqual(["v1", "v2"]);
    expect(g.variants.v1).toEqual({ passed: true, findings: [] });
  });

  it("collects every shopper-visible string", () => {
    const m = manifest();
    const paths = collectVariantCopy("v1", m.variants.v1!).map((c) => c.path);
    for (const expected of [
      "variants.v1.steps[0].blocks[1].text", // eyebrow
      "variants.v1.steps[0].blocks[2].accent", // headline accent
      "variants.v1.steps[0].blocks[3].question",
      "variants.v1.steps[0].blocks[3].options[1].label",
      "variants.v1.steps[0].blocks[5].text", // decline
      "variants.v1.steps[1].blocks[1].cta", // email cta
      "variants.v1.steps[1].blocks[2].text", // consent
      "variants.v1.steps[2].blocks[0].headline",
      "variants.v1.steps[2].blocks[0].picks.bedroom[0].title",
      "variants.v1.steps[2].blocks[0].link.label",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  const cases: [string, (m: OfferManifestV2) => void, RegExp][] = [
    ["headline accent (urgency)", (m) => { findBlock(m, "v1", "headline").accent = "Hurry, offer ends tonight"; }, /fake-urgency/],
    ["body (countdown)", (m) => { findBlock(m, "v2", "body").text = "The countdown is on."; }, /fake-urgency/],
    ["points", (m) => { m.variants.v2!.steps[0]!.blocks.push({ kind: "points", items: ["Only 3 left"] }); }, /fake-urgency/],
    ["choice question", (m) => { findBlock(m, "v1", "choice").question = "Spin to win — which room?"; }, /chance-mechanic/],
    ["choice label", (m) => { findBlock(m, "v1", "choice").options[0]!.label = "Mystery discount"; }, /chance-mechanic/],
    ["email cta", (m) => { findBlock(m, "v2", "email").cta = "Last chance"; }, /fake-urgency/],
    ["consent", (m) => { findBlock(m, "v2", "consent").text = "Only 2 left in stock, sign up to hold yours."; }, /fake-urgency/],
    ["reward headline", (m) => { findBlock(m, "v1", "reward").headline = "Selling fast: your picks"; }, /fake-urgency/],
    ["reward body", (m) => { findBlock(m, "v1", "reward").body = "12 people are viewing these"; }, /fake-urgency/],
    ["pick title", (m) => { findBlock(m, "v1", "reward").picks!.living![0]!.title = "Scratch card prizes"; }, /chance-mechanic/],
    ["image caption", (m) => { findBlock(m, "v1", "image").caption = "Only 1 left"; }, /fake-urgency/],
  ];

  for (const [where, edit, code] of cases) {
    it(`refuses dark patterns in the ${where}`, () => {
      const m = manifest();
      edit(m);
      const g = gateOfferManifestV2(m);
      expect(g.passed).toBe(false);
      expect(g.darkPattern.passed).toBe(false);
      expect(g.darkPattern.findings.some((f) => code.test(f.code))).toBe(true);
    });
  }

  it("refuses dark patterns in the teaser label, attributed to the manifest", () => {
    const m = manifest();
    m.teaser = { enabled: true, label: "Spin the wheel" };
    const g = gateOfferManifestV2(m);
    expect(g.passed).toBe(false);
    expect(g.manifestFindings[0]).toMatchObject({ path: "teaser.label", code: "dark-pattern/chance-mechanic" });
  });

  it("attributes copy findings to the variant and the exact path", () => {
    const m = manifest();
    findBlock(m, "v2", "body").text = "Selling fast.";
    const g = gateOfferManifestV2(m);
    expect(g.variants.v1!.passed).toBe(true);
    expect(g.variants.v2!.passed).toBe(false);
    expect(g.variants.v2!.findings[0]).toMatchObject({ path: "variants.v2.steps[0].blocks[1].text", code: "dark-pattern/fake-urgency" });
  });

  it.each([
    "No thanks, I'll pay full price",
    "No, I don't want to save",
    "I hate good art",
    "No, I prefer ugly walls",
    "No thanks, I'd rather miss out",
    "Skip the discount",
  ])("refuses value-framed decline copy: %s", (text) => {
    const m = manifest();
    findBlock(m, "v2", "decline").text = text;
    const g = gateOfferManifestV2(m);
    expect(g.passed).toBe(false);
    expect(g.variants.v2!.findings.some((f) => f.code === "decline/value-framing")).toBe(true);
  });

  it.each(["No thanks", "Maybe later", "Not right now", "Just browsing"])("allows neutral decline copy: %s", (text) => {
    expect(scanDeclineCopy(text)).toEqual([]);
    expect(scanOfferCopy(text)).toEqual([]);
  });

  it("re-checks structure: consent removed after compile fails consentPresent and structure", () => {
    const m = manifest();
    const ask = m.variants.v1!.steps[1]!;
    ask.blocks = ask.blocks.filter((b) => b.kind !== "consent");
    const g = gateOfferManifestV2(m);
    expect(g.passed).toBe(false);
    expect(g.consentPresent).toBe(false);
    expect(g.structure.findings.map((f) => f.code)).toContain("structure/consent-missing");
    expect(g.variants.v1!.findings.some((f) => f.code === "structure/consent-missing")).toBe(true);
  });

  it("re-checks structure: progress, CDN images, reward link, counts", () => {
    const m = manifest();
    m.variants.v1!.steps[0]!.blocks = m.variants.v1!.steps[0]!.blocks.filter((b) => b.kind !== "progress");
    findBlock(m, "v1", "image").src = "https://images.example.com/x.jpg";
    findBlock(m, "v1", "reward").link = { label: "Shop", href: "https://elsewhere.example" };
    m.variants.v1!.steps[0]!.blocks.push({ kind: "choice", question: "Again?", answerKey: "again", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
    const codes = gateOfferManifestV2(m).structure.findings.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "structure/progress-missing",
        "structure/image-origin",
        "structure/reward-link",
        "structure/choice-count",
      ]),
    );
  });

  it("applies the margin cap only when a margin policy is passed", () => {
    const m = manifest();
    m.variants.v2!.incentive = { type: "percent", value: 25, codeMode: "unique" };
    expect(gateOfferManifestV2(m).passed).toBe(true);
    expect(gateOfferManifestV2(m, { margin: { grossMarginPct: 50, floorPct: 40 } }).passed).toBe(false);
  });
});

describe("validateOfferManifest", () => {
  it("accepts a compiled v2 manifest", () => {
    const r = validateOfferManifest(JSON.parse(JSON.stringify(manifest())));
    expect(r.ok).toBe(true);
    expect(r.version).toBe("2");
  });

  it("accepts a compiled v1 manifest unchanged", () => {
    const v1 = compileOfferManifest({
      surfaceSlug: "ofr_v1_ok",
      variants: {
        v1: {
          headline: "Join the collector's list",
          body: "Early access to new drops.",
          cta: "Join",
          success: "You're on the list.",
          consent: "By joining you agree to receive marketing emails from us.",
        },
      },
    });
    const r = validateOfferManifest(v1);
    expect(r).toMatchObject({ ok: true, version: "1" });
  });

  it("refuses v1 dark patterns, missing consent and off-CDN images", () => {
    const v1 = compileOfferManifest({
      surfaceSlug: "ofr_v1_bad",
      variants: { v1: { headline: "Selling fast", body: "b", cta: "Join", success: "ok", consent: "ok", imageSrc: "https://cdn.shopify.com/a.jpg" } },
    });
    v1.variants.v1!.content.imageSrc = "https://example.com/a.jpg";
    const r = validateOfferManifest(v1);
    expect(r.ok).toBe(false);
    expect(r.version).toBe("1");
    expect(r.errors.join("\n")).toMatch(/imageSrc/);
    expect(r.errors.join("\n")).toMatch(/fake-urgency/);
    expect(r.errors.join("\n")).toMatch(/consent/);
  });

  it("refuses a malformed v2 with zod paths, and v2 gate failures with block paths", () => {
    const shape = validateOfferManifest({ ...manifest(), placement: "bar" });
    expect(shape.ok).toBe(false);
    expect(shape.errors[0]).toMatch(/^placement:/);

    const m = manifest();
    findBlock(m, "v2", "decline").text = "No thanks, I'll pay full price";
    const r = validateOfferManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("variants.v2.steps[0].blocks[4].text: decline/value-framing"))).toBe(true);
  });

  it("refuses unknown versions and non-objects", () => {
    expect(validateOfferManifest({ version: "3" })).toMatchObject({ ok: false, version: null });
    expect(validateOfferManifest(null)).toMatchObject({ ok: false, version: null });
  });
});
