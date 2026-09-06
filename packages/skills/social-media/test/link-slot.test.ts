import { describe, expect, it } from "vitest";
import { linkPostToCalendarSlot, upsertCalendar } from "../src/authoring";
import { proposePlan } from "../src/tools";
import { calendarPath, parseCalendar } from "../src/artifacts";
import type { SocialRepo, SocialStrategy } from "../src/types";

function memoryRepo(): SocialRepo & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, c) => { files.set(p, c); },
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const strategy = {
  channels: [{ channel: "instagram", cadencePerWeek: 2 }, { channel: "threads", cadencePerWeek: 1 }],
  pillars: [{ name: "room-in-situ", weight: 4, description: "rooms" }],
  body: "",
} as unknown as SocialStrategy;

const MONTH = "2026-10";
async function seeded() {
  const repo = memoryRepo();
  await upsertCalendar(repo, { month: MONTH, calendarMarkdown: proposePlan(strategy, { month: MONTH }).calendarMarkdown });
  return repo;
}
const firstSlot = (repo: { files: Map<string, string> }) =>
  parseCalendar(repo.files.get(calendarPath(MONTH))!).slots.find((s) => s.channel === "instagram")!;

describe("linkPostToCalendarSlot", () => {
  it("attaches a post to its slot so the month sheet can find it", async () => {
    const repo = await seeded();
    const slot = firstSlot(repo);
    const r = await linkPostToCalendarSlot(repo, { id: `${slot.slot}-road-to-heaven`, channel: "instagram", status: "proposed" });
    expect(r.linked).toBe(true);
    expect(r.month).toBe(MONTH);
    const after = parseCalendar(repo.files.get(calendarPath(MONTH))!).slots.find((s) => s.slot === slot.slot && s.channel === "instagram")!;
    expect(after.postId).toBe(`${slot.slot}-road-to-heaven`);
    expect(after.status).toBe("proposed");
  });

  it("prefers scheduledAt over the id prefix — a rescheduled post belongs to the day it runs", async () => {
    const repo = await seeded();
    const slots = parseCalendar(repo.files.get(calendarPath(MONTH))!).slots.filter((s) => s.channel === "instagram");
    const later = slots[1]!;
    const r = await linkPostToCalendarSlot(repo, { id: `${slots[0]!.slot}-moved`, channel: "instagram", scheduledAt: `${later.slot}T10:00:00Z` });
    expect(r.slot).toBe(later.slot);
  });

  it("does not steal a slot that is already filled", async () => {
    const repo = await seeded();
    const slot = firstSlot(repo);
    await linkPostToCalendarSlot(repo, { id: `${slot.slot}-first`, channel: "instagram" });
    const second = await linkPostToCalendarSlot(repo, { id: `${slot.slot}-second`, channel: "instagram" });
    expect(second.linked).toBe(false);
    expect(second.note).toMatch(/no free/);
  });

  it("is idempotent — re-linking the same post is a no-op that still reports linked", async () => {
    const repo = await seeded();
    const slot = firstSlot(repo);
    const id = `${slot.slot}-road-to-heaven`;
    await linkPostToCalendarSlot(repo, { id, channel: "instagram" });
    expect((await linkPostToCalendarSlot(repo, { id, channel: "instagram" })).linked).toBe(true);
  });

  it("matches channel, so an instagram post cannot take the threads slot", async () => {
    const repo = await seeded();
    const threads = parseCalendar(repo.files.get(calendarPath(MONTH))!).slots.find((s) => s.channel === "threads")!;
    const r = await linkPostToCalendarSlot(repo, { id: `${threads.slot}-x`, channel: "instagram" });
    if (r.linked) {
      const after = parseCalendar(repo.files.get(calendarPath(MONTH))!).slots.find((s) => s.postId === `${threads.slot}-x`)!;
      expect(after.channel).toBe("instagram");
    }
  });

  it("an unplanned month is a normal answer, not a failure", async () => {
    const repo = memoryRepo();
    const r = await linkPostToCalendarSlot(repo, { id: "2026-12-01-adhoc", channel: "instagram" });
    expect(r.linked).toBe(false);
    expect(r.note).toMatch(/no calendar/);
  });

  it("a post with no date reports why rather than throwing", async () => {
    const repo = await seeded();
    const r = await linkPostToCalendarSlot(repo, { id: "evergreen-post", channel: "instagram" });
    expect(r.linked).toBe(false);
    expect(r.note).toMatch(/no date/);
  });
});
