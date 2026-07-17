import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "../src/repo";

describe("createMemoryRepo", () => {
  it("reads seeded files and returns null for missing ones", async () => {
    const repo = createMemoryRepo({ "email/strategy.md": "---\n---\n" });
    expect(await repo.readFile("email/strategy.md")).toBe("---\n---\n");
    expect(await repo.readFile("email/nope.md")).toBeNull();
  });

  it("writes and lists by prefix, sorted", async () => {
    const repo = createMemoryRepo();
    await repo.writeFile("email/campaigns/b/campaign.md", "b");
    await repo.writeFile("email/campaigns/a/campaign.md", "a");
    await repo.writeFile("social/strategy.md", "s");
    expect(await repo.list("email/campaigns/")).toEqual([
      "email/campaigns/a/campaign.md",
      "email/campaigns/b/campaign.md",
    ]);
  });
});
