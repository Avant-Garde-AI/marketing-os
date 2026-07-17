/**
 * Golden-file test (WS2-R4 acceptance): a full campaign — skeleton from the
 * drag-drop fixture + 2 surface sections + 3 html sections + the Arthaus-
 * shaped DTCG token set — must assemble to the committed golden HTML
 * BYTE-FOR-BYTE, twice (byte-identical output is what approval-nonce hashing
 * rides on).
 *
 * Regenerate deliberately with UPDATE_GOLDEN=1 after a reviewed renderer
 * change; a diff in this file's assertion is a change to what ships to
 * subscribers and should be reviewed like one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSkeleton } from "../src/extract";
import { assembleEmail } from "../src/assemble";
import type { AssembleEmailInput } from "../src/types";
import { arthausTokens } from "./fixtures/tokens";

const GOLDEN_PATH = join(__dirname, "golden", "arthaus-campaign.html");

const dragDrop = readFileSync(join(__dirname, "fixtures", "drag-drop.html"), "utf8");
const extracted = extractSkeleton(dragDrop);

const campaign: AssembleEmailInput = {
  skeleton: { html: extracted.skeletonHtml, slots: extracted.slots },
  sections: [
    // 2 surface sections (design-surface board exports, @2x)
    {
      slot: "hero",
      type: "surface",
      imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/autumn-hero-board.png",
      alt: "Autumn arrivals: three framed botanical prints over a walnut console",
      width: 1200,
      height: 1500,
      byteSize: 412_000,
    },
    {
      slot: "cta",
      type: "surface",
      imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/promo-banner-board.png",
      alt: "Free framing on orders over $300 through Sunday",
      width: 1200,
      height: 400,
      byteSize: 96_000,
    },
    // 3 html sections (copy stays HTML — the 04 §0 dividing rule)
    {
      slot: "body-1",
      type: "html",
      block: [
        { kind: "heading", text: "The Autumn Edit", level: 1 },
        {
          kind: "paragraph",
          text: "Twelve new botanical studies from the studio — printed on archival cotton rag, framed in solid walnut, and ready to hang the week they arrive.",
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
            imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/fern-study-no-2.png",
          },
          {
            name: "Coastal Grasses",
            price: "$210",
            href: "https://myarthaus.com/products/coastal-grasses",
            imageUrl: "https://d3k81ch9hvuctc.cloudfront.net/company/UvSyxk/images/coastal-grasses.png",
          },
        ],
      },
    },
    {
      slot: "cta",
      type: "html",
      block: [
        { kind: "button", text: "Shop the Autumn Edit", href: "https://myarthaus.com/collections/autumn-edit" },
        { kind: "spacer", height: 24 },
      ],
    },
  ],
  tokens: arthausTokens,
  meta: {
    subject: "The Autumn Edit has landed",
    previewText: "Twelve new botanical studies, framed in walnut and ready to hang.",
    tokensVersion: "arthaus-tokens-v7",
    designMdVersion: "2.0",
    skeletonVersion: "drag-drop-2026-07-01",
  },
};

describe("golden campaign", () => {
  const first = assembleEmail(campaign);

  it("passes the full invariant gate", () => {
    expect(first.report.errors).toEqual([]);
    expect(first.report.ok).toBe(true);
    expect(first.report.stats.textSections).toBe(3);
  });

  it("matches the committed golden HTML byte-for-byte", () => {
    if (!existsSync(GOLDEN_PATH) || process.env["UPDATE_GOLDEN"]) {
      mkdirSync(join(__dirname, "golden"), { recursive: true });
      writeFileSync(GOLDEN_PATH, first.html, "utf8");
    }
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(first.html).toBe(golden);
  });

  it("re-runs to byte-identical output (determinism)", () => {
    const second = assembleEmail(campaign);
    const third = assembleEmail(campaign);
    expect(second.html).toBe(first.html);
    expect(third.html).toBe(first.html);
    expect(second.report).toEqual(first.report);
  });

  it("extraction is deterministic too (skeleton feeds the nonce)", () => {
    const again = extractSkeleton(dragDrop);
    expect(again.skeletonHtml).toBe(extracted.skeletonHtml);
  });
});
