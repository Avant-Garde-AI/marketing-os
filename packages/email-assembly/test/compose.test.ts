/**
 * composePartials — the store-repo authoring seam, marker-compatible with
 * the proven Arthaus emails/scripts/compose.js.
 */
import { describe, expect, it } from "vitest";
import { composePartials, PARTIAL_MARKER_RE } from "../src/compose";

const partials = {
  head: "<head><title>Arthaus</title></head>",
  header: '<table role="presentation"><tr><td>ARTHAUS</td></tr></table>',
  footer: '<table role="presentation"><tr><td><a href="{% unsubscribe %}">Unsubscribe</a></td></tr></table>',
  "product-card": "<div>card</div>",
};

describe("composePartials — happy path", () => {
  const template = [
    "<!--PARTIAL:head-->",
    "<body>",
    "<!--PARTIAL:header-->",
    "<p>Hello {{ first_name }},</p>",
    "<!--PARTIAL:footer-->",
    "</body></html>",
  ].join("\n");

  const { html, report } = composePartials(template, partials);

  it("replaces every marker with its partial content", () => {
    expect(html).toContain("<title>Arthaus</title>");
    expect(html).toContain("ARTHAUS");
    expect(html).not.toContain("<!--PARTIAL:");
  });

  it("preserves Klaviyo Django tags verbatim (template AND partial content)", () => {
    expect(html).toContain("{{ first_name }}");
    expect(html).toContain('{% unsubscribe %}');
  });

  it("reports used partials in first-encounter order", () => {
    expect(report).toEqual({ used: ["head", "header", "footer"], missing: [] });
  });

  it("substitutes repeated markers everywhere (used reported once)", () => {
    const repeated = composePartials(
      "<!--PARTIAL:product-card--><!--PARTIAL:product-card-->",
      partials,
    );
    expect(repeated.html).toBe("<div>card</div><div>card</div>");
    expect(repeated.report.used).toEqual(["product-card"]);
  });
});

describe("composePartials — missing partials", () => {
  it("leaves the compose.js-compatible NOT FOUND comment and reports it", () => {
    const { html, report } = composePartials("<body><!--PARTIAL:hero--></body>", partials);
    expect(html).toBe('<body><!-- PARTIAL "hero" NOT FOUND --></body>');
    expect(report).toEqual({ used: [], missing: ["hero"] });
  });

  it("treats an empty-string partial as found (deliberate compose.js divergence)", () => {
    const { html, report } = composePartials("<body><!--PARTIAL:promo--></body>", { promo: "" });
    expect(html).toBe("<body></body>");
    expect(report).toEqual({ used: ["promo"], missing: [] });
  });
});

describe("composePartials — marker charset (identical to compose.js)", () => {
  it("matches \\w[\\w-]* names: hyphens ok, leading hyphen or dots are not markers", () => {
    expect(composePartials("<!--PARTIAL:product-card-->", partials).html).toBe("<div>card</div>");
    // Not valid marker names — left untouched, not reported missing.
    for (const bogus of ["<!--PARTIAL:-lead-->", "<!--PARTIAL:a.b-->", "<!--PARTIAL: spaced-->"]) {
      const { html, report } = composePartials(bogus, partials);
      expect(html).toBe(bogus);
      expect(report.missing).toEqual([]);
    }
  });

  it("exports the exact compose.js regex", () => {
    expect(PARTIAL_MARKER_RE.source).toBe("<!--PARTIAL:(\\w[\\w-]*)-->");
    expect(PARTIAL_MARKER_RE.flags).toBe("g");
  });
});

describe("composePartials — determinism + single pass", () => {
  it("double-run produces identical output", () => {
    const template = "<!--PARTIAL:head--><body><!--PARTIAL:footer--></body>";
    const a = composePartials(template, partials);
    const b = composePartials(template, partials);
    expect(b.html).toBe(a.html);
    expect(b.report).toEqual(a.report);
  });

  it("does NOT recursively resolve markers inside partial content (one pass)", () => {
    const { html, report } = composePartials("<!--PARTIAL:outer-->", {
      outer: "before <!--PARTIAL:inner--> after",
      inner: "NEVER",
    });
    expect(html).toBe("before <!--PARTIAL:inner--> after");
    expect(html).not.toContain("NEVER");
    expect(report.used).toEqual(["outer"]);
  });

  it("is not corrupted by `$` sequences in partial content", () => {
    const { html } = composePartials("<!--PARTIAL:price-->", { price: "now $99 ($& off $1)" });
    expect(html).toBe("now $99 ($& off $1)");
  });
});
