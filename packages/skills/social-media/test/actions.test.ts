import { describe, expect, it } from "vitest";
import {
  approvalHash,
  createSocialActions,
  verifyScheduleConsent,
  type SocialActionDeps,
} from "../src/actions";
import { parsePost, postPath, serializePost } from "../src/artifacts";
import type { SocialPost, SocialRepo } from "../src/types";

function memoryRepo(seed: Record<string, string> = {}): SocialRepo & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

function assetReadyPost(): SocialPost {
  return {
    id: "2026-08-01-atelier",
    channel: "instagram",
    copy: "The atelier collection, in situ.",
    assetRefs: ["social/posts/2026-08-01-atelier/assets/creative.jpeg"],
    designSurface: { teamId: "team-1", fileId: "file-1", pageId: "page-1" },
    targetLink: "https://myarthaus.com/collections/atelier",
    provenance: [{ claim: "collection is live", origin: "data" }],
    status: "asset_ready",
    body: "Planned from the August calendar.",
  };
}

/** Deps whose revision seam replays a scripted sequence of canvas revisions. */
function depsWithRevisions(
  repo: SocialRepo,
  revisions: (number | null)[],
): SocialActionDeps & { revisionCalls: number } {
  const state = {
    revisionCalls: 0,
    repo,
    adapterFor: () => {
      throw new Error("no adapter in this test");
    },
    assetUrl: () => "https://example.test/export/file-1?format=jpeg",
    surfaceRevision: async () => {
      const i = Math.min(state.revisionCalls, revisions.length - 1);
      state.revisionCalls++;
      return revisions[i];
    },
  };
  return state;
}

const FUTURE = "2027-01-01T10:00:00+00:00";

describe("social.schedule_post revision capture", () => {
  it("records the canvas revision in the approval", async () => {
    const post = assetReadyPost();
    const repo = memoryRepo({ [postPath(post.id)]: serializePost(post) });
    const deps = depsWithRevisions(repo, [7]);
    await createSocialActions(deps).schedulePost.execute({ postId: post.id, scheduledAt: FUTURE });
    const stored = parsePost(repo.files.get(postPath(post.id))!);
    expect(stored.status).toBe("scheduled");
    expect(stored.approval?.surfaceRevn).toBe(7);
    expect(stored.approval?.hash).toBe(approvalHash(stored));
  });

  it("omits surfaceRevn when the canvas is unreachable (null seam)", async () => {
    const post = assetReadyPost();
    const repo = memoryRepo({ [postPath(post.id)]: serializePost(post) });
    const deps = depsWithRevisions(repo, [null]);
    await createSocialActions(deps).schedulePost.execute({ postId: post.id, scheduledAt: FUTURE });
    const stored = parsePost(repo.files.get(postPath(post.id))!);
    expect(stored.approval?.surfaceRevn).toBeUndefined();
    expect(stored.approval?.hash).toBe(approvalHash(stored));
  });

  it("works without the optional seam bound (pre-seam deps shape)", async () => {
    const post = assetReadyPost();
    const repo = memoryRepo({ [postPath(post.id)]: serializePost(post) });
    const deps = depsWithRevisions(repo, [1]);
    delete (deps as Partial<SocialActionDeps>).surfaceRevision;
    await createSocialActions(deps).schedulePost.execute({ postId: post.id, scheduledAt: FUTURE });
    const stored = parsePost(repo.files.get(postPath(post.id))!);
    expect(stored.status).toBe("scheduled");
    expect(stored.approval?.surfaceRevn).toBeUndefined();
  });
});

describe("verifyScheduleConsent", () => {
  async function scheduled(revisions: (number | null)[]): Promise<{
    post: SocialPost;
    deps: SocialActionDeps & { revisionCalls: number };
    repo: SocialRepo & { files: Map<string, string> };
  }> {
    const post = assetReadyPost();
    const repo = memoryRepo({ [postPath(post.id)]: serializePost(post) });
    const deps = depsWithRevisions(repo, revisions);
    await createSocialActions(deps).schedulePost.execute({ postId: post.id, scheduledAt: FUTURE });
    return { post: parsePost(repo.files.get(postPath(post.id))!), deps, repo };
  }

  it("passes when nothing changed", async () => {
    const { post, deps } = await scheduled([4, 4]);
    expect(await verifyScheduleConsent(post, deps)).toEqual({ ok: true });
  });

  it("fails on publish-material drift (the original hash check)", async () => {
    const { post, deps } = await scheduled([4, 4]);
    const edited = { ...post, copy: "New caption sneaked in after approval" };
    const verdict = await verifyScheduleConsent(edited, deps);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("publish material changed");
  });

  it("fails when the canvas was edited without changing the binding (the blind spot)", async () => {
    const { post, deps } = await scheduled([4, 9]);
    const verdict = await verifyScheduleConsent(post, deps);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("revision 4 → 9");
  });

  it("skips the revision check when the canvas is unreachable at verify time", async () => {
    const { post, deps } = await scheduled([4, null]);
    expect(await verifyScheduleConsent(post, deps)).toEqual({ ok: true });
  });

  it("skips the revision check for approvals recorded before the seam existed", async () => {
    const { post, deps } = await scheduled([null, 12]);
    expect(post.approval?.surfaceRevn).toBeUndefined();
    expect(await verifyScheduleConsent(post, deps)).toEqual({ ok: true });
  });

  it("fails a scheduled post with no approval record", async () => {
    const post: SocialPost = { ...assetReadyPost(), status: "scheduled", scheduledAt: FUTURE };
    const verdict = await verifyScheduleConsent(post, { surfaceRevision: async () => 1 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("no approval record");
  });
});
