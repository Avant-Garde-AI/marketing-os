import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { extractSkeleton } from "../src/extract";
import { assembleEmail } from "../src/assemble";
import type { AssembleEmailInput, EmailSection } from "../src/types";
import { arthausTokens } from "./fixtures/tokens";

const dragDrop = readFileSync(join(__dirname, "fixtures", "drag-drop.html"), "utf8");
const extracted = extractSkeleton(dragDrop);
const skeleton = { html: extracted.skeletonHtml, slots: extracted.slots };

const KLAVIYO_IMG = "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/hero-board.png";

const baseSections: EmailSection[] = [
  {
    slot: "hero",
    type: "surface",
    imageUrl: KLAVIYO_IMG,
    alt: "Autumn arrivals: three framed botanical prints over a walnut console",
    width: 1200,
    height: 1500,
  },
  {
    slot: "body-1",
    type: "html",
    block: [
      { kind: "heading", text: "The Autumn Edit", level: 1 },
      {
        kind: "paragraph",
        text: "Twelve new studies from the studio, printed on archival cotton rag and framed in solid walnut.",
      },
    ],
  },
  {
    slot: "products",
    type: "html",
    block: {
      kind: "productRow",
      products: [
        {
          name: "Fern Study No. 2",
          price: "$185",
          href: "https://myarthaus.com/products/fern-study-no-2",
          imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/fern.png",
        },
        {
          name: "Coastal Grasses",
          price: "$210",
          href: "https://myarthaus.com/products/coastal-grasses",
          imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/grasses.png",
        },
      ],
    },
  },
  {
    slot: "cta",
    type: "html",
    block: { kind: "button", text: "Shop the Edit", href: "https://myarthaus.com/collections/autumn" },
  },
];

const baseMeta = {
  subject: "The Autumn Edit has landed",
  previewText: "Twelve new botanical studies, framed in walnut and ready to hang.",
  tokensVersion: "tokens-v7",
  designMdVersion: "2.0",
  skeletonVersion: "skel-2026-07-01",
};

const baseInput: AssembleEmailInput = {
  skeleton,
  sections: baseSections,
  tokens: arthausTokens,
  meta: baseMeta,
};

describe("assembleEmail — slot filling", () => {
  const { html, report } = assembleEmail(baseInput);

  it("passes the invariant gate on a complete campaign", () => {
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("replaces every slot marker with rendered content", () => {
    expect(html).not.toMatch(/\{\{slot:/);
    expect(html).toContain(KLAVIYO_IMG);
    expect(html).toContain("The Autumn Edit</h1>");
    expect(html).toContain("Fern Study No. 2");
    expect(html).toContain("Shop the Edit");
  });

  it("keeps the skeleton frame around the filled slots", () => {
    expect(html).toContain("arthaus-logo-charcoal.png");
    expect(html).toContain('<a href="{% unsubscribe %}"');
  });

  it("emits the hidden preview-text span right after <body>", () => {
    const bodyAt = html.search(/<body[^>]*>/i);
    const preheaderAt = html.indexOf("eab-preheader");
    expect(preheaderAt).toBeGreaterThan(bodyAt);
    expect(html).toContain("Twelve new botanical studies, framed in walnut and ready to hang.");
    expect(html).toContain("mso-hide:all");
  });

  it("stamps the lineage comment with the caller-supplied versions", () => {
    expect(html).toContain(
      "<!-- @avant-garde/email-assembly lineage tokens=tokens-v7 design=2.0 skeleton=skel-2026-07-01 -->",
    );
  });

  it("injects color-scheme metas and the dark-mode override block", () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("color:#efe9df !important"); // colors.text-dark
  });

  it("reports stats: html bytes, image count, text sections", () => {
    expect(report.stats.htmlBytes).toBe(new TextEncoder().encode(html).length);
    // frame logo + hero surface + 2 product images
    expect(report.stats.imageCount).toBe(4);
    expect(report.stats.textSections).toBe(3);
  });
});

describe("assembleEmail — determinism (04 §4: nonce hashing depends on it)", () => {
  it("double-run produces byte-identical output", () => {
    const first = assembleEmail(baseInput);
    const second = assembleEmail(baseInput);
    expect(second.html).toBe(first.html);
    expect(second.report).toEqual(first.report);
  });

  it("is not corrupted by `$` sequences in content (replacer-function discipline)", () => {
    const input: AssembleEmailInput = {
      ...baseInput,
      sections: [
        ...baseSections.slice(0, 2),
        {
          slot: "products",
          type: "html",
          block: { kind: "paragraph", text: "Every print is $185 — use code $&$' at checkout." },
        },
        ...baseSections.slice(3),
      ],
    };
    const { html } = assembleEmail(input);
    expect(html).toContain("Every print is $185 — use code $&amp;$' at checkout.");
  });
});

describe("assembleEmail — slot ordering semantics", () => {
  it("concatenates multiple sections targeting the same slot in sections[] order", () => {
    const input: AssembleEmailInput = {
      ...baseInput,
      sections: [
        ...baseSections,
        {
          slot: "body-1",
          type: "surface",
          imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/editorial.png",
          alt: "Studio wall with works in progress",
          width: 1200,
          height: 800,
        },
      ],
    };
    const { html, report } = assembleEmail(input);
    expect(report.ok).toBe(true);
    const headingAt = html.indexOf("The Autumn Edit</h1>");
    const editorialAt = html.indexOf("editorial.png");
    expect(headingAt).toBeGreaterThan(-1);
    expect(editorialAt).toBeGreaterThan(headingAt);
  });

  it("errors on a section targeting a slot the skeleton lacks", () => {
    const input: AssembleEmailInput = {
      ...baseInput,
      sections: [
        ...baseSections,
        { slot: "sidebar", type: "html", block: { kind: "paragraph", text: "no such slot here" } },
      ],
    };
    const { report } = assembleEmail(input);
    expect(report.ok).toBe(false);
    const err = report.errors.find((e) => e.code === "slot-unknown");
    expect(err?.message).toContain('"sidebar"');
    expect(err?.message).toContain("hero");
  });

  it("warns on an unfilled skeleton slot and strips its marker", () => {
    const input: AssembleEmailInput = { ...baseInput, sections: baseSections.slice(0, 3) };
    const { html, report } = assembleEmail(input);
    expect(html).not.toContain("{{slot:cta}}");
    expect(report.warnings.some((w) => w.code === "slot-unfilled" && w.message.includes('"cta"'))).toBe(
      true,
    );
  });
});

describe("assembleEmail — strict image-host mode (03 §5)", () => {
  const foreignSurface: EmailSection = {
    slot: "hero",
    type: "surface",
    imageUrl: "https://cdn.our-own-host.dev/exports/hero.png",
    alt: "Autumn hero board",
    width: 1200,
    height: 1500,
  };

  it("fails a non-Klaviyo image host in strict mode (default)", () => {
    const { report } = assembleEmail({
      ...baseInput,
      sections: [foreignSurface, ...baseSections.slice(1)],
    });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === "img-host-untrusted")).toBe(true);
  });

  it("accepts it when the host is allowlisted via options", () => {
    const { report } = assembleEmail({
      ...baseInput,
      sections: [foreignSurface, ...baseSections.slice(1)],
      options: {
        allowedImageHosts: ["*.klaviyo.com", "d3k81ch9hvuctc.cloudfront.net", "cdn.our-own-host.dev"],
      },
    });
    expect(report.errors).toEqual([]);
  });

  it("accepts it with strict:false (the ungated preview path)", () => {
    const { report } = assembleEmail({
      ...baseInput,
      sections: [foreignSurface, ...baseSections.slice(1)],
      options: { strict: false },
    });
    expect(report.errors).toEqual([]);
  });
});

describe("assembleEmail — input validation posture", () => {
  it("throws ZodError on malformed sections (programming error, not a report)", () => {
    const input = {
      ...baseInput,
      sections: [{ slot: "hero", type: "html", block: { kind: "marquee", text: "nope" } }],
    } as unknown as AssembleEmailInput;
    expect(() => assembleEmail(input)).toThrowError(ZodError);
  });

  it("throws ZodError on missing meta", () => {
    const input = { ...baseInput, meta: { subject: "x" } } as unknown as AssembleEmailInput;
    expect(() => assembleEmail(input)).toThrowError(ZodError);
  });
});

describe("assembleEmail — decorative surfaces", () => {
  it("renders decorative surfaces with empty alt + role=presentation", () => {
    const input: AssembleEmailInput = {
      ...baseInput,
      sections: [
        {
          slot: "hero",
          type: "surface",
          imageUrl: KLAVIYO_IMG,
          width: 1200,
          height: 300,
          decorative: true,
        },
        ...baseSections.slice(1),
      ],
    };
    const { html, report } = assembleEmail(input);
    expect(report.errors).toEqual([]);
    expect(html).toContain('alt="" role="presentation"');
  });
});
