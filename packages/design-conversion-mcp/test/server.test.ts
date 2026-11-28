import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "../src/audit.js";
import { loadDataset } from "../src/data.js";
import { createDesignConversionServer, decodeImage, type DesignConversionDeps } from "../src/server.js";
import { createHttpHandler } from "../src/transports.js";

const data = await loadDataset();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString("base64");

function server(extra: Partial<DesignConversionDeps> = {}) {
  return createDesignConversionServer({ ...data, ...extra });
}
async function call(s: ReturnType<typeof server>, name: string, args: unknown) {
  const r = (await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any;
  const res = r.result;
  return { isError: !!res.isError, text: res.content[0].text as string, json: res.isError ? null : JSON.parse(res.content[0].text) };
}

describe("protocol", () => {
  it("initializes with the client's protocol version and conversion-first instructions", async () => {
    const r = (await server().handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26" } })) as any;
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.serverInfo.name).toBe("design-conversion");
    expect(r.result.instructions).toMatch(/not measured conversion lift/);
    expect(r.result.instructions).toMatch(/Never present a stroke as a guaranteed conversion gain/);
  });

  it("answers notifications with nothing and unknown methods with -32601", async () => {
    expect(await server().handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(((await server().handle({ jsonrpc: "2.0", id: 2, method: "nope" })) as any).error.code).toBe(-32601);
  });

  it("lists read-only tools, resources and the review prompt", async () => {
    const s = server();
    const tools = ((await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as any).result.tools;
    expect(tools.map((t: any) => t.name)).toEqual(["design_vocabulary", "design_benchmark", "design_suggest_strokes", "design_audit_screenshot", "design_audit_page", "design_report"]);
    expect(tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
    const method = ((await s.handle({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "design://method" } })) as any).result.contents[0].text;
    expect(method).toMatch(/79 DTC brands/);
    const bench = ((await s.handle({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "design://benchmarks/apparel" } })) as any).result.contents[0];
    expect(JSON.parse(bench.text).benchmark).toBe("apparel");
    const p = ((await s.handle({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "conversion_design_review", arguments: { url: "https://x.com", pageType: "product" } } })) as any).result;
    expect(p.messages[0].content.text).toMatch(/one axis per commit/i);
  });
});

describe("tools on the bundled dtc-v1 dataset", () => {
  it("design_vocabulary filters by stage and carries the conversion question", async () => {
    const { json } = await call(server(), "design_vocabulary", { stage: "confidence" });
    expect(json.axes.map((a: any) => a.axis)).toEqual(expect.arrayContaining(["social-proof-density", "trust-signal-placement"]));
    expect(json.axes.every((a: any) => a.stage === "confidence" && a.conversionQuestion)).toBe(true);
  });

  it("design_vocabulary resolves an axis alias and rejects an unknown axis", async () => {
    const { json } = await call(server(), "design_vocabulary", { axis: "sticky-cta-behavior" });
    expect(json.axes[0].axis).toBe("sticky-buy-behavior");
    expect((await call(server(), "design_vocabulary", { axis: "made-up-axis" })).isError).toBe(true);
  });

  it("design_benchmark groups conventions by stage and falls back for small categories", async () => {
    const own = (await call(server(), "design_benchmark", { category: "beauty", pageType: "product" })).json;
    expect(own.benchmark).toBe("beauty");
    expect(own.stages[0].stage).toBe("attention");
    expect(own.stages.flatMap((s: any) => s.axes).every((a: any) => a.conventions.length <= 3)).toBe(true);
    const small = (await call(server(), "design_benchmark", { category: "pets" })).json;
    expect(small.benchmark).toBe("all");
    expect(small.note).toMatch(/fewer than 5 brands/);
  });

  it("design_suggest_strokes moves a minority decision to the category's convention and keeps unknown treatments distinctive", async () => {
    // Find a non-identity product-page axis whose top decision is a clear convention and that has a rare decision.
    // Strokes use the page-type scope when enough brands answer there, as here.
    const axes = data.benchmarks.categories.apparel!.pages!["product:desktop"]!;
    const pick = Object.entries(axes).map(([axis, b]) => {
      const fams = b.families ?? [];
      const top = fams.find((f) => f.family !== "other");
      const rare = data.taxonomy!.axes[axis]?.families.find((f) => f.key !== top?.family && f.key !== "other" && (fams.find((x) => x.family === f.key)?.share ?? 0) < 0.1);
      return { axis, b, top, rare };
    }).find(({ axis, b, top, rare }) => top && rare && top.share >= 0.4 && top.brands >= 3 && b.brands >= 4 && !["type-voice", "ground-tone", "photography-register", "motion-language", "brand-story-placement"].includes(axis) && ["pdp-gallery-behavior", "offer-framing", "variant-selection-style", "social-proof-density", "product-detail-disclosure", "buy-box-structure"].includes(axis))!;
    expect(pick, "fixture axis").toBeDefined();
    const { axis, top, rare } = pick;
    const { json } = await call(server(), "design_suggest_strokes", {
      category: "apparel", pageType: "product", viewport: "desktop",
      facets: { [axis]: rare!.values[0], "cross-sell-pattern": "a-treatment-nobody-uses-here" },
    });
    expect(json).toMatchObject({ benchmark: "apparel", viewport: "desktop" });
    expect(json.strokes.find((s: any) => s.axis === axis)).toMatchObject({
      from: rare!.values[0], to: top!.values[0]!.value, kind: "align", toFamily: { key: top!.family }, evidence: { level: "family", benchmark: "apparel desktop product" },
    });
    expect(json.distinctive.find((d: any) => d.axis === "cross-sell-pattern")).toMatchObject({ value: "a-treatment-nobody-uses-here", share: 0 });
    expect(json.strokes.find((s: any) => s.axis === "cross-sell-pattern")).toBeUndefined();
    expect(json.caveats[0]).toMatch(/not measured conversion lift/);
  });

  it("design_vocabulary and design_benchmark expose families", async () => {
    const v = (await call(server(), "design_vocabulary", { axis: "announcement-bar-treatment" })).json;
    expect(v.axes[0].families.map((f: any) => f.family)).toContain("static-message");
    const b = (await call(server(), "design_benchmark", { category: "apparel", viewport: "desktop", axis: "announcement-bar-treatment" })).json;
    expect(b.viewport).toBe("desktop");
    expect(b.stages[0].axes[0].decisions[0]).toMatchObject({ family: "static-message" });
  });

  it("design_report shows M1", async () => {
    const { json } = await call(server(), "design_report", {});
    expect(json.m1.met).toBe(true);
  });
});

describe("audits", () => {
  it("explain how to enable vision when none is configured", async () => {
    const r = await call(server(), "design_audit_screenshot", { image: PNG, url: "https://shop.example.com/products/x", pageType: "product" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/DESIGN_CONVERSION_API_KEY/);
  });

  it("label a screenshot with the vision model and plan strokes, without returning pixels", async () => {
    const seen: any[] = [];
    const vision = {
      id: "fake-vlm",
      async complete(i: any) {
        seen.push(i);
        return JSON.stringify({
          facets: { "trust-signal-placement": null },
          proposals: [{ axis: "product-detail-disclosure", value: data.benchmarks.categories.apparel!.axes["product-detail-disclosure"]!.values[0]!.value, gloss: "g" }],
          notes: "a fake page",
        });
      },
    };
    const { json, isError } = await call(server({ vision }), "design_audit_screenshot", { image: `data:image/png;base64,${PNG}`, url: "https://www.Shop.example.com/products/x", category: "apparel", pageType: "product" });
    expect(isError).toBe(false);
    expect(seen[0].images).toHaveLength(1);
    expect(json.page).toMatchObject({ brand: "shop.example.com", category: "apparel", pageType: "product" });
    expect(json.page.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(json.labeler).toBe("model:fake-vlm");
    expect(Object.keys(json.facets)).toContain("product-detail-disclosure");
    expect(json.plan.strengths.map((s: any) => s.axis)).toContain("product-detail-disclosure");
    expect(JSON.stringify(json)).not.toContain(PNG.slice(0, 20));
  });

  it("refuse private URLs for page capture and require a capture backend", async () => {
    const vision = { id: "v", complete: async () => "{}" };
    const r = await call(server({ vision, capture: async () => { throw new Error("should not run"); } }), "design_audit_page", { url: "http://169.254.169.254/latest", pageType: "home" });
    expect(r.text).toMatch(/private or local/);
    const noCap = await call(server({ vision }), "design_audit_page", { url: "https://example.com", pageType: "home" });
    expect(noCap.text).toMatch(/design_audit_screenshot/);
  });

  it("authorize can deny costly calls (quota) with a readable error", async () => {
    const s = server({
      vision: { id: "v", complete: async () => "{}" },
      authorize: async ({ costly }) => { if (costly) throw new Error("Daily audit quota reached (10/day)."); },
    });
    expect((await call(s, "design_audit_screenshot", { image: PNG, url: "https://a.com", pageType: "home" })).text).toMatch(/quota/);
    expect((await call(s, "design_vocabulary", {})).isError).toBe(false);
  });
});

describe("helpers", () => {
  it("decodeImage accepts PNG/JPEG only", () => {
    expect(decodeImage(PNG).mime).toBe("image/png");
    expect(decodeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64")).mime).toBe("image/jpeg");
    expect(() => decodeImage(Buffer.from("GIF89a").toString("base64"))).toThrow(/PNG or JPEG/);
  });
  it("assertPublicUrl blocks loopback, private and metadata hosts", () => {
    for (const u of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.2", "http://192.168.1.1", "http://[::1]/", "http://metadata.google.internal", "file:///etc/passwd"]) {
      expect(() => assertPublicUrl(u), u).toThrow();
    }
    expect(assertPublicUrl("https://www.allbirds.com/").hostname).toBe("www.allbirds.com");
  });
});

describe("http transport", () => {
  const s = server();
  it("rejects unauthenticated calls when an authenticator is set", async () => {
    const h = createHttpHandler(s, { authenticate: async (req) => (req.headers.get("authorization") === "Bearer good" ? { principal: { kind: "account", id: "acct" } } : null) });
    const bad = await h(new Request("http://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }));
    expect(bad.status).toBe(401);
    const good = await h(new Request("http://x/mcp", { method: "POST", headers: { authorization: "Bearer good" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }));
    expect(await good.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
  it("returns 202 for notifications and 405 for GET", async () => {
    const h = createHttpHandler(s);
    expect((await h(new Request("http://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }))).status).toBe(202);
    expect((await h(new Request("http://x/mcp"))).status).toBe(405);
  });
});
