import { describe, expect, it } from "vitest";
import { checkComposeFit, composeSurfaceFile } from "../src/compose.js";
import type { ComposeSpec } from "../src/types.js";

const board = { name: "post", width: 1080, height: 1080 };

function spec(elements: ComposeSpec["elements"]): ComposeSpec {
  return { fileName: "fit", board, elements };
}

describe("checkComposeFit", () => {
  it("passes an in-bounds layout untouched", () => {
    const report = checkComposeFit(
      spec([
        { type: "rect", x: 0, y: 0, width: 1080, height: 1080 },
        { type: "text", x: 90, y: 460, width: 900, height: 120, characters: "Hello", fontSize: "64" },
      ]),
    );
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("errors when a declared box crosses the bottom edge (the sim's clipped CTA)", () => {
    const report = checkComposeFit(
      spec([{ type: "text", x: 90, y: 1000, width: 900, height: 140, characters: "Shop now", fontSize: "40" }]),
    );
    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("out-of-bounds");
    expect(report.errors[0].message).toContain("60px past the bottom edge");
  });

  it("errors on negative origins and reports every violated edge", () => {
    const report = checkComposeFit(spec([{ type: "rect", x: -10, y: -20, width: 2000, height: 100 }]));
    expect(report.errors[0].message).toContain("10px past the left edge");
    expect(report.errors[0].message).toContain("20px past the top edge");
    expect(report.errors[0].message).toContain("910px past the right edge");
  });

  it("errors on non-positive element sizes", () => {
    const report = checkComposeFit(spec([{ type: "rect", x: 0, y: 0, width: 0, height: 50 }]));
    expect(report.errors[0].code).toBe("nonpositive-size");
  });

  it("warns text-board-clip when estimated wrap height crosses the board bottom", () => {
    // 40px font in a 300px-wide box near the bottom: ~5 chars/line at the
    // 0.5×fontSize glyph heuristic, so this long line wraps far past 1080.
    const report = checkComposeFit(
      spec([
        {
          type: "text",
          x: 90,
          y: 980,
          width: 300,
          height: 90,
          characters: "Shop the atelier collection before it is gone",
          fontSize: "40",
        },
      ]),
    );
    expect(report.ok).toBe(true); // heuristics never block at the library tier
    expect(report.warnings.some((w) => w.code === "text-board-clip")).toBe(true);
  });

  it("warns text-box-overflow when text outgrows its box but stays on the board", () => {
    const report = checkComposeFit(
      spec([
        {
          type: "text",
          x: 90,
          y: 100,
          width: 300,
          height: 40,
          characters: "A headline that wraps to several lines easily",
          fontSize: "40",
        },
      ]),
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === "text-box-overflow")).toBe(true);
  });

  it("checks every board of a multi-board spec against its own rect", () => {
    const report = checkComposeFit({
      fileName: "multi",
      boards: [
        { name: "a", width: 600, height: 200, elements: [{ type: "rect", x: 0, y: 0, width: 600, height: 200 }] },
        { name: "b", width: 600, height: 200, elements: [{ type: "rect", x: 0, y: 150, width: 600, height: 100 }] },
      ],
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].board).toBe("b");
    expect(report.errors[0].message).toContain("50px past the bottom edge");
  });
});

describe("composeSurfaceFile fit enforcement", () => {
  it("refuses to build a spec whose declared geometry overflows", async () => {
    await expect(
      composeSurfaceFile(spec([{ type: "rect", x: 0, y: 1000, width: 100, height: 140 }])),
    ).rejects.toThrow(/does not fit its board/);
  });

  it("still builds when only heuristic warnings fire", async () => {
    const bytes = await composeSurfaceFile(
      spec([
        {
          type: "text",
          x: 90,
          y: 100,
          width: 300,
          height: 40,
          characters: "A headline that wraps to several lines easily",
          fontSize: "40",
        },
      ]),
    );
    expect(bytes[0]).toBe(0x50); // PK zip magic
  });
});
