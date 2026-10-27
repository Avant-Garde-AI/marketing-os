import { describe, it, expect } from "vitest";
import { activationStart } from "../templates/agents/lib/autopilot/activation";
import { autopilotWindow, socialAutopilotPolicySchema } from "../templates/agents/lib/social/autopilot";
describe("first unattended batch", () => {
  it("leaves generation time and the full opt-out period, using the merchant’s local date", () => {
    const now = new Date("2026-10-28T01:00:00Z"); // still Oct 27 in Chicago
    expect(activationStart("America/Chicago", 24, now)).toBe("2026-10-30");
    expect(activationStart("America/Chicago", 48, now)).toBe("2026-10-31");
  });
  it("starts a complete fresh fortnight without changing the daily local hour through DST", () => {
    const firstPostDate = activationStart("America/Chicago", 24, new Date("2026-10-27T15:00:00Z"));
    const policy = socialAutopilotPolicySchema.parse({schemaVersion:1,enabled:true,account:{id:"123",username:"art"},firstPostDate,timeZone:"America/Chicago",localTime:"10:00",batchDays:14,leadDays:7,maximumCredits:125,maximumJobCredits:8,minimumReviewHours:24,requireSlackNotice:true,publishUnlessPaused:true,recipeIds:["artwork-loop","real-home"]});
    const a=autopilotWindow(policy,0),b=autopilotWindow(policy,1);
    expect(a.from).toBe("2026-10-30");expect(a.through).toBe("2026-11-12");expect(a.slots).toHaveLength(14);
    expect(a.slots[0].scheduledAt).toBe("2026-10-30T15:00:00.000Z");expect(a.slots[2].scheduledAt).toBe("2026-11-01T16:00:00.000Z");
    expect(b.from).toBe("2026-11-13");expect(b.prepareOn).toBe("2026-11-06");
  });
});
