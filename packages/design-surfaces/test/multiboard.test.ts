/**
 * WS2-R1 multi-board compose — offline suite.
 *
 * The load-bearing test here is the binfile-geometry one: @penpot/library
 * stores child shapes VERBATIM in absolute page coordinates (it does NOT
 * translate them into the open board's space — verified by unzipping the
 * emitted binfile-v3 zip and reading the per-shape JSON). composeSurfaceFile
 * therefore translates board-relative element coords itself; this test pins
 * that behavior so a library upgrade that starts translating (or a compose
 * regression that stops) fails loudly offline, before the canary.
 */

import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BOARD_GUTTER,
  composeSurfaceFile,
  layoutBoards,
  resolveBoards,
} from "../src/compose.js";
import { selectBoardsByName } from "../src/surface.js";

// ── Minimal binfile-v3 zip reader (test-only) ───────────────────────────────
// @penpot/library streams its zip, so local file headers carry zeroed sizes
// with data descriptors; the central directory has the real sizes/offsets —
// parse that. Handles stored (0) and deflated (8) entries; plenty for the
// tiny files compose emits.
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no zip EOCD record");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    // Local header's own name/extra lengths differ from the central copy's.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw);

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

interface StoredShape {
  name?: string;
  type?: string;
  selrect?: { x: number; y: number; width: number; height: number };
}

/** All per-shape JSON documents from a composed binfile (one file per shape
 * under files/{fileId}/pages/{pageId}/{shapeId}.json). */
function storedShapes(bytes: Uint8Array): StoredShape[] {
  const entries = unzip(bytes);
  const shapes: StoredShape[] = [];
  for (const [name, data] of entries) {
    if (/^files\/[^/]+\/pages\/[^/]+\/[^/]+\.json$/.test(name)) {
      shapes.push(JSON.parse(new TextDecoder().decode(data)) as StoredShape);
    }
  }
  return shapes;
}

// ── Pure parts ──────────────────────────────────────────────────────────────

describe("resolveBoards", () => {
  it("treats board + elements as sugar for a one-element boards array", () => {
    const boards = resolveBoards({
      fileName: "f",
      board: { name: "b", width: 600, height: 400, background: { fillColor: "#FFF" } },
      elements: [{ type: "rect", x: 1, y: 2, width: 3, height: 4 }],
    });
    expect(boards).toEqual([
      {
        name: "b",
        width: 600,
        height: 400,
        background: { fillColor: "#FFF" },
        elements: [{ type: "rect", x: 1, y: 2, width: 3, height: 4 }],
      },
    ]);
  });

  it("defaults sugar elements to []", () => {
    const boards = resolveBoards({ fileName: "f", board: { name: "b", width: 10, height: 10 } });
    expect(boards[0].elements).toEqual([]);
  });

  it("passes a boards array through untouched", () => {
    const spec = {
      fileName: "f",
      boards: [
        { name: "hero", width: 600, height: 750, elements: [] },
        { name: "banner", width: 600, height: 200, elements: [] },
      ],
    };
    expect(resolveBoards(spec)).toBe(spec.boards);
  });

  it("rejects ambiguous and empty forms", () => {
    expect(() =>
      resolveBoards({
        fileName: "f",
        board: { name: "b", width: 1, height: 1 },
        boards: [{ name: "c", width: 1, height: 1, elements: [] }],
      }),
    ).toThrow(/not both/);
    expect(() =>
      resolveBoards({
        fileName: "f",
        boards: [{ name: "c", width: 1, height: 1, elements: [] }],
        elements: [],
      }),
    ).toThrow(/inside each BoardSpec/);
    expect(() => resolveBoards({ fileName: "f", boards: [] })).toThrow(/must not be empty/);
    expect(() => resolveBoards({ fileName: "f" })).toThrow(/provide `boards`/);
  });
});

describe("layoutBoards", () => {
  it("stacks boards vertically: y = sum of previous heights + N × gutter", () => {
    const placed = layoutBoards([
      { name: "hero", width: 600, height: 750, elements: [] },
      { name: "banner", width: 600, height: 200, elements: [] },
      { name: "feature", width: 600, height: 740, elements: [] },
    ]);
    expect(placed.map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [0, 750 + BOARD_GUTTER],
      [0, 750 + 200 + 2 * BOARD_GUTTER],
    ]);
  });

  it("honors an explicit gutter", () => {
    const placed = layoutBoards(
      [
        { name: "a", width: 10, height: 100, elements: [] },
        { name: "b", width: 10, height: 100, elements: [] },
      ],
      40,
    );
    expect(placed[1].y).toBe(140);
  });
});

describe("selectBoardsByName", () => {
  const boards = [
    { id: "1", name: "hero" },
    { id: "2", name: "banner" },
    { id: "3", name: "feature" },
  ];

  it("returns all boards when names are omitted", () => {
    expect(selectBoardsByName(boards)).toEqual(boards);
  });

  it("filters and orders by the requested names", () => {
    expect(selectBoardsByName(boards, ["feature", "hero"])).toEqual([boards[2], boards[0]]);
  });

  it("throws on unknown names, listing what is available", () => {
    expect(() => selectBoardsByName(boards, ["herro"])).toThrow(
      /board "herro" not found; available boards: "hero", "banner", "feature"/,
    );
  });

  it("throws on duplicate names rather than silently dropping an artifact", () => {
    expect(() => selectBoardsByName([...boards, { id: "4", name: "hero" }])).toThrow(/duplicate board name "hero"/);
    // ...but duplicates OUTSIDE the selection don't block exporting the rest.
    expect(selectBoardsByName([...boards, { id: "4", name: "hero" }], ["banner"])).toEqual([boards[1]]);
  });
});

// ── Binfile geometry (the coordinate-semantics pin) ─────────────────────────

describe("composeSurfaceFile (multi-board, offline)", () => {
  it("places boards in a gutter-separated column and translates board-relative elements to absolute page coords", async () => {
    const bytes = await composeSurfaceFile({
      fileName: "multi",
      boards: [
        {
          name: "hero",
          width: 600,
          height: 750,
          background: { fillColor: "#F5F0E8" },
          elements: [{ type: "rect", name: "hero-rect", x: 10, y: 20, width: 100, height: 50 }],
        },
        {
          name: "banner",
          width: 600,
          height: 200,
          elements: [
            { type: "rect", name: "banner-rect", x: 5, y: 5, width: 590, height: 190 },
            { type: "text", name: "banner-text", x: 30, y: 40, width: 300, height: 60, characters: "hi" },
          ],
        },
      ],
    });
    expect(bytes[0]).toBe(0x50); // PK zip magic
    const shapes = storedShapes(bytes);
    const byName = (n: string) => {
      const s = shapes.find((sh) => sh.name === n);
      if (!s?.selrect) throw new Error(`shape ${n} missing from binfile`);
      return s.selrect;
    };

    // Boards: column layout, declaration order, BOARD_GUTTER apart.
    expect(byName("hero")).toMatchObject({ x: 0, y: 0, width: 600, height: 750 });
    expect(byName("banner")).toMatchObject({ x: 0, y: 750 + BOARD_GUTTER, width: 600, height: 200 });

    // Elements: authored board-relative, stored absolute (the library does
    // NOT translate children into the open board — compose must, and did).
    expect(byName("hero-rect")).toMatchObject({ x: 10, y: 20 });
    expect(byName("banner-rect")).toMatchObject({ x: 5, y: 850 + 5 });
    expect(byName("banner-text")).toMatchObject({ x: 30, y: 850 + 40 });
  });

  it("single-board sugar composes identically to a one-element boards array", async () => {
    const board = { name: "b", width: 400, height: 300 };
    const elements = [{ type: "rect", name: "r", x: 7, y: 9, width: 10, height: 10 } as const];
    const sugar = storedShapes(await composeSurfaceFile({ fileName: "s", board, elements }));
    const explicit = storedShapes(await composeSurfaceFile({ fileName: "s", boards: [{ ...board, elements: [...elements] }] }));
    const geometry = (shapes: { name?: string; selrect?: object }[]) =>
      shapes.map((s) => ({ name: s.name, selrect: s.selrect })).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    expect(geometry(sugar)).toEqual(geometry(explicit));
  });
});
