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

describe("Arthaus design-system blocks", () => {
  it("eyebrow — uppercase bronze kicker, escapes copy", () => {
    const html = renderBlock({ kind: "eyebrow", text: "New & now" }, theme);
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("letter-spacing:0.08em");
    expect(html).toContain("New &amp; now");
  });

  it("image — linked, escaped src/alt, fluid", () => {
    const html = renderBlock(
      { kind: "image", src: "https://cdn.example.com/a.jpg?q=1&w=2", alt: 'A "work"', href: "https://ex.com/p" },
      theme,
    );
    expect(html).toContain('src="https://cdn.example.com/a.jpg?q=1&amp;w=2"');
    expect(html).toContain('alt="A &quot;work&quot;"');
    expect(html).toContain("<a href=");
    expect(html).toContain("max-width:600px");
  });

  it("image — decorative renders empty alt + presentation role", () => {
    const html = renderBlock({ kind: "image", src: "https://cdn.example.com/d.png", decorative: true }, theme);
    expect(html).toContain('alt="" role="presentation"');
  });

  it("callout — bronze left border; emphasis uses the heading (serif) stack + italic", () => {
    const plain = renderBlock({ kind: "callout", text: "Quiet confidence." }, theme);
    expect(plain).toContain("border-left:3px solid");
    const emph = renderBlock({ kind: "callout", text: "A statement.", emphasis: true }, theme);
    expect(emph).toContain("font-style:italic");
  });

  it("ctaBand — eyebrow + headline + bulletproof VML button", () => {
    const html = renderBlock(
      { kind: "ctaBand", eyebrow: "Ready", heading: "Find something real", buttonText: "Explore", buttonHref: "https://ex.com" },
      theme,
    );
    expect(html).toContain("Ready");
    expect(html).toContain("Find something real");
    expect(html).toContain("v:roundrect"); // Outlook fallback
    expect(html).toContain('href="https://ex.com"');
    expect(html).toContain("Explore");
  });

  it("featuredCard — image with alt=title, price, arrowed link", () => {
    const html = renderBlock(
      { kind: "featuredCard", imageUrl: "https://cdn.example.com/s.jpg", title: "The Set", href: "https://ex.com/set", description: "Cohesive.", price: "$168" },
      theme,
    );
    expect(html).toContain('alt="The Set"');
    expect(html).toContain("$168");
    expect(html).toContain("Cohesive.");
    expect(html).toContain('href="https://ex.com/set"');
  });

  it("list — numbered emits ordinals; check emits checkmarks; feature has bordered rows", () => {
    const numbered = renderBlock({ kind: "list", style: "numbered", items: [{ title: "One" }, { title: "Two" }] }, theme);
    expect(numbered).toContain(">1<");
    expect(numbered).toContain(">2<");
    expect(numbered).toContain("One");
    const check = renderBlock({ kind: "list", style: "check", items: [{ title: "Guaranteed" }] }, theme);
    expect(check).toContain("&#10003;");
    const feature = renderBlock({ kind: "list", style: "feature", items: [{ title: "Framed", text: "Free" }] }, theme);
    expect(feature).toContain("border-bottom:1px solid");
  });

  it("swatches — circular chips carry the hex + name", () => {
    const html = renderBlock({ kind: "swatches", colors: [{ hex: "#B07D4F", name: "Bronze" }] }, theme);
    expect(html).toContain("background-color:#B07D4F");
    expect(html).toContain("border-radius:50%");
    expect(html).toContain("Bronze");
  });

  it("chips — rounded pills, escaped", () => {
    const html = renderBlock({ kind: "chips", items: ["Calm & warm"] }, theme);
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("Calm &amp; warm");
  });

  it("trustBadges — checkmarked, middot-joined", () => {
    const html = renderBlock({ kind: "trustBadges", items: ["Free shipping", "100-day"] }, theme);
    expect(html).toContain("&#10003; Free shipping");
    expect(html).toContain("&middot;");
  });

  it("divider — a visible hairline rule", () => {
    const html = renderBlock({ kind: "divider" }, theme);
    expect(html).toContain("height:1px");
  });
});

describe("graphCallout — the art-graph editorial module", () => {
  const block = {
    kind: "graphCallout" as const,
    label: "In a Similar Light",
    note: "Works that echo this one's palette, line & composition.",
    pieces: [
      { imageUrl: "https://cdn.example.com/a.jpg", title: "Alien 1", artist: "MIRIMO", href: "https://ex.com/a" },
      { imageUrl: "https://cdn.example.com/b.jpg", title: "Pine & Ash", href: "https://ex.com/b" },
    ],
  };
  const html = renderBlock(block, theme);

  it("renders the dimension label as the bronze uppercase kicker", () => {
    expect(html).toContain("In a Similar Light");
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("letter-spacing:0.08em");
  });

  it("renders the note in the brand serif italic, escaped", () => {
    expect(html).toContain("font-style:italic");
    expect(html).toContain("palette, line &amp; composition");
  });

  it("gives every piece a FIXED-HEIGHT band so captions align across aspect ratios", () => {
    const bands = [...html.matchAll(/height="190"/g)];
    expect(bands.length).toBe(block.pieces.length);
    expect(html).toContain("max-height:190px");
  });

  it("links each piece and credits the artist when known", () => {
    expect(html).toContain('href="https://ex.com/a"');
    expect(html).toContain("Alien 1");
    expect(html).toContain("MIRIMO");
    expect(html).toContain('alt="Alien 1 by MIRIMO"');
    // No artist → alt falls back to the title alone.
    expect(html).toContain('alt="Pine &amp; Ash"');
  });

  it("keeps the MSO ghost table so Outlook holds the columns", () => {
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("</td></tr></table><![endif]-->");
  });
});
