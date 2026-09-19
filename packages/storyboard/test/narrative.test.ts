import { describe, expect, it } from "vitest";
import { validateStoryboard, fatalProblems, isBuildable } from "../src/narrative";
import type { Beat, Storyboard } from "../src/types";

/**
 * These pin the structural rules to the failures that produced them. Each test
 * name says which real thing it prevents.
 */

function beat(over: Partial<Beat> = {}): Beat {
  return {
    id: "b1",
    role: "payoff",
    assertion: "The work holds a wall without asking the room to change.",
    brief: {
      shows: "the framed drawing on a plain wall, shot straight on",
      feels: "gallery-editorial, unhurried",
      avoid: ["wide lens", "low angle"],
      sourcing: "store-asset",
    },
    evidence: [{ claim: "Title and artist from the product record", origin: "data" }],
    ...over,
  };
}

function storyboard(over: Partial<Storyboard> = {}): Storyboard {
  return {
    id: "sb-1",
    format: "single",
    premise: "One drawing, seen the way its owner will see it.",
    payoff: "You can tell whether it belongs in a room like yours.",
    beats: [beat()],
    continuity: [],
    ...over,
  };
}

describe("validateStoryboard", () => {
  it("accepts a well-formed single", () => {
    expect(fatalProblems(validateStoryboard(storyboard()))).toEqual([]);
    expect(isBuildable(storyboard())).toBe(true);
  });

  it("REFUSES a sequence with no turn — the catalogue-with-slide-numbers bug", () => {
    // This is the exact shape of the three posts that were called trash: three
    // statements of the same thing, numbered.
    const flat = storyboard({
      format: "carousel",
      beats: [
        beat({ id: "b1", role: "setup" }),
        beat({ id: "b2", role: "setup" }),
        beat({ id: "b3", role: "setup" }),
      ],
    });
    const fatals = fatalProblems(validateStoryboard(flat));
    expect(fatals.some((p) => p.detail.includes("no turn"))).toBe(true);
    // And it says what the roles actually were, so the fix is obvious.
    expect(fatals.find((p) => p.detail.includes("no turn"))!.detail).toContain("setup → setup → setup");
  });

  it("accepts tension + payoff as a turn, without an explicit turn beat", () => {
    const arc = storyboard({
      format: "carousel",
      beats: [beat({ id: "b1", role: "setup" }), beat({ id: "b2", role: "tension" }), beat({ id: "b3", role: "payoff" })],
      continuity: [{ what: "the same work", binding: "fixed-asset", ref: "handle:a-hug-in-the-garden-1" }],
    });
    expect(fatalProblems(validateStoryboard(arc))).toEqual([]);
  });

  it("exempts a single — a one-beat arc implies its turn", () => {
    expect(isBuildable(storyboard({ beats: [beat({ role: "setup" })] }))).toBe(true);
  });

  it("refuses a beat that asserts nothing", () => {
    const sb = storyboard({ beats: [beat({ assertion: "  " })] });
    const fatals = fatalProblems(validateStoryboard(sb));
    expect(fatals.some((p) => p.detail.includes("asserts nothing"))).toBe(true);
  });

  it("refuses a brief with no `shows` — a generator cannot act on a mood", () => {
    const sb = storyboard({ beats: [beat({ brief: { ...beat().brief, shows: "" } })] });
    expect(fatalProblems(validateStoryboard(sb)).some((p) => p.field.endsWith("brief.shows"))).toBe(true);
  });

  it("warns when a brief has no `avoid` — where unread prose becomes enforceable", () => {
    // Non-fatal on purpose: it is a quality signal, not a build blocker. But it
    // is the field whose absence let a catalogue render fill a slot specified
    // as an intimate crop.
    const sb = storyboard({ beats: [beat({ brief: { ...beat().brief, avoid: [] } })] });
    const problems = validateStoryboard(sb);
    const p = problems.find((x) => x.field.endsWith("brief.avoid"));
    expect(p).toBeDefined();
    expect(p!.fatal).toBe(false);
  });

  it("warns EVERY time continuity is held by prompt text alone", () => {
    // Four individually convincing frames whose board, surface and light all
    // changed produced this rule. The model obeyed; the brief disagreed with
    // itself.
    const sb = storyboard({
      format: "carousel",
      beats: [beat({ id: "b1", role: "setup" }), beat({ id: "b2", role: "payoff" })],
      continuity: [{ what: "one fixed overhead camera", binding: "prompt-only" }],
    });
    const p = validateStoryboard(sb).find((x) => x.detail.includes("prompt text alone"));
    expect(p).toBeDefined();
    expect(p!.fatal).toBe(false);
  });

  it("refuses a continuity constant that claims a binding but names no ref", () => {
    const sb = storyboard({
      format: "carousel",
      beats: [beat({ id: "b1", role: "setup" }), beat({ id: "b2", role: "payoff" })],
      continuity: [{ what: "the same sheet", binding: "reference-frame" }],
    });
    expect(fatalProblems(validateStoryboard(sb)).some((p) => p.detail.includes("names no ref"))).toBe(true);
  });

  it("warns when a multi-beat storyboard declares no continuity at all", () => {
    const sb = storyboard({
      format: "carousel",
      beats: [beat({ id: "b1", role: "setup" }), beat({ id: "b2", role: "payoff" })],
      continuity: [],
    });
    expect(validateStoryboard(sb).some((p) => p.field === "continuity" && !p.fatal)).toBe(true);
  });

  it("refuses a format/beat-count mismatch", () => {
    const sb = storyboard({ format: "single", beats: [beat({ id: "b1" }), beat({ id: "b2" })] });
    expect(fatalProblems(validateStoryboard(sb)).some((p) => p.field === "beats")).toBe(true);
  });

  it("refuses duplicate beat ids — a candidate could not be attributed", () => {
    const sb = storyboard({
      format: "carousel",
      beats: [beat({ id: "same", role: "setup" }), beat({ id: "same", role: "payoff" })],
    });
    expect(fatalProblems(validateStoryboard(sb)).some((p) => p.detail.includes("duplicate beat id"))).toBe(true);
  });

  it("refuses a storyboard with no premise — if it cannot be written there is no story", () => {
    expect(fatalProblems(validateStoryboard(storyboard({ premise: "" }))).some((p) => p.field === "premise")).toBe(true);
  });
});
