import { describe, expect, it } from "vitest";
import {
  imageDimensions,
  specFromArchetype,
  type MaterializeImage,
  type SurfaceStyle,
} from "../src/archetype-surface";
import type { LayoutArchetype } from "../src/types";

/** 1×1 PNG, and a helper to forge a PNG header at any declared size. */
function pngOf(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b[0] = 0x89;
  b[1] = 0x50;
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const materialize =
  (w: number, h: number): MaterializeImage =>
  async () => ({ data: pngOf(w, h), mediaType: "image/png" });

const style: SurfaceStyle = {
  background: { fillColor: "#F5F2ED", fillOpacity: 1 },
  bandColor: "#F5F2ED",
  defaultText: { fontFamily: "Inter", color: "#2D2D2D" },
};

const captioned: LayoutArchetype = {
  id: "room-in-situ-captioned",
  name: "Room with a quiet band",
  description: "",
  slots: [
    { role: "room", kind: "image", x: 0, y: 0, w: 1, h: 0.84 },
    { role: "band", kind: "band", x: 0, y: 0.84, w: 1, h: 0.16 },
    { role: "eyebrow", kind: "text", x: 0.06, y: 0.88, w: 0.6, h: 0.06 },
  ],
  evidence: { n: 0 },
};

const statement: LayoutArchetype = {
  id: "editorial-statement",
  name: "Editorial statement",
  description: "",
  slots: [
    { role: "ground", kind: "band", x: 0, y: 0, w: 1, h: 1 },
    { role: "statement", kind: "text", x: 0.1, y: 0.36, w: 0.8, h: 0.28 },
  ],
  evidence: { n: 0 },
};

const board = { width: 1080, height: 1350 };

describe("imageDimensions", () => {
  it("reads PNG and GIF headers", () => {
    expect(imageDimensions(pngOf(928, 1152))).toEqual({ width: 928, height: 1152 });
    const gif = new Uint8Array(16);
    gif[0] = 0x47;
    gif[1] = 0x49;
    gif[6] = 0x20; // 32 little-endian
    gif[8] = 0x40; // 64
    expect(imageDimensions(gif)).toEqual({ width: 32, height: 64 });
  });

  it("returns null for something it cannot measure, rather than guessing", () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("specFromArchetype", () => {
  it("places every slot the archetype declares, in declaration order", async () => {
    const { spec, resolution } = await specFromArchetype({
      archetype: captioned,
      board,
      bindings: {
        room: { kind: "image", assetRef: "https://example.test/room.png" },
        band: { kind: "band", color: "#F5F2ED" },
        eyebrow: { kind: "text", characters: "Vent Stripe — Shelly Bremmer" },
      },
      fileName: "post",
      style,
      // 1080×1134 is the room slot at this board: an exact-aspect asset.
      materialize: materialize(1080, 1134),
    });
    expect(resolution.complete).toBe(true);
    expect(spec.elements?.map((e) => [e.name, e.type])).toEqual([
      ["room", "image"],
      ["band", "rect"],
      ["eyebrow", "text"],
    ]);
  });

  it("refuses an archetype the store cannot fill, naming the role", async () => {
    await expect(
      specFromArchetype({
        archetype: captioned,
        board,
        bindings: {
          room: { kind: "image", assetRef: "https://example.test/room.png" },
          band: { kind: "band", color: "#F5F2ED" },
          // eyebrow unbound
        },
        fileName: "post",
        style,
        materialize: materialize(1080, 1134),
      }),
    ).rejects.toThrow(/needs a text for role "eyebrow"/);
  });

  it("refuses an empty string, which would render as a blank that passes every check", async () => {
    await expect(
      specFromArchetype({
        archetype: captioned,
        board,
        bindings: {
          room: { kind: "image", assetRef: "https://example.test/room.png" },
          band: { kind: "band", color: "#F5F2ED" },
          eyebrow: { kind: "text", characters: "   " },
        },
        fileName: "post",
        style,
        materialize: materialize(1080, 1134),
      }),
    ).rejects.toThrow(/empty/);
  });

  it("refuses an asset that would be stretched to fill its slot", async () => {
    // The real case: a 928×1152 room scene (0.806) into a 1080×1920 story.
    await expect(
      specFromArchetype({
        archetype: { ...captioned, slots: [{ role: "room", kind: "image", x: 0, y: 0, w: 1, h: 1 }] },
        board: { width: 1080, height: 1920 },
        bindings: { room: { kind: "image", assetRef: "https://example.test/room.png" } },
        fileName: "post",
        style,
        materialize: materialize(928, 1152),
      }),
    ).rejects.toThrow(/would be stretched 30%/);
  });

  it("refuses zero bytes", async () => {
    await expect(
      specFromArchetype({
        archetype: { ...captioned, slots: [{ role: "room", kind: "image", x: 0, y: 0, w: 1, h: 1 }] },
        board,
        bindings: { room: { kind: "image", assetRef: "https://example.test/room.png" } },
        fileName: "post",
        style,
        materialize: async () => ({ data: new Uint8Array(0), mediaType: "image/png" }),
      }),
    ).rejects.toThrow(/zero bytes/);
  });

  it("sizes a multi-line pull quote to fit its block", async () => {
    // The regression that motivated content-aware sizing: a flat fraction of
    // slot height put this at 219px and clipped half of it off the board.
    const characters = "Curated for you,\nnot curated at you.";
    const { spec } = await specFromArchetype({
      archetype: statement,
      board,
      bindings: {
        ground: { kind: "band", color: "#F5F2ED" },
        statement: { kind: "text", characters },
      },
      fileName: "post",
      style,
      materialize: materialize(1, 1),
    });
    const text = spec.elements?.find((e) => e.type === "text");
    if (text?.type !== "text") throw new Error("no text element");
    const size = Number(text.fontSize);

    // Re-run the fit-check's own estimate: the rendered block must sit inside
    // the slot, which is the property the old sizing violated.
    const lines = characters.split("\n").reduce((n, line) => {
      return n + Math.max(1, Math.ceil((line.length * size * 0.5) / text.width));
    }, 0);
    expect(lines * size * 1.2).toBeLessThanOrEqual(text.height);
    expect(size).toBeGreaterThan(11);
  });

  it("is deterministic — same inputs, same spec", async () => {
    const run = () =>
      specFromArchetype({
        archetype: statement,
        board,
        bindings: {
          ground: { kind: "band", color: "#F5F2ED" },
          statement: { kind: "text", characters: "Curated for you,\nnot curated at you." },
        },
        fileName: "post",
        style,
        materialize: materialize(1, 1),
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(JSON.stringify(a.spec)).toEqual(JSON.stringify(b.spec));
  });
});

describe("component fills (spec 30 §3)", () => {
  const captionBand = {
    name: "caption-band",
    width: 1080,
    height: 216,
    elements: [
      { type: "rect" as const, name: "ground", x: 0, y: 0, width: 1080, height: 216, fills: [{ fillColor: "#F5F2ED", fillOpacity: 1 }] },
      { type: "rect" as const, name: "rule", x: 64, y: 0, width: 952, height: 1, fills: [{ fillColor: "#2D2D2D", fillOpacity: 1 }] },
      {
        type: "text" as const,
        name: "eyebrow",
        x: 64,
        y: 84,
        width: 820,
        height: 34,
        characters: "WORK — ARTIST",
        fontFamily: "Inter",
        fontSize: "22",
      },
    ],
  };
  const resolveComponent = (ref: string) => (ref === "caption-band" ? captionBand : null);

  it("materialises the whole lockup into the slot, namespaced by role", async () => {
    const { spec } = await specFromArchetype({
      archetype: captioned,
      board,
      bindings: {
        room: { kind: "image", assetRef: "https://example.test/room.png" },
        band: { kind: "component", ref: "caption-band", overrides: { eyebrow: "Vent Stripe — Shelly Bremmer" } },
        eyebrow: { kind: "text", characters: "unused" },
      },
      fileName: "post",
      style,
      materialize: materialize(1080, 1134),
      resolveComponent,
    });
    const names = spec.elements?.map((e) => e.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["band/ground", "band/rule", "band/eyebrow"]));
  });

  it("applies text overrides by element name, and leaves the layout alone", async () => {
    const { spec } = await specFromArchetype({
      archetype: captioned,
      board,
      bindings: {
        room: { kind: "image", assetRef: "https://example.test/room.png" },
        band: { kind: "component", ref: "caption-band", overrides: { eyebrow: "A new line" } },
        eyebrow: { kind: "text", characters: "unused" },
      },
      fileName: "post",
      style,
      materialize: materialize(1080, 1134),
      resolveComponent,
    });
    const eyebrow = spec.elements?.find((e) => e.name === "band/eyebrow");
    if (eyebrow?.type !== "text") throw new Error("no eyebrow");
    expect(eyebrow.characters).toBe("A new line");
    // The band slot is 1080x216 at this board, so the component lands 1:1 and
    // the designer's optical position survives untouched.
    expect(eyebrow.x).toBe(64);
  });

  it("refuses a component the library does not have, by name", async () => {
    await expect(
      specFromArchetype({
        archetype: captioned,
        board,
        bindings: {
          room: { kind: "image", assetRef: "https://example.test/room.png" },
          band: { kind: "component", ref: "nope" },
          eyebrow: { kind: "text", characters: "x" },
        },
        fileName: "post",
        style,
        materialize: materialize(1080, 1134),
        resolveComponent,
      }),
    ).rejects.toThrow(/not in this store's design library/);
  });

  it("refuses a component squeezed into a differently-shaped slot", async () => {
    // The craft IS the proportion: a band stretched taller has different
    // optical spacing than the one the designer approved.
    const tall = { ...captionBand, height: 600 };
    await expect(
      specFromArchetype({
        archetype: captioned,
        board,
        bindings: {
          room: { kind: "image", assetRef: "https://example.test/room.png" },
          band: { kind: "component", ref: "caption-band" },
          eyebrow: { kind: "text", characters: "x" },
        },
        fileName: "post",
        style,
        materialize: materialize(1080, 1134),
        resolveComponent: () => tall,
      }),
    ).rejects.toThrow(/difference in proportion/);
  });

  it("refuses when no resolver was supplied at all", async () => {
    await expect(
      specFromArchetype({
        archetype: captioned,
        board,
        bindings: {
          room: { kind: "image", assetRef: "https://example.test/room.png" },
          band: { kind: "component", ref: "caption-band" },
          eyebrow: { kind: "text", characters: "x" },
        },
        fileName: "post",
        style,
        materialize: materialize(1080, 1134),
      }),
    ).rejects.toThrow(/no component resolver was supplied/);
  });
});
