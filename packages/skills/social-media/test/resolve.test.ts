import { describe, expect, it } from "vitest";
import {
  assertComplete,
  chooseArchetype,
  missingRoles,
  resolveSlots,
  type SlotBindings,
} from "../src/resolve";
import type { LayoutArchetype, SocialGenome } from "../src/types";

const BOARD = { width: 1080, height: 1080 };

const fullBleed: LayoutArchetype = {
  id: "full-bleed-work",
  name: "Full-bleed work",
  description: "The work fills the frame; a caption band carries attribution.",
  slots: [
    { role: "work", kind: "image", x: 0, y: 0, w: 1, h: 0.82 },
    { role: "caption-band", kind: "band", x: 0, y: 0.82, w: 1, h: 0.18 },
    { role: "attribution", kind: "text", x: 0.06, y: 0.86, w: 0.88, h: 0.1 },
  ],
  evidence: { n: 34, signal: 0.71 },
};

// Higher evidence than full-bleed, so ranking prefers it — but it needs a room
// scene, which most stores cannot supply for every piece. This is the whole
// point of chooseArchetype.
const roomInSitu: LayoutArchetype = {
  id: "room-in-situ",
  name: "Room in situ",
  description: "The work hung in a room; the room does the selling.",
  slots: [
    { role: "room", kind: "image", x: 0, y: 0, w: 1, h: 1 },
    { role: "eyebrow", kind: "text", x: 0.06, y: 0.06, w: 0.5, h: 0.06 },
  ],
  evidence: { n: 61, signal: 0.88 },
};

const genome: SocialGenome = {
  domain: "framed-art-retail",
  archetypes: [fullBleed, roomInSitu],
  distilledAt: "2026-09-01",
  provenance: "test fixture",
  body: "",
};

const workOnly: SlotBindings = {
  work: { kind: "image", assetRef: "artwork:8891" },
  "caption-band": { kind: "band", color: "#141414" },
  attribution: { kind: "text", characters: "Shelly Bremmer — Botanical Study No. 4" },
};

describe("resolveSlots", () => {
  it("fills every slot and reports complete", () => {
    const r = resolveSlots(fullBleed, BOARD, workOnly);
    expect(r.complete).toBe(true);
    expect(r.misses).toEqual([]);
    expect(r.filled.map((f) => f.role)).toEqual(["work", "caption-band", "attribution"]);
  });

  it("carries the resolved pixel geometry through, not the normalized fractions", () => {
    const work = resolveSlots(fullBleed, BOARD, workOnly).filled[0];
    expect(work).toMatchObject({ x: 0, y: 0, width: 1080, height: 886 });
    expect(work.fill).toEqual({ kind: "image", assetRef: "artwork:8891" });
  });

  it("resolves the same archetype to any board", () => {
    const portrait = resolveSlots(fullBleed, { width: 1080, height: 1350 }, workOnly);
    expect(portrait.complete).toBe(true);
    expect(portrait.filled[0]).toMatchObject({ width: 1080, height: 1107 });
  });

  it("names an unbound role instead of composing a blank", () => {
    const r = resolveSlots(roomInSitu, BOARD, workOnly);
    expect(r.complete).toBe(false);
    expect(r.misses.map((m) => [m.role, m.reason])).toEqual([
      ["room", "unbound"],
      ["eyebrow", "unbound"],
    ]);
    expect(r.misses[0].detail).toContain("room");
  });

  it("rejects content of the wrong kind", () => {
    const r = resolveSlots(fullBleed, BOARD, {
      ...workOnly,
      work: { kind: "text", characters: "not an image" },
    });
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0]).toMatchObject({ role: "work", reason: "kind-mismatch" });
  });

  it("treats an empty string as unfilled — it looks filled and renders as nothing", () => {
    const r = resolveSlots(fullBleed, BOARD, {
      ...workOnly,
      attribution: { kind: "text", characters: "   " },
    });
    expect(r.complete).toBe(false);
    expect(r.misses[0]).toMatchObject({ role: "attribution", reason: "empty" });
  });

  it("is deterministic", () => {
    const a = resolveSlots(fullBleed, BOARD, workOnly);
    const b = resolveSlots(fullBleed, BOARD, workOnly);
    expect(a).toEqual(b);
  });
});

describe("assertComplete", () => {
  it("returns the filled slots when nothing is missing", () => {
    expect(assertComplete(resolveSlots(fullBleed, BOARD, workOnly))).toHaveLength(3);
  });

  it("names every unsatisfied role at once, not the first", () => {
    const r = resolveSlots(roomInSitu, BOARD, workOnly);
    try {
      assertComplete(r);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("room");
      expect(msg).toContain("eyebrow");
      expect(msg).toContain("room-in-situ");
    }
  });
});

describe("chooseArchetype", () => {
  it("skips the better-evidenced archetype the store cannot fill", () => {
    const choice = chooseArchetype(genome, BOARD, workOnly);
    // room-in-situ ranks first (n=61, signal .88) but needs a room scene.
    expect(choice?.archetype.id).toBe("full-bleed-work");
    expect(choice?.resolution.complete).toBe(true);
  });

  it("prefers the strongest archetype once the store can fill it", () => {
    const withRoom: SlotBindings = {
      ...workOnly,
      room: { kind: "image", assetRef: "room-scene:8891-living" },
      eyebrow: { kind: "text", characters: "BOTANICAL STUDIES" },
    };
    expect(chooseArchetype(genome, BOARD, withRoom)?.archetype.id).toBe("room-in-situ");
  });

  it("returns null when nothing is fillable, rather than throwing", () => {
    expect(chooseArchetype(genome, BOARD, {})).toBeNull();
  });

  it("honours minEvidence", () => {
    expect(chooseArchetype(genome, BOARD, workOnly, { minEvidence: 50 })).toBeNull();
  });

  it("restricts to the caller's shortlist", () => {
    const choice = chooseArchetype(genome, BOARD, workOnly, { only: ["full-bleed-work"] });
    expect(choice?.archetype.id).toBe("full-bleed-work");
    expect(chooseArchetype(genome, BOARD, workOnly, { only: ["room-in-situ"] })).toBeNull();
  });
});

describe("missingRoles", () => {
  it("ranks archetypes by how close the store is to being able to use them", () => {
    expect(missingRoles(genome, BOARD, workOnly)).toEqual([
      { archetypeId: "full-bleed-work", missing: [] },
      {
        archetypeId: "room-in-situ",
        missing: [
          expect.objectContaining({ role: "room" }),
          expect.objectContaining({ role: "eyebrow" }),
        ],
      },
    ]);
  });
});
