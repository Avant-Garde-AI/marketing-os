/**
 * WS2-R2 — email compose templates: geometry, edge-to-edge backgrounds
 * (the 04 §5 dark-mode rule), payload schema validation, determinism, and
 * sparse-token fallbacks.
 */

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  EMAIL_BOARD_GEOMETRY,
  EMAIL_BOARD_WIDTH,
  editorialMoment,
  editorialMomentPayloadSchema,
  emailComposeTemplates,
  hero,
  heroPayloadSchema,
  productFeature,
  productFeaturePayloadSchema,
  promoBanner,
  promoBannerPayloadSchema,
  type EmailBoardSpec,
  type EmailComposeElement,
} from "../src/compose-templates";
import { resolveEmailBrandTheme } from "../src/brand-tokens";
import { arthausTokens } from "./fixtures";

const png = () => ({ data: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png" as const });

/** Compose one board of each template with Arthaus fixture tokens. */
function allBoards(): [string, EmailBoardSpec][] {
  return [
    ["hero", hero(arthausTokens, { headline: "The Autumn Edit", eyebrow: "New Arrivals", image: png() })],
    ["promoBanner", promoBanner(arthausTokens, { headline: "10% off framed prints", subline: "This week only" })],
    ["productFeature", productFeature(arthausTokens, { image: png(), displayName: "Botanical Study No. 4" })],
    ["editorialMoment", editorialMoment(arthausTokens, { image: png() })],
  ];
}

function textElements(board: EmailBoardSpec): Extract<EmailComposeElement, { type: "text" }>[] {
  return board.elements.filter((e): e is Extract<EmailComposeElement, { type: "text" }> => e.type === "text");
}

describe("token resolution (Arthaus fixture)", () => {
  it("resolves the Arthaus palette through DTCG aliases", () => {
    const t = resolveEmailBrandTheme(arthausTokens);
    expect(t.surface).toBe("#F5F2ED"); // colors.background → {colors.warm-parchment}
    expect(t.ink).toBe("#2D2D2D"); // colors.text → {colors.charcoal}
    expect(t.accent).toBe("#B07D4F"); // colors.primary → {colors.bronze}
    expect(t.muted).toBe("#6B6560");
    expect(t.card).toBe("#FFFFFF"); // background-transactional
    expect(t.displayFamily).toBe("Canela");
    expect(t.displayFontId).toBe("gfont-canela");
    expect(t.bodyFontId).toBe("gfont-inter");
    expect(t.monoStack).toContain("monospace");
    expect(t.palette).toContainEqual({ name: "bronze", hex: "#B07D4F" });
    // Aliased entries resolve to hexes in the palette listing too.
    expect(t.palette).toContainEqual({ name: "primary", hex: "#B07D4F" });
  });

  it("degrades to documented email-safe defaults on absent/sparse tokens", () => {
    for (const t of [resolveEmailBrandTheme(undefined), resolveEmailBrandTheme({})]) {
      expect(t.surface).toBe("#ffffff");
      expect(t.ink).toBe("#1a1a1a");
      expect(t.border).toBe("#e5e5e5");
      expect(t.card).toBe("#ffffff");
      expect(t.monoStack).toBeNull();
      expect(t.palette).toEqual([]);
      expect(t.displayStack).toContain("serif");
      expect(t.bodyStack).toContain("sans-serif");
    }
  });
});

describe("board geometry (04 §2)", () => {
  it("every template composes at 600 logical width with its spec height", () => {
    const expected: Record<string, { width: number; height: number }> = {
      hero: { width: 600, height: 750 },
      promoBanner: { width: 600, height: 200 },
      productFeature: { width: 600, height: 740 },
      editorialMoment: { width: 600, height: 600 },
    };
    for (const [name, board] of allBoards()) {
      expect({ width: board.width, height: board.height }).toEqual(expected[name]);
      expect(EMAIL_BOARD_GEOMETRY[name as keyof typeof EMAIL_BOARD_GEOMETRY]).toEqual(expected[name]);
    }
    expect(EMAIL_BOARD_WIDTH).toBe(600);
  });

  it("every element stays inside its board bounds", () => {
    for (const [, board] of allBoards()) {
      for (const el of board.elements) {
        expect(el.x).toBeGreaterThanOrEqual(0);
        expect(el.y).toBeGreaterThanOrEqual(0);
        expect(el.x + el.width).toBeLessThanOrEqual(board.width);
        expect(el.y + el.height).toBeLessThanOrEqual(board.height);
      }
    }
  });
});

describe("backgrounds reach the board edges (04 §5 dark-mode rule)", () => {
  it("every template carries a board-level background fill with explicit opacity", () => {
    for (const [name, board] of allBoards()) {
      expect(board.background, `${name} board background`).toBeDefined();
      expect(board.background?.fillOpacity).toBe(1);
    }
  });

  it("hero + productFeature + editorialMoment mat on the token surface (parchment)", () => {
    for (const [, board] of allBoards().filter(([n]) => n !== "promoBanner")) {
      expect(board.background?.fillColor).toBe("#F5F2ED");
    }
  });

  it("every fill everywhere is explicit-opacity (the Penpot text-fill quirk)", () => {
    for (const [name, board] of allBoards()) {
      for (const el of board.elements) {
        if (el.type === "image") continue;
        for (const f of el.fills ?? []) {
          expect(f.fillOpacity, `${name}/${el.name} fill`).toBe(1);
        }
      }
    }
  });
});

describe("hero", () => {
  it("composes image full-bleed, tracked accent eyebrow, brand-serif headline", () => {
    const board = hero(arthausTokens, {
      headline: "The Autumn Edit",
      eyebrow: "New Arrivals",
      image: png(),
    });
    expect(board.name).toBe("hero");

    const image = board.elements.find((e) => e.type === "image");
    expect(image).toMatchObject({ x: 0, y: 0, width: 600 });

    const [eyebrow, headline] = textElements(board);
    expect(eyebrow?.characters).toBe("N E W   A R R I V A L S"); // uppercase + tracked
    expect(eyebrow?.fills).toEqual([{ fillColor: "#B07D4F", fillOpacity: 1 }]);

    expect(headline?.characters).toBe("The Autumn Edit");
    expect(headline?.fontId).toBe("gfont-canela");
    expect(headline?.fontFamily).toBe("Canela");
    expect(headline?.fontWeight).toBe("500");
    expect(headline?.fills).toEqual([{ fillColor: "#2D2D2D", fillOpacity: 1 }]);
  });

  it("display type only: image and eyebrow are optional, body copy impossible", () => {
    const board = hero(arthausTokens, { headline: "Quiet walls, warm light" });
    expect(board.elements).toHaveLength(1);
    expect(board.elements[0]?.type).toBe("text");
    // The schema has no body/paragraph field at all.
    expect(Object.keys(heroPayloadSchema.shape).sort()).toEqual(["eyebrow", "headline", "image", "slot"]);
  });

  it("rejects invalid payloads", () => {
    expect(() => hero(arthausTokens, {} as never)).toThrow(ZodError);
    expect(heroPayloadSchema.safeParse({ headline: "" }).success).toBe(false);
    expect(
      heroPayloadSchema.safeParse({ headline: "ok", image: { data: [1, 2], mediaType: "image/png" } }).success,
    ).toBe(false); // bytes must be a Uint8Array
    expect(
      heroPayloadSchema.safeParse({ headline: "ok", image: { data: new Uint8Array(1), mediaType: "image/tiff" } })
        .success,
    ).toBe(false);
  });

  it("slot override names the board (the campaign slot key)", () => {
    expect(hero(arthausTokens, { headline: "x", slot: "hero-2" }).name).toBe("hero-2");
  });
});

describe("promoBanner", () => {
  it("defaults to the ink band with surface display line and accent sub-line", () => {
    const board = promoBanner(arthausTokens, { headline: "10% off", subline: "This week" });
    expect(board.background).toEqual({ fillColor: "#2D2D2D", fillOpacity: 1 });
    const [headline, subline] = textElements(board);
    expect(headline?.fills?.[0]?.fillColor).toBe("#F5F2ED");
    expect(subline?.fills?.[0]?.fillColor).toBe("#B07D4F");
    expect(subline?.characters).toBe("T H I S   W E E K");
  });

  it("surface band flips to ink text; accent band picks text by luminance", () => {
    const surface = promoBanner(arthausTokens, { headline: "x", background: "surface" });
    expect(surface.background?.fillColor).toBe("#F5F2ED");
    expect(textElements(surface)[0]?.fills?.[0]?.fillColor).toBe("#2D2D2D");

    const accent = promoBanner(arthausTokens, { headline: "x", background: "accent" });
    expect(accent.background?.fillColor).toBe("#B07D4F");
    // Bronze luminance < 0.6 → light (surface) text.
    expect(textElements(accent)[0]?.fills?.[0]?.fillColor).toBe("#F5F2ED");
  });

  it("rejects an unknown band choice", () => {
    expect(promoBannerPayloadSchema.safeParse({ headline: "x", background: "plaid" }).success).toBe(false);
  });
});

describe("productFeature", () => {
  it("mats the required product shot on the token surface, lockup optional", () => {
    const withName = productFeature(arthausTokens, { image: png(), displayName: "No. 4" });
    const image = withName.elements.find((e) => e.type === "image");
    expect(image).toMatchObject({ x: 60, y: 56, width: 480, height: 520 });
    expect(textElements(withName)[0]?.fontId).toBe("gfont-canela");

    const bare = productFeature(arthausTokens, { image: png() });
    expect(bare.elements).toHaveLength(1);
  });

  it("requires the image (it IS the section) — name/price stay HTML", () => {
    expect(productFeaturePayloadSchema.safeParse({ displayName: "No. 4" }).success).toBe(false);
    // No price/name-data fields on the board payload — they render as an
    // html productRow section below the board (04 §7).
    expect(Object.keys(productFeaturePayloadSchema.shape).sort()).toEqual(["displayName", "image", "slot"]);
  });
});

describe("editorialMoment", () => {
  it("frames the image with generous token matting", () => {
    const board = editorialMoment(arthausTokens, { image: png() });
    expect(board.elements).toEqual([
      expect.objectContaining({ type: "image", x: 72, y: 72, width: 456, height: 456 }),
    ]);
  });

  it("requires the image", () => {
    expect(editorialMomentPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe("vocabulary + determinism + sparse tokens", () => {
  it("exports the v1 vocabulary keyed by section type", () => {
    expect(Object.keys(emailComposeTemplates).sort()).toEqual([
      "editorialMoment",
      "hero",
      "productFeature",
      "promoBanner",
    ]);
  });

  it("same tokens + payload → deep-equal boards (deterministic compose)", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const payloads = () =>
      [
        hero(arthausTokens, { headline: "H", eyebrow: "E", image: { data: bytes, mediaType: "image/jpeg" } }),
        promoBanner(arthausTokens, { headline: "H", subline: "S" }),
        productFeature(arthausTokens, { image: { data: bytes, mediaType: "image/jpeg" } }),
        editorialMoment(arthausTokens, { image: { data: bytes, mediaType: "image/jpeg" } }),
      ] as const;
    expect(payloads()).toEqual(payloads());
  });

  it("never throws on sparse tokens — documented fallbacks apply", () => {
    const board = hero({}, { headline: "Hello" });
    expect(board.background).toEqual({ fillColor: "#ffffff", fillOpacity: 1 });
    const headline = textElements(board)[0];
    expect(headline?.fills?.[0]?.fillColor).toBe("#1a1a1a");
    expect(headline?.fontId).toBe("gfont-georgia"); // default display stack

    expect(() => promoBanner(undefined, { headline: "x" })).not.toThrow();
    expect(() => productFeature(undefined, { image: png() })).not.toThrow();
    expect(() => editorialMoment(undefined, { image: png() })).not.toThrow();
  });
});
