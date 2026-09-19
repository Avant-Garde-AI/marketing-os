import { describe, expect, it, vi } from "vitest";
import { exploreBeat, exploreStoryboard } from "../src/explore";
import type { Beat, Candidate, ImageryService, Storyboard, VisualCritic } from "../src/types";

const beat: Beat = {
  id: "b1",
  role: "payoff",
  assertion: "The work holds the wall.",
  brief: { shows: "framed drawing, straight on", feels: "unhurried", avoid: ["wide lens"], sourcing: "either" },
  evidence: [],
};

function service(over: Partial<ImageryService> = {}): ImageryService {
  return {
    name: "fake",
    supports: () => true,
    explore: async (b, n) =>
      Array.from({ length: n }, (_, i) => ({ id: `c${i}`, beatId: b.id, url: `u${i}`, origin: { i } })),
    ...over,
  };
}

function critic(fn: VisualCritic["critique"]): VisualCritic {
  return { name: "fake-critic", critique: fn };
}

describe("exploreBeat", () => {
  it("generates many and keeps the survivors — the loop that never existed", () => {
    return (async () => {
      const kept = critic(async (_b, cands) =>
        cands.map((c, i) => ({ kill: i === 0, reason: i === 0 ? "off-brief" : "on-brief", score: i / 10, beatId: c.beatId, candidateId: c.id })),
      );
      const out = await exploreBeat(beat, [service()], kept, [], 3);
      expect(out.survivors.length).toBeGreaterThan(0);
      // Every verdict is retained, including the kills — the record of WHY.
      expect(out.verdicts).toHaveLength(3);
      expect(out.verdicts.filter((v) => v.kill)).toHaveLength(1);
    })();
  });

  it("refuses the beat when no service supports the brief, rather than generating off-brief", async () => {
    // The cheap half of the bare-artwork problem: a beat needing a real store
    // asset must never reach a generator.
    const storeOnly: Beat = { ...beat, brief: { ...beat.brief, sourcing: "store-asset" } };
    const generatorOnly = service({ supports: (b) => b.sourcing === "generated" });
    const spy = vi.spyOn(generatorOnly, "explore");
    const out = await exploreBeat(storeOnly, [generatorOnly], critic(async () => []), [], 3);
    expect(out.survivors).toEqual([]);
    expect(out.failure).toMatch(/no imagery service supports/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("records a reason when everything is eliminated", async () => {
    const killAll = critic(async () => [{ kill: true, reason: "all four are the same picture" }]);
    const out = await exploreBeat(beat, [service()], killAll, [], 4);
    expect(out.survivors).toEqual([]);
    expect(out.failure).toContain("the same picture");
  });

  it("never reports success with an empty survivor list and no reason", async () => {
    const silent = critic(async () => [{ kill: true, reason: "" }]);
    const out = await exploreBeat(beat, [service()], silent, [], 2);
    expect(out.failure).toBeTruthy();
  });

  it("passes continuity through to the generator", async () => {
    const svc = service();
    const spy = vi.spyOn(svc, "explore");
    const continuity = [{ what: "the same sheet", binding: "reference-frame" as const, ref: "asset:1" }];
    await exploreBeat(beat, [svc], critic(async () => []), continuity, 2);
    expect(spy).toHaveBeenCalledWith(beat, 2, continuity);
  });
});

describe("exploreStoryboard", () => {
  const sb: Storyboard = {
    id: "sb",
    format: "carousel",
    premise: "p",
    payoff: "q",
    beats: [beat, { ...beat, id: "b2", role: "setup" }, { ...beat, id: "b3", role: "turn" }],
    continuity: [],
  };

  it("reports truncation instead of silently producing fewer candidates", async () => {
    // A budget cap that quietly becomes a quality cap is the failure here: Veo
    // is capped at $2/render, so this WILL be hit in practice.
    const ok = critic(async (_b, c) => c.map((x) => ({ kill: false, reason: "fine", score: 1, beatId: x.beatId, candidateId: x.id })));
    const res = await exploreStoryboard(sb, [service()], ok, { n: 2, maxCalls: 4 });
    expect(res.truncated).toBe(true);
    expect(res.outcomes).toHaveLength(2);
    expect(res.calls).toBe(4);
  });

  it("does not fail the batch when one beat yields nothing", async () => {
    const pickyCritic = critic(async (b, c) =>
      b.id === "b2" ? [{ kill: true, reason: "boring" }] : c.map((x) => ({ kill: false, reason: "ok", score: 1, beatId: x.beatId, candidateId: x.id })),
    );
    const res = await exploreStoryboard(sb, [service()], pickyCritic, { n: 2 });
    expect(res.emptyBeats).toEqual(["b2"]);
    expect(res.outcomes).toHaveLength(3);
  });

  it("warns when n=1, because nothing can be eliminated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await exploreStoryboard(sb, [service()], critic(async () => []), { n: 1, maxCalls: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("n=1"));
    warn.mockRestore();
  });
});
