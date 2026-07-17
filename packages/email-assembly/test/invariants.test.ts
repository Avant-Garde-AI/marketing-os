/**
 * One failing test per 04 §6 invariant (WS2-R4 acceptance). Each case
 * assembles a REAL campaign with exactly one violation injected, and asserts
 * the report fails with the matching code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSkeleton } from "../src/extract";
import { assembleEmail } from "../src/assemble";
import { checkAssembledEmail, findMergeTags, findUnsubscribeTags, hostAllowed } from "../src/invariants";
import type { AssembleEmailInput, EmailSection } from "../src/types";
import { arthausTokens } from "./fixtures/tokens";

const dragDrop = readFileSync(join(__dirname, "fixtures", "drag-drop.html"), "utf8");
const extracted = extractSkeleton(dragDrop);
const skeleton = { html: extracted.skeletonHtml, slots: extracted.slots };

const KLAVIYO_IMG = "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/board.png";

const goodSections: EmailSection[] = [
  {
    slot: "hero",
    type: "surface",
    imageUrl: KLAVIYO_IMG,
    alt: "Hero board",
    width: 1200,
    height: 1500,
  },
  {
    slot: "body-1",
    type: "html",
    block: { kind: "paragraph", text: "A real paragraph of campaign copy, long enough to count." },
  },
  {
    slot: "cta",
    type: "html",
    block: { kind: "button", text: "Shop now", href: "https://myarthaus.com/collections/new" },
  },
];

const goodMeta = {
  subject: "New arrivals in the studio",
  previewText: "Fresh botanical studies, framed in walnut, shipping this week.",
};

const goodInput: AssembleEmailInput = {
  skeleton,
  sections: goodSections,
  tokens: arthausTokens,
  meta: goodMeta,
};

function expectSingleFailure(input: AssembleEmailInput, code: string): void {
  const { report } = assembleEmail(input);
  expect(report.ok).toBe(false);
  expect(report.errors.map((e) => e.code)).toContain(code);
}

describe("invariant 1 — unsubscribe present and untouched", () => {
  it("fails when the skeleton's unsubscribe tag is missing", () => {
    const tampered = {
      html: skeleton.html.replace('<a href="{% unsubscribe %}" style="color:#6b6155;text-decoration:underline;">Unsubscribe</a> &middot;', ""),
      slots: skeleton.slots,
    };
    expectSingleFailure({ ...goodInput, skeleton: tampered }, "unsubscribe-missing");
  });

  it("fails when the unsubscribe merge tag was rewritten by a broken transform", () => {
    // Simulate a URL-encoder mangling the merge tag inside the href — the
    // tag family no longer parses and the href no longer says unsubscribe.
    const tampered = {
      html: skeleton.html.replace('href="{% unsubscribe %}"', 'href="%7B%%20unsub%20%%7D"'),
      slots: skeleton.slots,
    };
    const { report } = assembleEmail({ ...goodInput, skeleton: tampered });
    // The tag family is gone from hrefs → hard unsubscribe failure.
    expect(report.errors.some((e) => e.code === "unsubscribe-missing")).toBe(true);
  });
});

describe("invariant 1b — Klaviyo Django tags preserved verbatim", () => {
  it("fails when a skeleton merge tag does not survive assembly byte-for-byte", () => {
    // A skeleton carrying personalization in the frame; simulate an upstream
    // transform that entity-escapes it by checking the assembled html against
    // the ORIGINAL skeleton via checkAssembledEmail directly.
    const skeletonWithTag = skeleton.html.replace(
      "You&rsquo;re receiving this",
      "Hi {{ first_name|default:\"there\" }}, you&rsquo;re receiving this",
    );
    const assembled = assembleEmail({
      ...goodInput,
      skeleton: { html: skeletonWithTag, slots: skeleton.slots },
    });
    expect(assembled.report.ok).toBe(true); // the honest path preserves it

    const mangled = assembled.html.replace(
      '{{ first_name|default:"there" }}',
      "{{ first_name|default:&quot;there&quot; }}",
    );
    const result = checkAssembledEmail(mangled, {
      skeletonHtml: skeletonWithTag,
      sections: goodSections,
      meta: goodMeta,
      strict: true,
      allowedImageHosts: ["d3k81ch9hvuctc.cloudfront.net"],
    });
    expect(result.errors.some((e) => e.code === "merge-tag-altered")).toBe(true);
  });

  it("findMergeTags ignores our own slot markers", () => {
    expect(findMergeTags("{{slot:hero}} {% unsubscribe %} {{ first_name }}")).toEqual([
      "{% unsubscribe %}",
      "{{ first_name }}",
    ]);
  });
});

describe("invariant 2 — alt text + image host discipline", () => {
  it("fails on a surface with no alt and no decorative marking", () => {
    const sections: EmailSection[] = [
      { slot: "hero", type: "surface", imageUrl: KLAVIYO_IMG, width: 1200, height: 1500 },
      ...goodSections.slice(1),
    ];
    expectSingleFailure({ ...goodInput, sections }, "img-alt-missing");
  });

  it("fails on a non-Klaviyo image host in strict mode", () => {
    const sections: EmailSection[] = [
      {
        slot: "hero",
        type: "surface",
        imageUrl: "https://evil-cdn.example.net/hero.png",
        alt: "Hero board",
        width: 1200,
        height: 1500,
      },
      ...goodSections.slice(1),
    ];
    expectSingleFailure({ ...goodInput, sections }, "img-host-untrusted");
  });

  it("fails on a data: URI in strict mode (no host = not Klaviyo-hosted)", () => {
    const sections: EmailSection[] = [
      {
        slot: "hero",
        type: "surface",
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        alt: "Hero board",
        width: 1200,
        height: 1500,
      },
      ...goodSections.slice(1),
    ];
    expectSingleFailure({ ...goodInput, sections }, "img-host-untrusted");
  });

  it("hostAllowed matches wildcard subdomains and exact hosts", () => {
    expect(hostAllowed("static.klaviyo.com", ["*.klaviyo.com"])).toBe(true);
    expect(hostAllowed("klaviyo.com", ["*.klaviyo.com"])).toBe(true);
    expect(hostAllowed("klaviyo.com.evil.net", ["*.klaviyo.com"])).toBe(false);
    expect(hostAllowed("d3k81ch9hvuctc.cloudfront.net", ["d3k81ch9hvuctc.cloudfront.net"])).toBe(true);
    expect(hostAllowed("other.cloudfront.net", ["d3k81ch9hvuctc.cloudfront.net"])).toBe(false);
  });
});

describe("invariant 3 — single column, weight, clipping", () => {
  it("fails when a structural element exceeds 600px", () => {
    const tampered = {
      html: skeleton.html.replace('width="600"', 'width="720"'),
      slots: skeleton.slots,
    };
    expectSingleFailure({ ...goodInput, skeleton: tampered }, "column-too-wide");
  });

  it("fails when assembled HTML exceeds 100KB (Gmail clips ~102KB)", () => {
    const bloat: EmailSection = {
      slot: "body-1",
      type: "html",
      block: Array.from({ length: 60 }, () => ({
        kind: "paragraph" as const,
        text: "x".repeat(2000),
      })),
    };
    expectSingleFailure({ ...goodInput, sections: [...goodSections, bloat] }, "html-too-large");
  });

  it("warns (not fails) between 80KB and 100KB", () => {
    const bloat: EmailSection = {
      slot: "body-1",
      type: "html",
      block: Array.from({ length: 36 }, () => ({
        kind: "paragraph" as const,
        text: "x".repeat(2000),
      })),
    };
    const { report } = assembleEmail({ ...goodInput, sections: [...goodSections, bloat] });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === "html-large")).toBe(true);
  });

  it("warns when declared image weight exceeds 1.5MB", () => {
    const sections: EmailSection[] = [
      { ...goodSections[0]!, byteSize: 900_000 } as EmailSection,
      {
        slot: "products",
        type: "surface",
        imageUrl: KLAVIYO_IMG,
        alt: "Product board",
        width: 1200,
        height: 740,
        byteSize: 700_000,
      },
      ...goodSections.slice(1),
    ];
    const { report } = assembleEmail({ ...goodInput, sections });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === "image-weight")).toBe(true);
  });
});

describe("invariant 4 — links resolve, decoration-compatible", () => {
  it("fails on a fragment-only href", () => {
    const sections: EmailSection[] = [
      ...goodSections,
      {
        slot: "products",
        type: "html",
        block: {
          kind: "productRow",
          products: [{ name: "Fern Study", price: "$185", href: "#products" }],
        },
      },
    ];
    expectSingleFailure({ ...goodInput, sections }, "link-unresolvable");
  });

  it("fails on a mailto CTA (breaks click tracking + UTM decoration)", () => {
    const sections: EmailSection[] = [
      ...goodSections.slice(0, 2),
      {
        slot: "cta",
        type: "html",
        block: { kind: "button", text: "Email us", href: "mailto:studio@myarthaus.com" },
      },
    ];
    expectSingleFailure({ ...goodInput, sections }, "cta-mailto");
  });

  it("allows merge-tag hrefs (Klaviyo resolves them at send time)", () => {
    const { report } = assembleEmail(goodInput);
    // The skeleton footer's {% unsubscribe %} / {% manage_preferences %}
    // hrefs must not trip the link checker.
    expect(report.errors).toEqual([]);
  });
});

describe("invariant 5 — text-to-image sanity + envelope budgets", () => {
  it("fails an all-image email (no non-trivial HTML text section)", () => {
    const sections: EmailSection[] = [
      goodSections[0]!,
      {
        slot: "body-1",
        type: "surface",
        imageUrl: KLAVIYO_IMG,
        alt: "Copy rendered as pixels — the anti-pattern",
        width: 1200,
        height: 800,
      },
    ];
    expectSingleFailure({ ...goodInput, sections }, "no-text-section");
  });

  it("counts a tiny text fragment as trivial", () => {
    const sections: EmailSection[] = [
      goodSections[0]!,
      { slot: "body-1", type: "html", block: { kind: "paragraph", text: "Shop now." } },
    ];
    expectSingleFailure({ ...goodInput, sections }, "no-text-section");
  });

  it("warns on a subject over ~60 chars", () => {
    const { report } = assembleEmail({
      ...goodInput,
      meta: {
        ...goodMeta,
        subject: "The Autumn Edit has landed — twelve new botanical studies framed in walnut",
      },
    });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === "subject-long")).toBe(true);
  });

  it("warns on preview text outside the 40–130 char window", () => {
    const short = assembleEmail({ ...goodInput, meta: { ...goodMeta, previewText: "New prints." } });
    expect(short.report.warnings.some((w) => w.code === "preview-length")).toBe(true);
    const long = assembleEmail({
      ...goodInput,
      meta: { ...goodMeta, previewText: "p".repeat(140) },
    });
    expect(long.report.warnings.some((w) => w.code === "preview-length")).toBe(true);
  });
});

describe("invariant 6 — lineage stamped", () => {
  it("assembleEmail always stamps lineage (unversioned placeholders allowed)", () => {
    const { html } = assembleEmail(goodInput);
    expect(html).toContain(
      "<!-- @avant-garde/email-assembly lineage tokens=unversioned design=unversioned skeleton=unversioned -->",
    );
  });

  it("checkAssembledEmail fails HTML with no lineage comment", () => {
    const result = checkAssembledEmail("<html><head></head><body><p>x</p></body></html>", {
      skeletonHtml: skeleton.html,
      sections: goodSections,
      meta: goodMeta,
      strict: false,
      allowedImageHosts: [],
    });
    expect(result.errors.some((e) => e.code === "lineage-missing")).toBe(true);
  });
});

describe("unsubscribe tag detection", () => {
  it("recognizes the Klaviyo tag family and unsubscribe hrefs", () => {
    expect(findUnsubscribeTags("{% unsubscribe %}")).toHaveLength(1);
    expect(findUnsubscribeTags("{% unsubscribe_url %}")).toHaveLength(1);
    expect(findUnsubscribeTags("{{ unsubscribe_link }}")).toHaveLength(1);
    expect(findUnsubscribeTags('<a href="https://x.com/unsubscribe?u=1">bye</a>')).toHaveLength(1);
    expect(findUnsubscribeTags("{% manage_preferences %} plain text")).toHaveLength(0);
  });
});
