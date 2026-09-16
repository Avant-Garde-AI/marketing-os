import { describe, expect, it } from "vitest";
import { readingOrder } from "../src/adapter";
import { layoutBoards } from "../src/compose";

/**
 * The regression these guard is observed, not hypothetical: a real
 * three-slide Arthaus carousel enumerated as `3-payoff, 1-setup, 2-turn`,
 * which made the review preview read backwards AND made the default export —
 * the image the publish path actually sends — render the payoff as slide one.
 */
describe("readingOrder", () => {
  it("recovers declaration order from a layoutBoards column", () => {
    const placed = layoutBoards([
      { name: "1-setup", width: 1080, height: 1350, elements: [] },
      { name: "2-turn", width: 1080, height: 1350, elements: [] },
      { name: "3-payoff", width: 1080, height: 1350, elements: [] },
    ]);
    // Penpot hands them back in map order, which is not layout order.
    const scrambled = [placed[2]!, placed[0]!, placed[1]!];
    expect(scrambled.map((b) => b.name)).toEqual(["3-payoff", "1-setup", "2-turn"]);

    const sorted = [...scrambled].sort(readingOrder);
    expect(sorted.map((b) => b.name)).toEqual(["1-setup", "2-turn", "3-payoff"]);
  });

  it("sorts a side-by-side row left to right", () => {
    const row = [
      { id: "c", x: 2400, y: 0, height: 1350 },
      { id: "a", x: 0, y: 0, height: 1350 },
      { id: "b", x: 1200, y: 0, height: 1350 },
    ];
    expect([...row].sort(readingOrder).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a slightly nudged board as being in the same row", () => {
    // A human dragging a board on the canvas never lands on an exact pixel.
    // Without the tolerance, 3px of drift would reorder the whole row.
    const row = [
      { id: "right", x: 1200, y: 0, height: 1350 },
      { id: "left", x: 0, y: 3, height: 1350 },
    ];
    expect([...row].sort(readingOrder).map((o) => o.id)).toEqual(["left", "right"]);
  });

  it("still puts a genuinely lower board after a higher one", () => {
    const col = [
      { id: "below", x: 0, y: 1400, height: 1350 },
      { id: "above", x: 900, y: 0, height: 1350 },
    ];
    expect([...col].sort(readingOrder).map((o) => o.id)).toEqual(["above", "below"]);
  });

  it("falls back to selrect when x/y are absent", () => {
    const boards = [
      { id: "second", selrect: { x: 0, y: 1400, height: 1350 } },
      { id: "first", selrect: { x: 0, y: 0, height: 1350 } },
    ];
    expect([...boards].sort(readingOrder).map((o) => o.id)).toEqual(["first", "second"]);
  });

  it("is a total order — sorting an already-sorted list changes nothing", () => {
    const boards = layoutBoards([
      { name: "a", width: 1080, height: 1350, elements: [] },
      { name: "b", width: 1080, height: 1350, elements: [] },
    ]);
    expect([...boards].sort(readingOrder)).toEqual(boards);
  });
});
