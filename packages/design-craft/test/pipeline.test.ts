import { describe, expect, it } from "vitest";
import { createOpenAIVisionModel } from "../src/adapters/openai-vision.js";
import { resolveCorpus } from "../src/corpus.js";
import { datasheet, parseJsonl, toJsonl } from "../src/dataset.js";
import { debrand } from "../src/debrand.js";
import { buildLabelPrompt, extractJsonObject, labelCapture, LabelParseError, parseLabelResponse, type Capture, type VisionModel } from "../src/labeler.js";
import type { LabelRecord } from "../src/labels.js";
import { admittedValues, emptyVocabulary, observe } from "../src/vocabulary.js";

const SHA = "a".repeat(64);

const capture = (brand: string, over: Partial<Capture> = {}): Capture => ({
  brand,
  category: "beauty",
  pageType: "product",
  url: `https://${brand}/products/x`,
  viewport: "desktop",
  capturedAt: "2026-11-18T00:00:00.000Z",
  path: "/tmp/never-read.png",
  sha256: SHA,
  ...over,
});

const stubModel = (reply: string): VisionModel & { calls: { text: string; images: number }[] } => {
  const calls: { text: string; images: number }[] = [];
  return {
    id: "stub-vlm",
    calls,
    async complete({ text, images }) {
      calls.push({ text, images: images.length });
      return reply;
    },
  };
};

describe("response parsing", () => {
  it("extracts JSON from code fences and surrounding prose", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"facets":{}}\n```')).toEqual({ facets: {} });
    expect(extractJsonObject('sure {"proposals": []} done')).toEqual({ proposals: [] });
  });
  it("fails loudly on non-JSON instead of producing an empty label", () => {
    expect(() => extractJsonObject("I cannot see the image")).toThrow(LabelParseError);
    expect(() => parseLabelResponse('{"facets": "nope"}', emptyVocabulary())).toThrow(LabelParseError);
  });
  it("folds facet answers the vocabulary can't admit into proposals (cold start)", () => {
    const r = parseLabelResponse(
      JSON.stringify({
        facets: { "ground tone": "warm-paper-ground", "section seam": "overlapping-card-seams" },
        proposals: [{ axis: "section seam", value: "overlapping card seams", gloss: "cards straddle the boundary" }],
      }),
      emptyVocabulary(),
    );
    expect(r.facets).toEqual({ "ground-tone": null, "section-seam": null });
    expect(r.proposals).toEqual([
      { axis: "section seam", value: "overlapping card seams", gloss: "cards straddle the boundary" },
      { axis: "ground-tone", value: "warm-paper-ground" },
    ]);
  });

  it("drops malformed proposals but keeps good ones", () => {
    const r = parseLabelResponse(
      JSON.stringify({ facets: {}, proposals: [{ axis: "offer framing", value: "subscribe-save-default-on", gloss: "g" }, { value: "no-axis" }, "junk"] }),
      emptyVocabulary(),
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.malformedProposals).toBe(2);
  });
});

describe("labelCapture", () => {
  it("prompts with page context and returns a coerced record without pixels", async () => {
    const v = emptyVocabulary();
    observe(v, { axis: "buy box structure", value: "sticky-atc-bar-mobile", brand: "seed.com", origin: "earned" });
    const model = stubModel(
      JSON.stringify({
        facets: { "buy box structure": "invented-thing" },
        proposals: [{ axis: "social proof density", value: "star-summary-under-title", gloss: "stars directly under the H1" }],
        notes: "dense PDP",
      }),
    );
    const rec = await labelCapture(capture("brand.com"), { model, vocabulary: v, readImage: async () => Buffer.from("png") });
    expect(model.calls[0]!.images).toBe(1);
    expect(model.calls[0]!.text).toContain("product page, desktop viewport");
    expect(rec.facets["buy-box-structure"]).toBeNull();
    expect(rec.rejectedFacets).toEqual([{ axis: "buy-box-structure", value: "invented-thing" }]);
    expect(rec.proposals[0]!.value).toBe("star-summary-under-title");
    expect(rec.labeler.id).toBe("model:stub-vlm");
    expect(JSON.stringify(rec)).not.toContain("never-read.png");
  });

  it("sends the first-screen image before the full page when present", async () => {
    const model = stubModel('{"facets":{},"proposals":[]}');
    const read: string[] = [];
    await labelCapture(capture("b.com", { foldPath: "/tmp/fold.png" }), {
      model,
      vocabulary: emptyVocabulary(),
      readImage: async (p) => (read.push(p), Buffer.from("x")),
    });
    expect(read).toEqual(["/tmp/fold.png", "/tmp/never-read.png"]);
    expect(model.calls[0]!.images).toBe(2);
  });

  it("includes seed axes for the page type in the prompt", () => {
    const p = buildLabelPrompt(emptyVocabulary(), { pageType: "cart", viewport: "mobile", url: "https://x.com/cart", category: "home" });
    expect(p).toContain("cart-surface");
    expect(p).not.toContain("hero-composition");
  });
});

const rec = (brand: string, proposals: LabelRecord["proposals"], over: Partial<LabelRecord> = {}): LabelRecord => ({
  schema: "design-craft/label@1",
  brand,
  category: "beauty",
  pageType: "product",
  url: `https://${brand}/p`,
  viewport: "desktop",
  capturedAt: "2026-11-18T00:00:00.000Z",
  captureSha256: SHA,
  facets: {},
  rejectedFacets: [],
  proposals,
  labeler: { id: "model:stub" },
  confirmed: false,
  ...over,
});

describe("debrand", () => {
  const p = (value: string) => [{ axis: "offer framing", value, gloss: "g" }];

  it("counts support per brand across pages and viewports", () => {
    const v = emptyVocabulary();
    const s = debrand(v, [
      rec("a.com", p("subscribe-save-percent-badge")),
      rec("a.com", p("subscribe-save-percent-badge"), { viewport: "mobile" }),
      rec("a.com", p("subscribe-save-percent-badge"), { pageType: "home" }),
      rec("b.com", p("subscribe-save-percent-badge")),
    ]);
    expect(s.promoted).toHaveLength(0);
    expect(v.axes["offer-framing"]!.values["subscribe-save-percent-badge"]!.support).toEqual(["a.com", "b.com"]);

    const s2 = debrand(v, [rec("c.com", p("subscribe-save-percent-badge"))]);
    expect(s2.promoted.map((e) => e.key)).toEqual(["subscribe-save-percent-badge"]);
    expect(s2.axesRecognized).toEqual(["offer-framing"]);
  });

  it("is idempotent on re-run", () => {
    const v = emptyVocabulary();
    const records = [rec("a.com", p("free-ship-threshold-bar")), rec("b.com", p("free-ship-threshold-bar"))];
    debrand(v, records);
    const before = JSON.stringify(v);
    debrand(v, records);
    expect(JSON.stringify(v)).toBe(before);
  });

  it("treats confirmed records as earned", () => {
    const v = emptyVocabulary();
    debrand(v, [rec("a.com", p("bundle-savings-ladder"), { confirmed: true, labeler: { id: "human:reviewer" } })]);
    expect(admittedValues(v, "offer-framing")).toEqual(["bundle-savings-ladder"]);
  });

  it("re-observes facets to add brand support for admitted values", () => {
    const v = emptyVocabulary();
    observe(v, { axis: "cart surface", value: "slide-out-drawer-upsell", brand: "seed.com", origin: "earned" });
    debrand(v, [rec("a.com", [], { facets: { "cart-surface": "slide-out-drawer-upsell" } })]);
    expect(v.axes["cart-surface"]!.values["slide-out-drawer-upsell"]!.support).toEqual(["seed.com", "a.com"]);
  });
});

describe("dataset", () => {
  it("strips any extra keys so pixels or paths can never ship", () => {
    const leaky = { ...rec("a.com", []), path: "/Users/me/.captures/a.png", imageBase64: "iVBOR..." };
    const out = toJsonl([leaky]);
    expect(out).not.toContain("imageBase64");
    expect(out).not.toContain(".captures");
    expect(parseJsonl(out)).toHaveLength(1);
  });

  it("writes a datasheet stating what is excluded", () => {
    const sheet = datasheet([rec("a.com", []), rec("b.com", [], { category: "apparel" })], emptyVocabulary(), { name: "t", version: "0.1" });
    expect(sheet).toContain("Brands: 2");
    expect(sheet).toContain("No screenshots or page content");
    expect(sheet).toContain("| 2026-11 | 2 |");
  });
});

describe("corpus", () => {
  it("resolves relative page URLs and rejects duplicate brands", () => {
    const { pages } = resolveCorpus({
      name: "smoke",
      stores: [{ url: "https://www.a.com", category: "beauty", rationale: "r", pages: [{ type: "product", url: "/products/x" }] }],
    });
    expect(pages[0]).toEqual({ brand: "a.com", category: "beauty", type: "product", url: "https://www.a.com/products/x" });
    expect(() =>
      resolveCorpus({
        name: "dup",
        stores: [
          { url: "https://a.com", category: "x", rationale: "r" },
          { url: "https://www.a.com/", category: "x", rationale: "r" },
        ],
      }),
    ).toThrow(/Duplicate brand/);
  });
  it("requires a selection rationale", () => {
    expect(() => resolveCorpus({ name: "n", stores: [{ url: "https://a.com", category: "x" }] })).toThrow();
  });
});

describe("openai-vision adapter", () => {
  it("sends text + image parts and returns the message content", async () => {
    let body: any;
    let headers: any;
    const model = createOpenAIVisionModel({
      baseUrl: "https://vlm.example/v1/",
      model: "teacher-1",
      apiKey: "sk-test",
      fetch: (async (url: string, init: any) => {
        expect(url).toBe("https://vlm.example/v1/chat/completions");
        body = JSON.parse(init.body);
        headers = init.headers;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"facets":{}}' } }] }), { status: 200 });
      }) as any,
    });
    const out = await model.complete({ system: "s", text: "t", images: [{ mime: "image/png", base64: "AAAA" }] });
    expect(out).toBe('{"facets":{}}');
    expect(body.model).toBe("teacher-1");
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AAAA");
    expect(headers.authorization).toBe("Bearer sk-test");
  });

  it("surfaces endpoint errors without leaking the key", async () => {
    const model = createOpenAIVisionModel({
      baseUrl: "https://vlm.example/v1",
      model: "m",
      apiKey: "sk-secret",
      fetch: (async () => new Response("quota exceeded", { status: 429 })) as any,
    });
    await expect(model.complete({ system: "s", text: "t", images: [] })).rejects.toThrow(/429: quota exceeded/);
    await expect(model.complete({ system: "s", text: "t", images: [] })).rejects.not.toThrow(/sk-secret/);
  });
});
