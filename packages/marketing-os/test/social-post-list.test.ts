import { describe, it, expect } from "vitest";
import { loadSocialPostList } from "../templates/agents/lib/social/post-list";
import { serializePost } from "../templates/agents/lib/social/artifacts";

describe("Social board reads", () => {
  it("reads concurrently within a fixed bound, retains order and surfaces broken records", async () => {
    let active = 0, peak = 0;
    const ids = Array.from({ length: 15 }, (_, i) => `post-${String(i).padStart(2, "0")}`);
    const result = await loadSocialPostList({
      list: async () => ids.map(id => `social/posts/${id}/post.md`),
      readFile: async path => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active--;
        if (path.includes("post-04")) throw new Error("unavailable");
        if (path.includes("post-05")) return null;
        return serializePost({ id: path.split("/")[2]!, channel: "instagram", copy: "A real draft", assetRefs: [],
          targetLink: "https://store.example", provenance: [], status: "proposed", body: "" });
      },
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
    expect(result.unreadable).toBe(1);
    expect(result.posts.map(p => p.id)).toEqual(ids.filter(id => !["post-04", "post-05"].includes(id)));
    expect(result.posts.every(p => p.status === "proposed" && !p.approval && !p.scheduledAt)).toBe(true);
  });
  it("surfaces repository list failures instead of rendering a false empty board", async () => {
    await expect(loadSocialPostList({ list: async () => { throw new Error("GitHub unavailable"); }, readFile: async () => null }))
      .rejects.toThrow("GitHub unavailable");
  });
});
