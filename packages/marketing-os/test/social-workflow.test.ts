import { describe, it, expect } from "vitest";
import { socialWorkflow } from "../templates/agents/lib/social/workflow";
import { calendarVisibility, visibleOnCalendar } from "../templates/agents/lib/calendar/visibility";
import type { SocialPost } from "../templates/agents/lib/social/types";
import { postCalendarProjection, postIndexRow } from "../templates/agents/lib/social/projection";
const now = Date.parse("2026-10-07T14:00:00Z");
const post: SocialPost = { id: "post", channel: "instagram", copy: "A story", assetRefs: [], targetLink: "https://store.example", provenance: [], body: "", status: "proposed", plannedAt: "2026-10-07T15:00:00Z" };
describe("workflow and calendar consent distinctions", () => {
  it("places an immediate publication by its real result time without inventing schedule consent", () => {
    const p: SocialPost = { ...post, status: "published", plannedAt: undefined, platform: { id: "ig", permalink: "https://instagram.com/p/live", publishedAt: "2026-11-01T15:00:00Z" } };
    expect(postCalendarProjection(p, "https://console.example")).toMatchObject({ month: "2026-11", scheduledAt: p.platform!.publishedAt });
    expect(postIndexRow(p).scheduledAt).toBeNull();
    expect(p.approval).toBeUndefined();
  });
  it("never treats a dated proposal or ready creative as scheduled", () => {
    for (const status of ["proposed", "approved", "asset_ready"] as const) {
      expect(visibleOnCalendar({ status, scheduledAt: post.plannedAt! }, calendarVisibility())).toBe(false);
      expect(visibleOnCalendar({ status, scheduledAt: post.plannedAt! }, "all")).toBe(true);
    }
    expect(socialWorkflow(post, now).stage).toBe("draft");
    expect(socialWorkflow({ ...post, status: "asset_ready" }, now).stage).toBe("ready");
    expect(post).not.toHaveProperty("approval");
    expect(post).not.toHaveProperty("scheduledAt");
  });
  it("retains published history in the default and allows scheduled-only across channels", () => {
    for (const status of ["published", "sent", "measured"]) {
      expect(visibleOnCalendar({ status, scheduledAt: post.plannedAt! }, "live")).toBe(true);
      expect(visibleOnCalendar({ status, scheduledAt: post.plannedAt! }, "scheduled")).toBe(false);
    }
    expect(visibleOnCalendar({ status: "scheduled", scheduledAt: post.plannedAt! }, "scheduled")).toBe(true);
    expect(calendarVisibility("unknown")).toBe("live");
  });
  it("flags overdue schedules without changing their lifecycle or authorizing retries", () => {
    const p = { ...post, status: "scheduled" as const, scheduledAt: "2026-10-07T13:00:00Z" };
    expect(socialWorkflow(p, now).stage).toBe("attention");
    expect(socialWorkflow(p, now).explanation).toContain("do not blindly retry");
    expect(p.status).toBe("scheduled");
    expect(visibleOnCalendar(p, "live")).toBe(true);
  });
  it("marks ambiguous attempts and invalid scheduled timestamps as needing attention", () => {
    for (const state of ["started", "unknown"] as const)
      expect(socialWorkflow({ ...post, status: "failed", publishAttempt: { state, startedAt: new Date(now).toISOString() } }, now).label).toBe("Delivery needs checking");
    expect(socialWorkflow({ ...post, status: "scheduled" }, now).stage).toBe("attention");
    expect(visibleOnCalendar({ status: "scheduled", scheduledAt: null }, "live")).toBe(false);
    expect(visibleOnCalendar({ status: "scheduled", scheduledAt: "invalid" }, "live")).toBe(false);
  });
});
