import { describe, expect, it } from "vitest";
import {
  STRATEGY_PATH,
  calendarPath,
  postPath,
  parseCalendar,
  serializeCalendar,
  serializePost,
  serializeStrategy,
} from "../src/artifacts";
import {
  analyzeCalendarGaps,
  createSocialTools,
  monthWeeks,
  pickEvenly,
  proposePlan,
  rotatePillars,
} from "../src/tools";
import type { SocialPost, SocialRepo, SocialStrategy } from "../src/types";

// ---------------------------------------------------------------------------
// In-memory repo binding
// ---------------------------------------------------------------------------

function memoryRepo(seed: Record<string, string> = {}): SocialRepo & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const strategy: SocialStrategy = {
  channels: [
    { channel: "instagram", register: "gallery-editorial", cadencePerWeek: 3 },
    { channel: "pinterest", register: "collector-curatorial", cadencePerWeek: 2 },
  ],
  pillars: [
    { name: "artist-stories", messagingRef: "messaging.pillar.artist_first", weight: 3 },
    { name: "collecting-guides", messagingRef: "messaging.pillar.demystify_collecting", weight: 2 },
    { name: "new-arrivals", messagingRef: "messaging.pillar.living_collection", weight: 1 },
  ],
  seasonalArcs: [{ name: "fall-salon", months: ["2026-09"], description: "Fall salon season." }],
  body: "Arthaus social strategy rationale.",
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

describe("monthWeeks", () => {
  it("groups 2026-09 into Monday-start weeks", () => {
    // Sep 1 2026 is a Tuesday; Sep 7, 14, 21, 28 are Mondays.
    const weeks = monthWeeks("2026-09");
    expect(weeks.map((w) => w.length)).toEqual([6, 7, 7, 7, 3]);
    expect(weeks[0]?.[0]).toBe("2026-09-01");
    expect(weeks[1]?.[0]).toBe("2026-09-07");
    expect(weeks[4]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
  });

  it("handles February in a leap year", () => {
    const weeks = monthWeeks("2028-02");
    expect(weeks.flat()).toHaveLength(29);
    expect(weeks.flat()[28]).toBe("2028-02-29");
  });

  it("rejects a malformed month", () => {
    expect(() => monthWeeks("2026-9")).toThrow(/YYYY-MM/);
  });
});

describe("pickEvenly", () => {
  it("returns unique evenly spaced picks", () => {
    expect(pickEvenly([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 3, 5]);
    expect(pickEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});

describe("rotatePillars", () => {
  it("tracks weights proportionally over a rotation", () => {
    const rotation = rotatePillars(strategy.pillars, 12);
    const counts = new Map<string, number>();
    for (const p of rotation) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    // Weights 3:2:1 over 12 slots → 6/4/2.
    expect(counts.get("artist-stories")).toBe(6);
    expect(counts.get("collecting-guides")).toBe(4);
    expect(counts.get("new-arrivals")).toBe(2);
  });

  it("is deterministic and starts with the heaviest pillar", () => {
    const a = rotatePillars(strategy.pillars, 7).map((p) => p.name);
    const b = rotatePillars(strategy.pillars, 7).map((p) => p.name);
    expect(a).toEqual(b);
    expect(a[0]).toBe("artist-stories");
  });
});

// ---------------------------------------------------------------------------
// proposePlan (pure core)
// ---------------------------------------------------------------------------

describe("proposePlan", () => {
  const input = {
    month: "2026-09",
    context: { topMovers: ["Terra Series", "Nocturne Prints"], seasonal: "fall salon opener" },
  };

  it("is deterministic: identical inputs produce identical proposals", () => {
    expect(proposePlan(strategy, input)).toEqual(proposePlan(strategy, input));
  });

  it("lays out per-channel cadence in every full week", () => {
    const plan = proposePlan(strategy, { month: "2026-09" });
    // Full Monday-start weeks in 2026-09 start on the 7th, 14th, 21st.
    for (const weekStart of [7, 14, 21]) {
      const days = Array.from({ length: 7 }, (_, i) => `2026-09-${String(weekStart + i).padStart(2, "0")}`);
      const inWeek = plan.slots.filter((s) => days.includes(s.slot));
      expect(inWeek.filter((s) => s.channel === "instagram")).toHaveLength(3);
      expect(inWeek.filter((s) => s.channel === "pinterest")).toHaveLength(2);
    }
  });

  it("honors channel filter and cadence override", () => {
    const plan = proposePlan(strategy, {
      month: "2026-09",
      channels: ["pinterest"],
      cadenceOverride: { pinterest: 1 },
    });
    expect(plan.slots.every((s) => s.channel === "pinterest")).toBe(true);
    // One slot per week, 5 (partial) weeks in 2026-09.
    expect(plan.slots).toHaveLength(5);
  });

  it("rotates pillars proportionally to weights", () => {
    const plan = proposePlan(strategy, { month: "2026-09" });
    const counts = new Map<string, number>();
    for (const s of plan.slots) counts.set(s.pillar, (counts.get(s.pillar) ?? 0) + 1);
    const total = plan.slots.length;
    const share = (name: string) => (counts.get(name) ?? 0) / total;
    expect(share("artist-stories")).toBeCloseTo(3 / 6, 1);
    expect(share("collecting-guides")).toBeCloseTo(2 / 6, 1);
    expect(share("new-arrivals")).toBeCloseTo(1 / 6, 1);
  });

  it("gives every slot a rationale and marks slots unassigned", () => {
    const plan = proposePlan(strategy, input);
    for (const slot of plan.slots) {
      expect(slot.rationale.length).toBeGreaterThan(0);
      expect(slot.rationale).toContain(slot.pillar);
      expect(slot.postId).toBeNull();
      expect(slot.status).toBe("planned");
    }
  });

  it("weaves top movers into commercial slots and seasonal context into rationales", () => {
    const plan = proposePlan(strategy, input);
    const featured = plan.slots.filter((s) => s.intent.startsWith("feature: "));
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.some((s) => s.intent === "feature: Terra Series")).toBe(true);
    expect(plan.slots[0]?.rationale).toContain("fall salon opener");
    expect(plan.slots[0]?.rationale).toContain("fall-salon");
  });

  it("emits a parseable calendar draft that mirrors the slots", () => {
    const plan = proposePlan(strategy, input);
    const calendar = parseCalendar(plan.calendarMarkdown);
    expect(calendar.month).toBe("2026-09");
    expect(calendar.status).toBe("proposed");
    expect(calendar.slots).toEqual(plan.slots.map(({ rationale: _r, ...slot }) => slot));
  });

  it("throws when the channel filter matches nothing", () => {
    expect(() => proposePlan(strategy, { month: "2026-09", channels: ["tiktok"] })).toThrow(/no strategy channels/);
  });
});

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

describe("analyzeCalendarGaps", () => {
  it("finds unassigned slots and under-represented pillars", () => {
    const slots = [
      { slot: "2026-09-01", channel: "instagram", pillar: "artist-stories", intent: "x", postId: "p1", status: "approved" },
      { slot: "2026-09-02", channel: "instagram", pillar: "artist-stories", intent: "x", postId: null, status: "planned" },
      { slot: "2026-09-03", channel: "instagram", pillar: "artist-stories", intent: "x", postId: null, status: "planned" },
      { slot: "2026-09-04", channel: "pinterest", pillar: "collecting-guides", intent: "x", postId: "p2", status: "approved" },
      { slot: "2026-09-05", channel: "pinterest", pillar: "artist-stories", intent: "x", postId: null, status: "planned" },
      { slot: "2026-09-06", channel: "pinterest", pillar: "artist-stories", intent: "x", postId: null, status: "planned" },
    ];
    const gaps = analyzeCalendarGaps({ slots }, strategy);
    expect(gaps.unassignedSlots).toHaveLength(4);
    // Weights 3:2:1 over 6 slots → expected 3/2/1; actual 5/1/0.
    const byName = new Map(gaps.pillarBalance.map((b) => [b.pillar, b]));
    expect(byName.get("artist-stories")?.underRepresented).toBe(false);
    expect(byName.get("collecting-guides")?.underRepresented).toBe(true);
    expect(byName.get("new-arrivals")?.underRepresented).toBe(true);
    expect(gaps.missingPillars).toEqual(["new-arrivals"]);
  });

  it("skips pillar balance when no strategy is available", () => {
    const gaps = analyzeCalendarGaps({ slots: [] }, null);
    expect(gaps.pillarBalance).toEqual([]);
    expect(gaps.missingPillars).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tools over the repo binding
// ---------------------------------------------------------------------------

describe("createSocialTools", () => {
  const post: SocialPost = {
    id: "2026-09-ig-001",
    channel: "instagram",
    scheduledAt: "2026-09-01T16:00:00Z",
    copy: "Studio visit: Marisol Vega's Terra Series.",
    copyFormulaRef: "brand.md#art-description-formula",
    assetRefs: ["social/posts/2026-09-ig-001/assets/hero.png"],
    targetLink: "https://myarthaus.com/collections/terra-series",
    provenance: [{ claim: "Terra Series is a 30-day top mover", origin: "data" }],
    status: "approved",
    body: "Opens the fall salon arc.",
  };

  function seededRepo() {
    const plan = proposePlan(strategy, { month: "2026-09" });
    return memoryRepo({
      [STRATEGY_PATH]: serializeStrategy(strategy),
      [calendarPath("2026-09")]: plan.calendarMarkdown,
      [postPath(post.id)]: serializePost(post),
    });
  }

  it("social_plan_propose reads strategy.md and returns a schema-valid proposal", async () => {
    const tools = createSocialTools(seededRepo());
    const out = await tools.social_plan_propose.execute({ month: "2026-10" });
    expect(() => tools.social_plan_propose.outputSchema.parse(out)).not.toThrow();
    expect(out.month).toBe("2026-10");
    expect(out.slots.length).toBeGreaterThan(0);
  });

  it("social_plan_propose fails clearly without a strategy", async () => {
    const tools = createSocialTools(memoryRepo());
    await expect(tools.social_plan_propose.execute({ month: "2026-10" })).rejects.toThrow(
      /strategy\.md not found/,
    );
  });

  it("social_plan_propose never writes to the repo (reads only)", async () => {
    const repo = seededRepo();
    const before = new Map(repo.files);
    const tools = createSocialTools(repo);
    await tools.social_plan_propose.execute({ month: "2026-10" });
    expect(repo.files).toEqual(before);
  });

  it("social_calendar_read returns the calendar with gap analysis", async () => {
    const tools = createSocialTools(seededRepo());
    const out = await tools.social_calendar_read.execute({ month: "2026-09" });
    expect(() => tools.social_calendar_read.outputSchema.parse(out)).not.toThrow();
    expect(out.status).toBe("proposed");
    // Freshly proposed calendars have no posts yet — every slot is a gap.
    expect(out.gaps.unassignedSlots).toHaveLength(out.slots.length);
  });

  it("social_calendar_read fails clearly for a missing month", async () => {
    const tools = createSocialTools(seededRepo());
    await expect(tools.social_calendar_read.execute({ month: "2027-01" })).rejects.toThrow(
      /no calendar for 2027-01/,
    );
  });

  it("social_post_read returns the parsed post spec", async () => {
    const tools = createSocialTools(seededRepo());
    const out = await tools.social_post_read.execute({ id: post.id });
    expect(() => tools.social_post_read.outputSchema.parse(out)).not.toThrow();
    expect(out).toEqual(post);
  });

  it("social_post_read fails clearly for an unknown id", async () => {
    const tools = createSocialTools(seededRepo());
    await expect(tools.social_post_read.execute({ id: "nope" })).rejects.toThrow(/not found/);
  });
});
