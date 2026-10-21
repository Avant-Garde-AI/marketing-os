import { describe, expect, it, vi } from "vitest";
import { proposeEmailPlan } from "../templates/agents/lib/email/plan";
import { parseStrategy, serializeStrategy } from "../templates/agents/lib/email/artifacts";
import type { EmailStrategy } from "../templates/agents/lib/email/types";
import { jsonSchemaFromZod } from "../templates/agents/lib/mcp/zod-schema";
import { emailCampaignUpsertInputSchema } from "../templates/agents/src/mastra/tools/email-authoring";

// The CLI package does not install Mastra; generated consoles do.
vi.mock("@mastra/core/tools", () => ({ createTool: (definition: unknown) => definition }));

const audience = (key: string, extra: Partial<EmailStrategy["audiences"][number]> = {}) => ({
  key,
  klaviyoRef: { type: "segment" as const, id: `Seg-${key}` },
  description: key,
  cadenceCap: 8,
  ...extra,
});

const strategy: EmailStrategy = {
  audiences: [audience("engaged-30d"), audience("collectors")],
  archetypes: [
    { name: "new-arrivals", messagingRef: "brand.md §6", weight: 3 },
    { name: "editorial-story", messagingRef: "brand.md §10", weight: 2 },
  ],
  campaignsPerMonth: 7,
  sendDays: ["tuesday", "thursday"],
  sendTime: "10:00",
  guardrails: { maxCampaignsPerWeek: 3 },
  body: "",
};

describe("proposeEmailPlan (template copy)", () => {
  // November 2026 opens on a Sunday and closes on a Monday: two one-day edge
  // weeks with no Tuesday or Thursday in them.
  it("places every slot on a send day, none on the edge weeks", () => {
    const plan = proposeEmailPlan(strategy, { month: "2026-11" });
    expect(plan.slots).toHaveLength(7);
    for (const slot of plan.slots) {
      expect([2, 4]).toContain(new Date(`${slot.slot}T00:00:00Z`).getUTCDay());
    }
    const days = plan.slots.map((s) => s.slot);
    expect(days).not.toContain("2026-11-01");
    expect(days).not.toContain("2026-11-30");
    expect(new Set(days).size).toBe(days.length);
    expect(proposeEmailPlan(strategy, { month: "2026-11" })).toEqual(plan);
  });

  it("names the shortfall when send days run out", () => {
    const plan = proposeEmailPlan({ ...strategy, campaignsPerMonth: 10 }, { month: "2026-11" });
    expect(plan.slots).toHaveLength(8);
    expect(plan.warnings.some((w) => w.includes("shortfall: 2 of 10"))).toBe(true);
  });

  it("never assigns an audience with rotation: false", () => {
    const roster: EmailStrategy = {
      ...strategy,
      audiences: [
        audience("full-reach-us", { rotation: false }),
        audience("engaged-30d"),
        audience("newsletter", { rotation: false }),
        audience("collectors"),
        audience("engaged-or-new", { rotation: false }),
      ],
    };
    const plan = proposeEmailPlan(roster, { month: "2026-11" });
    expect(new Set(plan.slots.map((s) => s.audience))).toEqual(new Set(["engaged-30d", "collectors"]));
  });

  it("carries the rotation flag through strategy.md", () => {
    const flagged: EmailStrategy = { ...strategy, audiences: [audience("newsletter", { rotation: false })] };
    expect(parseStrategy(serializeStrategy(flagged)).audiences[0]!.rotation).toBe(false);
  });
});

describe("email_campaign_upsert MCP schema", () => {
  const schema = jsonSchemaFromZod(emailCampaignUpsertInputSchema) as any;

  it("declares headlineOptions as an array of option objects", () => {
    const headlineOptions = schema.properties.headlineOptions;
    expect(headlineOptions.type).toBe("array");
    expect(headlineOptions.items.type).toBe("object");
    expect(Object.keys(headlineOptions.items.properties)).toEqual(["id", "headline", "subheadline", "why"]);
    expect(headlineOptions.items.required).toEqual(["id", "headline", "subheadline"]);
  });

  it("declares the fields the hand-written copy was missing", () => {
    expect(schema.properties.selectedHeadlineId.type).toBe("string");
    expect(schema.properties.discountCode.type).toBe("string");
    expect(schema.required).toEqual(["id"]);
  });

  it("accepts an audience by roster key alone", () => {
    expect(schema.properties.audienceIncluded.items.required).toBeUndefined();
    expect(emailCampaignUpsertInputSchema.safeParse({ id: "x", audienceIncluded: [{ key: "full-reach" }] }).success).toBe(true);
  });
});
