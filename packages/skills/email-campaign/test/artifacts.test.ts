import { describe, expect, it } from "vitest";
import {
  calendarPath,
  campaignAssetsPrefix,
  campaignHtmlPath,
  campaignPath,
  parseCalendar,
  parseCampaign,
  parseRegistry,
  parseSkeleton,
  parseStrategy,
  serializeCalendar,
  serializeCampaign,
  serializeRegistry,
  serializeSkeleton,
  serializeStrategy,
  skeletonHtmlPath,
  skeletonPath,
} from "../src/artifacts";
import type { EmailCalendar, EmailSkeleton } from "../src/types";
import { campaign, strategy } from "./fixtures";

describe("paths", () => {
  it("builds canonical repo paths", () => {
    expect(calendarPath("2026-08")).toBe("email/calendar/2026-08.md");
    expect(campaignPath("c-1")).toBe("email/campaigns/c-1/campaign.md");
    expect(campaignHtmlPath("c-1")).toBe("email/campaigns/c-1/email.html");
    expect(campaignAssetsPrefix("c-1")).toBe("email/campaigns/c-1/assets/");
    expect(skeletonPath("sk-1")).toBe("email/templates/skeletons/sk-1/skeleton.md");
    expect(skeletonHtmlPath("sk-1")).toBe("email/templates/skeletons/sk-1/skeleton.html");
  });

  it("rejects invalid ids and months", () => {
    expect(() => calendarPath("2026-13")).toThrow(/YYYY-MM/);
    expect(() => campaignPath("../evil")).toThrow(/invalid campaign id/);
    expect(() => skeletonPath("a b")).toThrow(/invalid skeleton id/);
  });
});

describe("strategy round-trip", () => {
  it("parse(serialize(x)) deep-equals x", () => {
    expect(parseStrategy(serializeStrategy(strategy))).toEqual(strategy);
  });

  it("rejects missing audiences", () => {
    const bad = serializeStrategy(strategy).replace(/audiences:[\s\S]*?archetypes:/, "archetypes:");
    expect(() => parseStrategy(bad)).toThrow(/audiences/);
  });

  it("rejects malformed sendTime", () => {
    const raw = serializeStrategy({ ...strategy, sendTime: "10am" as never });
    expect(() => parseStrategy(raw)).toThrow(/sendTime/);
  });
});

describe("calendar round-trip", () => {
  const calendar: EmailCalendar = {
    month: "2026-08",
    status: "proposed",
    slots: [
      {
        slot: "2026-08-04",
        audience: "engaged-30d",
        archetype: "new-arrivals",
        intent: "brand.md §6 — discovery messaging",
        campaignId: null,
        status: "planned",
      },
      {
        slot: "2026-08-06",
        audience: null,
        archetype: "editorial-story",
        intent: "feature: botanical prints",
        campaignId: "2026-08-editorial",
        status: "proposed",
      },
    ],
    notes: "August plan.",
  };

  it("parse(serialize(x)) deep-equals x", () => {
    expect(parseCalendar(serializeCalendar(calendar))).toEqual(calendar);
  });

  it("round-trips null audience and campaignId through the — cell", () => {
    const serialized = serializeCalendar(calendar);
    expect(serialized).toContain("| — |");
    const back = parseCalendar(serialized);
    expect(back.slots[0]!.campaignId).toBeNull();
    expect(back.slots[1]!.audience).toBeNull();
  });

  it("rejects a wrong table header", () => {
    const bad = serializeCalendar(calendar).replace("| slot |", "| day |");
    expect(() => parseCalendar(bad)).toThrow(/unexpected table header/);
  });

  it("rejects non-ISO slot dates", () => {
    const bad = serializeCalendar(calendar).replace("2026-08-04", "Aug 4");
    expect(() => parseCalendar(bad)).toThrow(/not an ISO date/);
  });
});

describe("campaign round-trip", () => {
  it("parse(serialize(x)) deep-equals x", () => {
    expect(parseCampaign(serializeCampaign(campaign))).toEqual(campaign);
  });

  it("preserves the rationale body verbatim", () => {
    expect(parseCampaign(serializeCampaign(campaign)).body).toBe(campaign.body);
  });

  it("rejects invalid statuses", () => {
    const raw = serializeCampaign({ ...campaign, status: "shipped" as never });
    expect(() => parseCampaign(raw)).toThrow(/status/);
  });

  it("rejects a surface section without alt text (04 §5 — alt is mandatory)", () => {
    const bad = {
      ...campaign,
      sections: [{ slot: "hero", type: "surface" as const, alt: "" }],
    };
    expect(() => parseCampaign(serializeCampaign(bad))).toThrow(/alt/);
  });

  it("rejects an html section with no blocks", () => {
    const bad = {
      ...campaign,
      sections: [{ slot: "body-1", type: "html" as const, blocks: [] }],
    };
    expect(() => parseCampaign(serializeCampaign(bad))).toThrow(/blocks/);
  });

  it("carries every 02 §3 field through the round-trip", () => {
    const back = parseCampaign(serializeCampaign(campaign));
    expect(back.audience.included[0]!.estimatedSize).toBe(1240);
    expect(back.subjectCandidates).toHaveLength(2);
    expect(back.skeletonRef).toBe("arthaus-editorial-v1");
    expect(back.utm).toEqual({ campaign: "2026-08-new-arrivals", source: "klaviyo", medium: "email" });
    expect(back.klaviyo?.templateId).toBe("Tpl1");
    expect(back.provenance).toHaveLength(2);
  });
});

describe("skeleton round-trip", () => {
  const skeleton: EmailSkeleton = {
    id: "arthaus-editorial-v1",
    sourceTemplateId: "Tpl1",
    sourceTemplateName: "Arthaus Editorial",
    ingestedAt: "2026-07-17T10:00:00Z",
    transforms: ["stripped tracking pixel", "normalized #B07D4E → token bronze"],
    slots: [
      { name: "hero", maxWidth: 600, backgroundContext: "#F5F2ED", paddingContext: "0" },
      { name: "body-1", maxWidth: 520 },
    ],
    version: 1,
    approvedBy: "garrett",
    body: "Extracted from the store's editorial template.",
  };

  it("parse(serialize(x)) deep-equals x", () => {
    expect(parseSkeleton(serializeSkeleton(skeleton))).toEqual(skeleton);
  });

  it("rejects a non-positive version", () => {
    const raw = serializeSkeleton({ ...skeleton, version: 0 });
    expect(() => parseSkeleton(raw)).toThrow(/version/);
  });
});

describe("registry", () => {
  it("round-trips and sorts deterministically", () => {
    const reg = { winback: "VDrETF", editorial: "Ye97Hz" };
    const serialized = serializeRegistry(reg);
    expect(serialized.indexOf("editorial")).toBeLessThan(serialized.indexOf("winback"));
    expect(parseRegistry(serialized)).toEqual(reg);
    expect(serializeRegistry(parseRegistry(serialized))).toBe(serialized);
  });

  it("rejects non-object and non-string ids", () => {
    expect(() => parseRegistry("[]")).toThrow(/expected an object/);
    expect(() => parseRegistry('{"a": 1}')).toThrow(/non-string id/);
    expect(() => parseRegistry("not json")).toThrow(/invalid JSON/);
  });
});
