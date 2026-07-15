import { describe, expect, it } from "vitest";
import { composeSurfaceFile } from "../src/compose.js";

describe("composeSurfaceFile (offline)", () => {
  it("builds a .penpot zip with board, text, rect and tokens", async () => {
    const bytes = await composeSurfaceFile({
      fileName: "unit-test",
      board: { name: "b", width: 1080, height: 1080, background: { fillColor: "#FFFFFF" } },
      elements: [
        { type: "rect", x: 0, y: 0, width: 100, height: 100, fills: [{ fillColor: "#112233" }] },
        { type: "text", x: 10, y: 10, width: 500, height: 80, characters: "hello", fontSize: "32" },
      ],
      tokens: { global: { color: { ink: { $value: "#112233", $type: "color" } } } },
      libraryColors: [{ name: "Ink", color: "#112233" }],
    });
    expect(bytes.length).toBeGreaterThan(1000);
    // ZIP magic: PK\x03\x04
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("is deterministic enough to be an artifact (same spec → similar size)", async () => {
    const spec = {
      fileName: "det",
      board: { name: "b", width: 200, height: 200 },
      elements: [],
    };
    const a = await composeSurfaceFile(spec);
    const b = await composeSurfaceFile(spec);
    expect(Math.abs(a.length - b.length)).toBeLessThan(64); // ids differ; structure identical
  });
});
