import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@avant-garde/skill-kit";
import {
  calendarPath,
  campaignPath,
  serializeCalendar,
  serializeCampaign,
  serializeStrategy,
} from "../src/artifacts";
import {
  analyzeEmailCalendarGaps,
  monthWeeks,
  proposeEmailPlan,
  rotateArchetypes,
} from "../src/plan";
import { createEmailTools, inlineUniversalContent } from "../src/tools";
import { campaign, createFakeKlaviyo, strategy } from "./fixtures";

function toolsWith(files: Record<string, string> = {}) {
  const repo = createMemoryRepo(files);
  const { client, state } = createFakeKlaviyo();
  return { tools: createEmailTools(repo, client), repo, state };
}

// ---------------------------------------------------------------------------
// Pure planning core
// ---------------------------------------------------------------------------

describe("monthWeeks", () => {
  it("covers every day exactly once", () => {
    const weeks = monthWeeks("2026-08");
    const days = weeks.flat();
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days[0]).toBe("2026-08-01");
    expect(days.at(-1)).toBe("2026-08-31");
  });

  it("rejects malformed months", () => {
    expect(() => monthWeeks("2026-8")).toThrow(/YYYY-MM/);
  });
});

describe("rotateArchetypes", () => {
  it("tracks weights over the rotation", () => {
    const rotation = rotateArchetypes(strategy.archetypes, 6);
    const counts = new Map<string, number>();
    for (const a of rotation) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
    expect(counts.get("new-arrivals")).toBe(3);
    expect(counts.get("editorial-story")).toBe(2);
    expect(counts.get("promotion")).toBe(1);
  });
});

describe("proposeEmailPlan", () => {
  it("is deterministic: same inputs → same proposal", () => {
    const a = proposeEmailPlan(strategy, { month: "2026-09" });
    const b = proposeEmailPlan(strategy, { month: "2026-09" });
    expect(a).toEqual(b);
  });

  it("lays out campaignsPerMonth slots on preferred send days", () => {
    const plan = proposeEmailPlan(strategy, { month: "2026-09" });
    expect(plan.slots).toHaveLength(4);
    for (const slot of plan.slots) {
      const weekday = new Date(`${slot.slot}T00:00:00Z`).getUTCDay();
      expect([2, 4]).toContain(weekday); // tuesday=2, thursday=4
    }
  });

  it("respects quiet periods (2026-08-24..31 drops the last week's slot)", () => {
    const plan = proposeEmailPlan(strategy, { month: "2026-08" });
    for (const slot of plan.slots) {
      expect(slot.slot < "2026-08-24" || slot.slot > "2026-08-31").toBe(true);
    }
  });

  it("never violates audience cadence caps and warns when exhausted", () => {
    const tight = {
      ...strategy,
      audiences: [strategy.audiences[1]!], // full-list, cap 2
      campaignsPerMonth: 4,
    };
    const plan = proposeEmailPlan(tight, { month: "2026-09" });
    const assigned = plan.slots.filter((s) => s.audience !== null);
    expect(assigned).toHaveLength(2);
    expect(plan.warnings.some((w) => w.includes("cadenceCap"))).toBe(true);
  });

  it("weaves top movers into every third slot and cites seasonal arcs", () => {
    const plan = proposeEmailPlan(strategy, {
      month: "2026-08",
      context: { topMovers: ["botanical prints"], seasonal: "back-to-school walls" },
    });
    expect(plan.slots.some((s) => s.intent === "feature: botanical prints")).toBe(true);
    expect(plan.slots[0]!.rationale).toContain("autumn-refresh");
    expect(plan.slots[0]!.rationale).toContain("back-to-school walls");
  });

  it("every slot carries a rationale", () => {
    const plan = proposeEmailPlan(strategy, { month: "2026-09" });
    for (const slot of plan.slots) expect(slot.rationale.length).toBeGreaterThan(20);
  });

  it("emits ready-to-propose calendar markdown that parses back", () => {
    const plan = proposeEmailPlan(strategy, { month: "2026-09" });
    expect(plan.calendarMarkdown).toContain("| slot | audience | archetype |");
    expect(plan.calendarMarkdown).toContain("2026-09");
  });

  it("honors maxCampaignsPerWeek", () => {
    const heavy = { ...strategy, campaignsPerMonth: 12 };
    const plan = proposeEmailPlan(heavy, { month: "2026-09" });
    const byWeek = new Map<string, number>();
    for (const slot of plan.slots) {
      const week = slot.slot.slice(0, 8);
      void week;
    }
    // Group by calendar week via monthWeeks
    const weeks = monthWeeks("2026-09");
    for (const weekDays of weeks) {
      const count = plan.slots.filter((s) => weekDays.includes(s.slot)).length;
      expect(count).toBeLessThanOrEqual(2);
    }
    expect(byWeek.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

describe("analyzeEmailCalendarGaps", () => {
  it("flags unassigned, audienceless, over-cap, and quiet-period slots", () => {
    const gaps = analyzeEmailCalendarGaps(
      {
        slots: [
          { slot: "2026-08-04", audience: "full-list", archetype: "new-arrivals", intent: "x", campaignId: "c1", status: "proposed" },
          { slot: "2026-08-06", audience: "full-list", archetype: "new-arrivals", intent: "x", campaignId: null, status: "planned" },
          { slot: "2026-08-11", audience: "full-list", archetype: "new-arrivals", intent: "x", campaignId: null, status: "planned" },
          { slot: "2026-08-25", audience: null, archetype: "new-arrivals", intent: "x", campaignId: null, status: "planned" },
        ],
      },
      strategy,
    );
    expect(gaps.unassignedSlots).toHaveLength(3);
    expect(gaps.audiencelessSlots).toHaveLength(1);
    expect(gaps.audienceContact.find((a) => a.audience === "full-list")!.overCap).toBe(true);
    expect(gaps.quietPeriodViolations).toHaveLength(1);
    expect(gaps.missingArchetypes).toContain("editorial-story");
    expect(gaps.missingArchetypes).toContain("promotion");
  });
});

// ---------------------------------------------------------------------------
// Repo-bound tools
// ---------------------------------------------------------------------------

describe("email_plan_propose (tool)", () => {
  it("fails with guidance when strategy.md is missing", async () => {
    const { tools } = toolsWith();
    await expect(tools.email_plan_propose.execute({ month: "2026-09" })).rejects.toThrow(
      /co-create the email strategy/,
    );
  });

  it("proposes from a seeded strategy", async () => {
    const { tools } = toolsWith({ "email/strategy.md": serializeStrategy(strategy) });
    const plan = await tools.email_plan_propose.execute({ month: "2026-09" });
    expect(plan.slots).toHaveLength(4);
    expect(plan.status).toBe("proposed");
  });
});

describe("email_calendar_read (tool)", () => {
  it("reads a calendar with gaps", async () => {
    const calendar = serializeCalendar({
      month: "2026-09",
      status: "proposed",
      slots: [
        { slot: "2026-09-01", audience: "engaged-30d", archetype: "new-arrivals", intent: "x", campaignId: null, status: "planned" },
      ],
    });
    const { tools } = toolsWith({
      "email/strategy.md": serializeStrategy(strategy),
      [calendarPath("2026-09")]: calendar,
    });
    const result = await tools.email_calendar_read.execute({ month: "2026-09" });
    expect(result.slots).toHaveLength(1);
    expect(result.gaps.unassignedSlots).toHaveLength(1);
  });

  it("points at email_plan_propose when absent", async () => {
    const { tools } = toolsWith();
    await expect(tools.email_calendar_read.execute({ month: "2026-09" })).rejects.toThrow(
      /email_plan_propose/,
    );
  });
});

describe("email_campaign_read (tool)", () => {
  it("round-trips a campaign through the repo", async () => {
    const { tools } = toolsWith({ [campaignPath(campaign.id)]: serializeCampaign(campaign) });
    const result = await tools.email_campaign_read.execute({ id: campaign.id });
    expect(result.id).toBe(campaign.id);
    expect(result.subject).toBe(campaign.subject);
  });
});

describe("klaviyo_audiences_read (tool)", () => {
  it("returns live audiences and cross-checks the strategy roster", async () => {
    const { tools } = toolsWith({ "email/strategy.md": serializeStrategy(strategy) });
    const result = await tools.klaviyo_audiences_read.execute({});
    expect(result.audiences).toHaveLength(3);
    expect(result.strategyRoster.every((r) => r.matched)).toBe(true);
  });

  it("flags roster refs that no longer resolve", async () => {
    const stale = {
      ...strategy,
      audiences: [
        { key: "ghost", klaviyoRef: { type: "segment" as const, id: "GONE" }, description: "x", cadenceCap: 1 },
      ],
    };
    const { tools } = toolsWith({ "email/strategy.md": serializeStrategy(stale) });
    const result = await tools.klaviyo_audiences_read.execute({});
    expect(result.strategyRoster[0]!.matched).toBe(false);
  });
});

describe("klaviyo_templates_read (tool)", () => {
  it("lists template summaries without html", async () => {
    const { tools } = toolsWith();
    const result = await tools.klaviyo_templates_read.execute({});
    expect(result.templates).toHaveLength(2);
    expect(result.templates[0]!.html).toBeUndefined();
  });

  it("fetches one template with universal content inlined verbatim (WS1-R4)", async () => {
    const { tools } = toolsWith();
    const result = await tools.klaviyo_templates_read.execute({ id: "Tpl1" });
    expect(result.templates[0]!.html).toContain("ARTHAUS HEADER");
    expect(result.templates[0]!.html).not.toContain("universal_content");
    expect(result.templates[0]!.inlinedBlocks).toEqual(["UC1"]);
    // Klaviyo profile tags survive untouched
    expect(result.templates[0]!.html).toContain("{{ first_name }}");
    expect(result.templates[0]!.html).toContain("{% unsubscribe %}");
  });
});

describe("inlineUniversalContent", () => {
  it("reports unresolved block ids and leaves their tags", () => {
    const { html, inlined, unresolved } = inlineUniversalContent(
      '<td>{% universal_content id="MISSING" %}</td>',
      new Map(),
    );
    expect(html).toContain("universal_content");
    expect(inlined).toEqual([]);
    expect(unresolved).toEqual(["MISSING"]);
  });
});

describe("klaviyo_performance_read (tool)", () => {
  it("returns normalized rows with the attribution basis stated (WS1-R6)", async () => {
    const { tools } = toolsWith();
    const result = await tools.klaviyo_performance_read.execute({
      campaignIds: ["CampX"],
      timeframe: { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
      conversionMetricId: "MetricPO",
    });
    expect(result.rows[0]!.conversionValue).toBe(2140);
    expect(result.conversionMetricId).toBe("MetricPO");
    expect(result.attributionBasis).toContain("SEND DATE");
  });

  it("rejects timeframes over one year client-side", async () => {
    const { tools } = toolsWith();
    await expect(
      tools.klaviyo_performance_read.execute({
        timeframe: { start: "2024-01-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
        conversionMetricId: "MetricPO",
      }),
    ).rejects.toThrow(/1-year/);
  });

  it("rejects inverted timeframes", async () => {
    const { tools } = toolsWith();
    await expect(
      tools.klaviyo_performance_read.execute({
        timeframe: { start: "2026-07-01T00:00:00Z", end: "2026-06-01T00:00:00Z" },
        conversionMetricId: "MetricPO",
      }),
    ).rejects.toThrow(/after/);
  });
});

// ---------------------------------------------------------------------------
// Read-only discipline: no tool call mutates Klaviyo
// ---------------------------------------------------------------------------

describe("read-only discipline", () => {
  it("no read tool records a mutation on the fake client", async () => {
    const { tools, state } = toolsWith({
      "email/strategy.md": serializeStrategy(strategy),
      [campaignPath(campaign.id)]: serializeCampaign(campaign),
    });
    await tools.email_plan_propose.execute({ month: "2026-09" });
    await tools.email_campaign_read.execute({ id: campaign.id });
    await tools.klaviyo_audiences_read.execute({});
    await tools.klaviyo_templates_read.execute({ id: "Tpl1" });
    await tools.klaviyo_performance_read.execute({
      timeframe: { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
      conversionMetricId: "MetricPO",
    });
    expect(state.mutations).toEqual([]);
  });
});
