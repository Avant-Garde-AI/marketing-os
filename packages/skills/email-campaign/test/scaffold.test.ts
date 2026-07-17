/**
 * WS2-R6 — the email design-system scaffold: determinism, tree shape,
 * composability against email-assembly (composePartials → extractSkeleton),
 * the compliance-load-bearing unsubscribe tags, and the README's agent
 * knowledge (Django-vs-Liquid table + token hexes).
 */

import { describe, expect, it } from "vitest";
import {
  checkColumnWidths,
  composePartials,
  extractSkeleton,
  findUnsubscribeTags,
} from "@avant-garde/email-assembly";
import { scaffoldEmailSystem, type ScaffoldEmailSystemOptions } from "../src/scaffold";
import { arthausTokens } from "./fixtures";

const opts: ScaffoldEmailSystemOptions = {
  storeName: "Arthaus",
  storeUrl: "https://myarthaus.com",
  legalAddress: "123 Main Street, Austin, TX 78701",
  fromAddress: "hello@myarthaus.com",
  version: "0.1.0",
};

const files = scaffoldEmailSystem(arthausTokens, opts);

/** partial name → content, as composePartials consumes them. */
function partials(fs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(fs)) {
    const m = /^email\/partials\/([\w-]+)\.html$/.exec(path);
    if (m && m[1]) out[m[1]] = content;
  }
  return out;
}

const TEMPLATE_PATHS = [
  "email/templates/editorial.html",
  "email/templates/product-reminder.html",
  "email/templates/winback.html",
] as const;

describe("scaffold shape + determinism", () => {
  it("produces exactly the 06 §2 seed tree", () => {
    expect(Object.keys(files).sort()).toEqual(
      [
        "email/README.md",
        "email/fixtures/sample-context.json",
        "email/partials/button.html",
        "email/partials/divider.html",
        "email/partials/footer.html",
        "email/partials/head.html",
        "email/partials/header.html",
        "email/partials/product-card.html",
        "email/registry.json",
        "email/templates/editorial.html",
        "email/templates/product-reminder.html",
        "email/templates/winback.html",
      ].sort(),
    );
  });

  it("double-run is byte-identical (pure — no clocks, no randomness)", () => {
    expect(scaffoldEmailSystem(arthausTokens, opts)).toEqual(files);
  });

  it("registry.json is the empty object, nothing else", () => {
    expect(files["email/registry.json"]).toBe("{}\n");
  });

  it("never throws on sparse tokens", () => {
    const sparse = scaffoldEmailSystem({}, { storeName: "Shop", storeUrl: "https://shop.example" });
    expect(Object.keys(sparse)).toHaveLength(12);
    expect(sparse["email/partials/head.html"]).toContain("#ffffff");
  });
});

describe("partials", () => {
  it("head.html keeps the frame contract: TITLE placeholder, reset, dark mode, MSO, token table", () => {
    const head = files["email/partials/head.html"] ?? "";
    expect(head).toContain("<!--TITLE-->");
    expect(head).toContain("o:OfficeDocumentSettings");
    expect(head).toContain("@media (prefers-color-scheme: dark)");
    expect(head).toContain("@media screen and (max-width: 480px)");
    expect(head).toContain('<meta name="color-scheme" content="light dark">');
    // Token table: CSS custom properties + literal hexes from the DTCG palette.
    expect(head).toContain("--color-bronze: #B07D4F;");
    expect(head).toContain("--color-surface: #F5F2ED;");
    expect(head).toContain("background-color: #F5F2ED;");
    // Body stack derives from typography tokens with guaranteed generic fallback.
    expect(head).toMatch(/font-family: Inter, .*sans-serif;/);
  });

  it("header.html is the uppercase wordmark in the brand serif on the ink bar, linking the store", () => {
    const header = files["email/partials/header.html"] ?? "";
    expect(header).toContain(">ARTHAUS</span>");
    expect(header).toContain('href="https://myarthaus.com"');
    expect(header).toContain("background-color: #2D2D2D");
    expect(header).toMatch(/font-family: Canela, 'Freight Display'/);
    expect(header).toContain("text-transform: uppercase");
  });

  it("footer.html carries the load-bearing Klaviyo tags byte-verbatim + the legal line", () => {
    const footer = files["email/partials/footer.html"] ?? "";
    expect(footer).toContain("{% unsubscribe %}");
    expect(footer).toContain("{% manage_preferences %}");
    expect(footer).toContain("Arthaus · 123 Main Street, Austin, TX 78701");
    expect(footer).toContain("LOAD-BEARING"); // the in-HTML compliance warning
    expect(findUnsubscribeTags(footer)).toContain("{% unsubscribe %}");
  });

  it("footer address falls back to a visible placeholder when no legalAddress given", () => {
    const bare = scaffoldEmailSystem(arthausTokens, { storeName: "Shop", storeUrl: "https://s.example" });
    expect(bare["email/partials/footer.html"]).toContain("SET-YOUR-MAILING-ADDRESS");
  });

  it("button.html keeps the VML Outlook fallback with token colors", () => {
    const button = files["email/partials/button.html"] ?? "";
    expect(button).toContain("v:roundrect");
    expect(button).toContain('fillcolor="#2D2D2D"');
    expect(button).toContain("BUTTON_URL");
    expect(button).toContain("BUTTON_LABEL");
  });

  it("no partial or template writes merge-tag syntax inside an HTML comment (Klaviyo parses comments)", () => {
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith(".html")) continue;
      for (const m of content.matchAll(/<!--(?:(?!-->)[\s\S])*-->/g)) {
        expect(m[0], `${path}: ${m[0].slice(0, 60)}`).not.toMatch(/\{%|\{\{/);
      }
    }
  });
});

describe("templates compose + extract (email-assembly round-trip)", () => {
  const parts = partials(files);

  it("every starter template composes with the scaffolded partials — no missing partials", () => {
    for (const path of TEMPLATE_PATHS) {
      const { html, report } = composePartials(files[path] ?? "", parts);
      expect(report.missing, path).toEqual([]);
      expect(report.used, path).toEqual(expect.arrayContaining(["head", "header", "footer"]));
      expect(html).not.toContain("<!--PARTIAL:");
      expect(html).not.toContain("NOT FOUND");
    }
  });

  it("every composed template keeps the ≤600px single-column frame and the unsubscribe tags", () => {
    for (const path of TEMPLATE_PATHS) {
      const { html } = composePartials(files[path] ?? "", parts);
      expect(checkColumnWidths(html), path).toEqual([]);
      expect(findUnsubscribeTags(html).length, path).toBeGreaterThan(0);
    }
  });

  it("the composed editorial passes extractSkeleton without invariant violations", () => {
    const { html } = composePartials(files["email/templates/editorial.html"] ?? "", parts);
    const skeleton = extractSkeleton(html);
    expect(skeleton.slots.length).toBeGreaterThanOrEqual(1);
    expect(findUnsubscribeTags(skeleton.skeletonHtml).length).toBeGreaterThan(0);
    expect(checkColumnWidths(skeleton.skeletonHtml)).toEqual([]);
  });

  it("templates keep Klaviyo Django tags verbatim and use no Shopify-only filters", () => {
    for (const path of TEMPLATE_PATHS) {
      const t = files[path] ?? "";
      expect(t).not.toMatch(/\|\s*(money|img_url|truncatewords|slice)\b/);
      expect(t).not.toMatch(/\{%\s*for\b[^%]*\blimit:/);
      expect(t).not.toMatch(/\{%\s*assign\b/);
    }
    expect(files["email/templates/winback.html"]).toContain("{{ discount.code }}");
    expect(files["email/templates/editorial.html"]).toContain("{% for item in editorial.products %}");
  });
});

describe("README + fixtures", () => {
  const readme = files["email/README.md"] ?? "";

  it("carries the Klaviyo Django vs Shopify Liquid table (the Arthaus knowledge)", () => {
    expect(readme).toContain("Klaviyo Django vs Shopify Liquid");
    expect(readme).toContain("truncatewords");
    expect(readme).toContain("Never write template syntax in comments");
    expect(readme).toContain("Shopify-only filters");
  });

  it("documents the actual token hexes and font stacks it scaffolded", () => {
    expect(readme).toContain("#F5F2ED");
    expect(readme).toContain("#B07D4F");
    expect(readme).toContain("#2D2D2D");
    expect(readme).toContain("`bronze`");
    expect(readme).toMatch(/display: `Canela, 'Freight Display'/);
    expect(readme).toContain("IBM Plex Mono");
  });

  it("explains the tree, the PARTIAL convention, and registry discipline", () => {
    expect(readme).toContain("<!--PARTIAL:head-->");
    expect(readme).toContain("registry.json");
    expect(readme).toContain("PATCH");
    expect(readme).toContain("strategy.md");
    expect(readme).toContain("brand.md");
    expect(readme).toContain("hello@myarthaus.com");
  });

  it("stamps the caller-supplied version (never a clock)", () => {
    expect(readme).toContain("v0.1.0");
    expect(files["email/partials/head.html"]).toContain("v0.1.0");
  });

  it("sample-context.json is valid JSON matching the starter templates' variables", () => {
    const ctx = JSON.parse(files["email/fixtures/sample-context.json"] ?? "");
    expect(ctx.first_name).toBeDefined();
    expect(ctx.shop_url).toBe("https://myarthaus.com");
    expect(ctx.editorial.title).toBeDefined();
    expect(ctx.editorial.products[0].image_url).toBeDefined();
    expect(ctx.editorial.products[0].price).toBeDefined();
    expect(ctx.product.checkout_url).toBeDefined();
    expect(ctx.product.variant).toBeDefined();
    expect(ctx.discount.code).toBeDefined();
    expect(ctx.discount.percent_off).toBeDefined();
  });
});
