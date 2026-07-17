import { describe, expect, it } from "vitest";
import { renderBlock, renderSurface, escapeHtml, escapeAttr } from "../src/renderers";
import { resolveEmailTheme } from "../src/css";
import { arthausTokens } from "./fixtures/tokens";

const theme = resolveEmailTheme(arthausTokens);

describe("escaping", () => {
  it("escapes text content (ampersand first)", () => {
    expect(escapeHtml("Frames & prints <soon>")).toBe("Frames &amp; prints &lt;soon&gt;");
  });

  it("escapes attribute quotes", () => {
    expect(escapeAttr('say "hello" & go')).toBe("say &quot;hello&quot; &amp; go");
  });
});

describe("paragraph renderer", () => {
  const html = renderBlock({ kind: "paragraph", text: 'Prints & frames, <br> "quoted"' }, theme);

  it("escapes user copy — the vocabulary never passes HTML through", () => {
    expect(html).toContain("Prints &amp; frames, &lt;br&gt;");
    expect(html).not.toContain("<br>");
  });

  it("applies token typography and color inline with Outlook line-height pinning", () => {
    expect(html).toContain("font-family:'Untitled Sans', Helvetica, Arial, sans-serif");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("line-height:24px;mso-line-height-rule:exactly");
    expect(html).toContain("color:#1f1c17"); // {colors.text} → {colors.ink}
  });

  it("wraps in a presentation table (email structural discipline)", () => {
    expect(html).toMatch(/^<table role="presentation" width="100%"/);
  });
});

describe("heading renderer", () => {
  it("renders a real h-tag per level with derived sizes", () => {
    const h1 = renderBlock({ kind: "heading", text: "The Edit", level: 1 }, theme);
    const h3 = renderBlock({ kind: "heading", text: "Details", level: 3 }, theme);
    expect(h1).toContain("<h1 ");
    expect(h1).toContain("font-size:32px"); // typography.heading fontSize
    expect(h1).toContain("font-family:Canela, Georgia, serif");
    expect(h1).toContain("font-weight:600");
    expect(h3).toContain("<h3 ");
    expect(h3).toContain("font-size:20px"); // 32 × 0.625
  });

  it("defaults to level 2", () => {
    expect(renderBlock({ kind: "heading", text: "Mid" }, theme)).toContain("<h2 ");
  });
});

describe("button renderer (bulletproof VML)", () => {
  const html = renderBlock(
    { kind: "button", text: "Shop the Edit", href: "https://myarthaus.com/collections/new?a=1&b=2" },
    theme,
  );

  it("emits the MSO v:roundrect fallback AND the styled anchor", () => {
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain("<w:anchorlock/>");
    expect(html).toContain('<!--[if !mso]><!--><a href=');
    expect(html).toContain("<!--<![endif]-->");
  });

  it("uses the component button tokens for fill and ink", () => {
    expect(html).toContain('fillcolor="#8a6d3b"'); // components.button.backgroundColor → {colors.bronze}
    expect(html).toContain("background-color:#8a6d3b");
    expect(html).toContain("color:#ffffff");
    expect(html).toContain("border-radius:4px");
  });

  it("escapes the href in both variants", () => {
    const matches = html.match(/href="https:\/\/myarthaus\.com\/collections\/new\?a=1&amp;b=2"/g);
    expect(matches).toHaveLength(2);
  });

  it("derives a deterministic VML width from the label", () => {
    expect(html).toContain("width:160px;"); // 48 + ceil(13 × 8.5) = 159, clamped to the 160 floor
  });
});

describe("productRow renderer (fluid-hybrid stacking)", () => {
  const html = renderBlock(
    {
      kind: "productRow",
      products: [
        {
          name: "Fern Study No. 2",
          price: "$185",
          href: "https://myarthaus.com/p/fern",
          imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/c/fern.png",
        },
        { name: "Coastal Grasses", price: "$210", href: "https://myarthaus.com/p/grasses" },
      ],
    },
    theme,
  );

  it("emits inline-block columns with the mobile-stacking class", () => {
    expect(html.match(/class="eab-col"/g)).toHaveLength(2);
    expect(html).toContain("display:inline-block");
    expect(html).toContain("font-size:0"); // kills inter-column whitespace gaps
  });

  it("emits the MSO ghost table with per-column widths", () => {
    expect(html).toContain('<!--[if mso]><table role="presentation" width="552"');
    expect(html.match(/<td width="276" valign="top">/g)).toHaveLength(2);
    expect(html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
  });

  it("falls back to the product name for image alt (alt invariant by construction)", () => {
    expect(html).toContain('alt="Fern Study No. 2"');
  });

  it("renders products without images as text-only cards", () => {
    expect(html).toContain("Coastal Grasses");
    expect(html.match(/<img /g)).toHaveLength(1);
  });
});

describe("spacer renderer", () => {
  it("uses the fixed-height td + nbsp pattern, hidden from screen readers", () => {
    const html = renderBlock({ kind: "spacer", height: 32 }, theme);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("height:32px;line-height:32px;font-size:1px;");
    expect(html).toContain("&nbsp;");
  });
});

describe("surface renderer", () => {
  it("displays @2x exports at ≤600 CSS px with proportional height", () => {
    const html = renderSurface(
      {
        slot: "hero",
        type: "surface",
        imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/c/hero.png",
        alt: "Hero board",
        width: 1200,
        height: 1500,
      },
      theme,
    );
    expect(html).toContain('width="600" height="750"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain('alt="Hero board"');
    expect(html).toContain("display:block");
  });

  it("marks decorative surfaces for the accessibility tree", () => {
    const html = renderSurface(
      {
        slot: "hero",
        type: "surface",
        imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/c/divider.png",
        width: 1200,
        height: 60,
        decorative: true,
      },
      theme,
    );
    expect(html).toContain('alt="" role="presentation"');
  });
});
