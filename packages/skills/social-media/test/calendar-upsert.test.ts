import { describe, expect, it } from "vitest";
import { upsertCalendar } from "../src/authoring";
import { proposePlan } from "../src/tools";
import { calendarPath, parseCalendar } from "../src/artifacts";
import type { SocialRepo, SocialStrategy } from "../src/types";

function memoryRepo(seed: Record<string, string> = {}): SocialRepo & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, c) => { files.set(p, c); },
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const strategy: SocialStrategy = {
  channels: [{ channel: "instagram", cadencePerWeek: 2 }],
  pillars: [
    { name: "room-in-situ", weight: 4, description: "The work in a room." },
    { name: "work-detail", weight: 2, description: "Close on the work." },
  ],
  body: "",
} as unknown as SocialStrategy;

const MONTH = "2026-10";
const proposal = () => proposePlan(strategy, { month: MONTH });

describe("upsertCalendar", () => {
  it("persists a proposal that previously lived only in the conversation", async () => {
    const repo = memoryRepo();
    const p = proposal();
    const r = await upsertCalendar(repo, { month: MONTH, calendarMarkdown: p.calendarMarkdown });

    expect(r.created).toBe(true);
    expect(r.path).toBe(calendarPath(MONTH));
    expect(r.slotCount).toBeGreaterThan(0);
    // The written file must read back — an unparseable calendar renders as the
    // same empty state as no calendar, and only one of those is a bug.
    expect(parseCalendar(repo.files.get(calendarPath(MONTH))!).month).toBe(MONTH);
  });

  it("reports updated rather than created on a re-plan", async () => {
    const repo = memoryRepo();
    const md = proposal().calendarMarkdown;
    await upsertCalendar(repo, { month: MONTH, calendarMarkdown: md });
    expect((await upsertCalendar(repo, { month: MONTH, calendarMarkdown: md })).created).toBe(false);
  });

  it("refuses to silently discard an approved month", async () => {
    const repo = memoryRepo();
    const md = proposal().calendarMarkdown;
    await upsertCalendar(repo, { month: MONTH, calendarMarkdown: md });
    // Approve it the way a human would — status flips in the artifact.
    repo.files.set(calendarPath(MONTH), repo.files.get(calendarPath(MONTH))!.replace("status: proposed", "status: approved"));
    await expect(upsertCalendar(repo, { month: MONTH, calendarMarkdown: md })).rejects.toThrow(/already approved/);
  });

  it("overwrites an approved month only when told to", async () => {
    const repo = memoryRepo();
    const md = proposal().calendarMarkdown;
    await upsertCalendar(repo, { month: MONTH, calendarMarkdown: md });
    repo.files.set(calendarPath(MONTH), repo.files.get(calendarPath(MONTH))!.replace("status: proposed", "status: approved"));
    const r = await upsertCalendar(repo, { month: MONTH, calendarMarkdown: md, replaceApproved: true });
    expect(r.created).toBe(false);
  });

  it("rejects a month/markdown mismatch instead of writing to the wrong path", async () => {
    const repo = memoryRepo();
    await expect(
      upsertCalendar(repo, { month: "2026-11", calendarMarkdown: proposal().calendarMarkdown }),
    ).rejects.toThrow(/month mismatch/);
  });

  it("rejects empty markdown with a message that names the fix", async () => {
    const repo = memoryRepo();
    await expect(upsertCalendar(repo, { month: MONTH, calendarMarkdown: "   " })).rejects.toThrow(/social_plan_propose/);
  });

  it("rejects a malformed month", async () => {
    const repo = memoryRepo();
    await expect(upsertCalendar(repo, { month: "Oct", calendarMarkdown: "x" })).rejects.toThrow(/YYYY-MM/);
  });
});
