import { describe, it, expect, vi } from "vitest";
import { createSocialActions, approvalHash } from "../src/actions";
import { parsePost, serializePost, postPath } from "../src/artifacts";
import type { SocialPost, SocialRepo } from "../src/types";
const post = (): SocialPost => ({ id: "carousel", channel: "instagram", copy: "Exact caption @artist", status: "asset_ready",
  channelAccount: { id: "123", username: "store" }, assetRefs: [], targetLink: "https://store.example", provenance: [], body: "",
  renderedSequence: { version: 1, origin: "generation-delivery", parentPostId: "carousel", manifestHash: "a".repeat(64),
    deliveryHashes: ["b".repeat(64), "c".repeat(64)], slides: [1,2].map(n => ({ beatId: `job-${n}`, boardName: `slide-${n}`,
      url: `https://store.example/${n}.jpeg`, sha256: String(n).repeat(64), width: 1080, height: 1350 })) } });
function setup() {
  const p = post(); const files = new Map([[postPath(p.id), serializePost(p)]]);
  const repo: SocialRepo = { readFile: async path => files.get(path) ?? null, list: async () => [...files.keys()], writeFile: async (path, raw) => { files.set(path, raw); } };
  const submit = vi.fn(async () => {
    expect(parsePost(files.get(postPath(p.id))!).publishAttempt?.state).toBe("started");
    return { platformId: "live", permalink: "https://instagram.com/p/live" };
  });
  const lock = vi.fn(async (_id, run) => run());
  const actions = createSocialActions({ repo, adapterFor: () => ({ channel: "instagram", publish: submit, publishSequence: submit }),
    assetUrl: () => "unused", withPostLock: lock });
  return { p, files, repo, submit, lock, actions };
}
describe("verified generation delivery publishing", () => {
  it("roundtrips honest provenance and binds destination, slide order, caption and time into consent", () => {
    const p = post(); expect(parsePost(serializePost(p))).toEqual(p);
    const hash = approvalHash(p); p.channelAccount!.id = "456"; expect(approvalHash(p)).not.toBe(hash);
    const destination = approvalHash(p); p.renderedSequence!.slides.reverse(); expect(approvalHash(p)).not.toBe(destination);
    expect("storyboardId" in p.renderedSequence!).toBe(false);
  });
  it("records an attempt before contacting Instagram and returns an existing publication on retry", async () => {
    const { p, actions, submit, files, lock } = setup();
    await actions.publishPost.execute({ postId: p.id });
    expect(parsePost(files.get(postPath(p.id))!).publishAttempt?.state).toBe("completed");
    await actions.publishPost.execute({ postId: p.id }); expect(submit).toHaveBeenCalledTimes(1); expect(lock).toHaveBeenCalledTimes(2);
  });
  it("blocks retries after an ambiguous provider response", async () => {
    const { p, actions, submit, files } = setup(); submit.mockRejectedValueOnce(new Error("connection lost after submission"));
    await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow("connection lost");
    expect(parsePost(files.get(postPath(p.id))!).publishAttempt?.state).toBe("unknown");
    await expect(actions.publishPost.preview({ postId: p.id })).rejects.toThrow("reconciliation");
    await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow("reconciliation"); expect(submit).toHaveBeenCalledTimes(1);
  });
  it("never contacts Instagram if persisting the attempt failed", async () => {
    const { p, actions, repo, submit } = setup(); repo.writeFile = async () => { throw Error("storage unavailable"); };
    await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow("storage unavailable"); expect(submit).not.toHaveBeenCalled();
  });
  it("refuses to submit when a mirror fallback cannot read back the attempt", async () => {
    const { p, actions, repo, submit } = setup(); repo.writeFile = async () => {};
    await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow("read back"); expect(submit).not.toHaveBeenCalled();
  });
  it("rechecks scheduled consent inside the publishing lock", async () => {
    const { p, actions, files, submit } = setup();
    await actions.schedulePost.execute({ postId: p.id, scheduledAt: "2099-01-01T10:00:00Z" });
    const changed = parsePost(files.get(postPath(p.id))!); changed.copy = "Changed after approval"; files.set(postPath(p.id), serializePost(changed));
    await expect(actions.publishPost.execute({ postId: p.id })).rejects.toThrow("publish material changed"); expect(submit).not.toHaveBeenCalled();
  });
});
