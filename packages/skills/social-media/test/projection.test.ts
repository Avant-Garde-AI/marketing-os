import { describe, expect, it } from "vitest";
import {
  UNSCHEDULED_MONTH,
  postCalendarProjection,
  postDetailPath,
  postIndexRow,
  postMonth,
  postThumbnailUrl,
  groupKey,
  groupPosts,
} from "../src/projection";
import { nextPost, schedulingGaps, upsertPost } from "../src/authoring";
import { parsePost, postPath, serializePost } from "../src/artifacts";
import type { SocialPost, SocialRepo } from "../src/types";

const PUBLIC_URL = "https://www.arthaus.cloud";

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

function post(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "2026-09-14-atelier-hours",
    channel: "instagram",
    copy: "The atelier, before opening.\nA second line.",
    assetRefs: [],
    targetLink: "https://myarthaus.com/collections/atelier",
    provenance: [{ claim: "collection is live", origin: "data" }],
    status: "proposed",
    body: "Rationale.",
    ...overrides,
  };
}

describe("postMonth", () => {
  it("prefers the schedule", () => {
    expect(postMonth(post({ scheduledAt: "2026-10-02T15:00:00+00:00" }))).toBe("2026-10");
  });
  it("falls back to a date-prefixed id", () => {
    expect(postMonth(post())).toBe("2026-09");
  });
  it("falls back to unscheduled rather than inventing a month", () => {
    expect(postMonth(post({ id: "atelier-hours" }))).toBe(UNSCHEDULED_MONTH);
  });
  it("rejects a bogus month in the id prefix", () => {
    expect(postMonth(post({ id: "2026-13-nope" }))).toBe(UNSCHEDULED_MONTH);
  });
});

describe("postThumbnailUrl", () => {
  const bound = post({ designSurface: { teamId: "t", fileId: "f-1", pageId: "p-1" } });

  it("builds the durable export URL (re-renders on GET; no signature, no expiry)", () => {
    expect(postThumbnailUrl(bound, PUBLIC_URL)).toBe(
      `${PUBLIC_URL}/api/design-surfaces/export/f-1?format=jpeg&pageId=p-1`,
    );
  });

  it("pins the approved revision so canvas drift changes the stored URL", () => {
    const approved = { ...bound, approval: { hash: "h", at: "2026-09-01T00:00:00+00:00", surfaceRevn: 7 } };
    expect(postThumbnailUrl(approved, PUBLIC_URL)).toContain("revn=7");
  });

  it("is undefined with no bound surface — the calendar renders a text card", () => {
    expect(postThumbnailUrl(post(), PUBLIC_URL)).toBeUndefined();
  });

  it("is undefined rather than a relative URL when no public url is configured", () => {
    expect(postThumbnailUrl(bound, "")).toBeUndefined();
  });

  it("tolerates a trailing slash on the public url", () => {
    expect(postThumbnailUrl(bound, "https://x.test/")).toBe(
      "https://x.test/api/design-surfaces/export/f-1?format=jpeg&pageId=p-1",
    );
  });
});

describe("postCalendarProjection", () => {
  it("projects onto the shared contract with the caption's first line as title", () => {
    const p = post({ scheduledAt: "2026-09-14T15:00:00+00:00" });
    expect(postCalendarProjection(p, PUBLIC_URL)).toEqual({
      channel: "social",
      packId: "social-media",
      itemId: p.id,
      month: "2026-09",
      scheduledAt: "2026-09-14T15:00:00+00:00",
      status: "proposed",
      intent: "instagram",
      title: "The atelier, before opening.",
    });
  });

  it("truncates a long first line to a scannable length, with an ellipsis", () => {
    const title = postCalendarProjection(post({ copy: "x".repeat(200) }), PUBLIC_URL).title;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to the id so a row is never blank", () => {
    expect(postCalendarProjection(post({ copy: "   \n  " }), PUBLIC_URL).title).toBe(
      "2026-09-14-atelier-hours",
    );
  });

  it("omits scheduledAt when unscheduled (backlog lane)", () => {
    expect(postCalendarProjection(post(), PUBLIC_URL).scheduledAt).toBeUndefined();
  });

  it("detail path matches the platform's social route mapping", () => {
    expect(postDetailPath(post())).toBe("/social/posts/2026-09-14-atelier-hours");
  });
});

describe("postIndexRow", () => {
  it("flattens every field the pack-private index needs", () => {
    const p = post({
      scheduledAt: "2026-09-14T15:00:00+00:00",
      status: "scheduled",
      designSurface: { teamId: "t", fileId: "f-1", pageId: "p-1" },
      approval: { hash: "abc", at: "2026-09-01T00:00:00+00:00", surfaceRevn: 4 },
      platform: { id: "ig-1", permalink: "https://instagram.com/p/x", publishedAt: "2026-09-14T15:01:00+00:00" },
    });
    expect(postIndexRow(p)).toMatchObject({
      id: p.id,
      channel: "instagram",
      calendarMonth: "2026-09",
      status: "scheduled",
      surfaceFileId: "f-1",
      surfaceRevn: 4,
      approvalHash: "abc",
      platformId: "ig-1",
      repoPath: postPath(p.id),
    });
  });

  it("nulls absent optionals rather than emitting undefined", () => {
    const row = postIndexRow(post());
    expect(row.surfaceFileId).toBeNull();
    expect(row.approvalHash).toBeNull();
    expect(row.platformId).toBeNull();
    expect(row.scheduledAt).toBeNull();
  });
});

describe("social_post_upsert lifecycle rules", () => {
  it("creates a post as 'proposed' — authoring never promotes status", () => {
    const { post: created, created: isNew } = nextPost(null, {
      id: "2026-09-20-x",
      channel: "instagram",
      copy: "Hello",
      targetLink: "https://myarthaus.com/x",
    });
    expect(isNew).toBe(true);
    expect(created.status).toBe("proposed");
  });

  it("refuses to create without the required fields", () => {
    expect(() => nextPost(null, { id: "2026-09-20-x", copy: "Hello" })).toThrow(
      /does not exist — pass channel, targetLink/,
    );
  });

  it("refuses to edit a published post (the record must not drift)", () => {
    expect(() => nextPost(post({ status: "published" }), { id: "x", copy: "edit" })).toThrow(
      /frozen/,
    );
  });

  it("never promotes status on content edit", () => {
    const existing = post({ status: "asset_ready" });
    expect(nextPost(existing, { id: existing.id, copy: "new caption" }).post.status).toBe(
      "asset_ready",
    );
  });

  it("clears consent and reverts to asset_ready when a material field changes (D2)", () => {
    const scheduled = post({
      status: "scheduled",
      scheduledAt: "2026-09-14T15:00:00+00:00",
      designSurface: { teamId: "t", fileId: "f", pageId: "p" },
      approval: { hash: "abc", at: "2026-09-01T00:00:00+00:00", surfaceRevn: 3 },
    });
    const { post: next, consentCleared } = nextPost(scheduled, {
      id: scheduled.id,
      copy: "a different caption",
    });
    expect(consentCleared).toBe(true);
    expect(next.approval).toBeUndefined();
    expect(next.status).toBe("asset_ready");
    expect(next.scheduledAt).toBeUndefined();
  });

  it("does NOT clear consent for a non-material edit (body/provenance)", () => {
    const scheduled = post({
      status: "scheduled",
      scheduledAt: "2026-09-14T15:00:00+00:00",
      approval: { hash: "abc", at: "2026-09-01T00:00:00+00:00" },
    });
    const { post: next, consentCleared } = nextPost(scheduled, {
      id: scheduled.id,
      body: "expanded rationale",
    });
    expect(consentCleared).toBe(false);
    expect(next.approval?.hash).toBe("abc");
    expect(next.status).toBe("scheduled");
  });

  it("reports what still blocks scheduling", () => {
    expect(schedulingGaps(post())).toEqual([
      "creative (compose_design_surface with kind 'social.post', then social_link_design)",
    ]);
    expect(schedulingGaps(post({ copy: "", provenance: [] }))).toContain("copy (the caption)");
  });
});

describe("upsertPost round-trip (AC 1)", () => {
  it("writes an artifact that parses back byte-identically", async () => {
    const repo = memoryRepo();
    const { post: written, created } = await upsertPost(repo, {
      id: "2026-09-14-atelier-hours",
      channel: "instagram",
      copy: "The atelier, before opening.",
      targetLink: "https://myarthaus.com/collections/atelier",
      provenance: [{ claim: "collection is live", origin: "data" }],
    });
    expect(created).toBe(true);
    const raw = repo.files.get(postPath(written.id))!;
    expect(parsePost(raw)).toEqual(written);
    expect(serializePost(parsePost(raw))).toBe(raw);
  });

  it("merges on second write rather than replacing", async () => {
    const repo = memoryRepo();
    await upsertPost(repo, {
      id: "2026-09-14-a",
      channel: "instagram",
      copy: "First",
      targetLink: "https://myarthaus.com/a",
    });
    const { post: updated, created } = await upsertPost(repo, { id: "2026-09-14-a", copy: "Second" });
    expect(created).toBe(false);
    expect(updated.copy).toBe("Second");
    expect(updated.targetLink).toBe("https://myarthaus.com/a"); // preserved
  });
});

describe("post groups (spec 26 D3)", () => {
  it("a post with no groupId is its own group of one", () => {
    expect(groupKey(post())).toBe("2026-09-14-atelier-hours");
  });

  it("variants sharing a groupId group together", () => {
    const ig = post({ id: "a-ig", channel: "instagram", groupId: "autumn-drop" });
    const th = post({ id: "a-th", channel: "threads", groupId: "autumn-drop" });
    const solo = post({ id: "b-solo", channel: "instagram" });
    const groups = groupPosts([th, solo, ig]);
    expect(groups.map((g) => g.key).sort()).toEqual(["autumn-drop", "b-solo"]);
    const autumn = groups.find((g) => g.key === "autumn-drop")!;
    expect(autumn.posts.map((p) => p.channel)).toEqual(["instagram", "threads"]);
  });

  it("orders groups by earliest scheduled variant, unscheduled last", () => {
    const later = post({ id: "later", groupId: "g-later", scheduledAt: "2026-10-05T10:00:00+00:00" });
    const sooner = post({ id: "sooner", groupId: "g-sooner", scheduledAt: "2026-10-01T10:00:00+00:00" });
    const never = post({ id: "never", groupId: "g-never" });
    expect(groupPosts([never, later, sooner]).map((g) => g.key)).toEqual([
      "g-sooner",
      "g-later",
      "g-never",
    ]);
  });

  it("is deterministic", () => {
    const ps = [post({ id: "x", groupId: "g" }), post({ id: "y", groupId: "g" })];
    expect(JSON.stringify(groupPosts(ps))).toBe(JSON.stringify(groupPosts(ps.slice().reverse())));
  });

  it("groupId survives the artifact round-trip", () => {
    const p = post({ groupId: "autumn-drop" });
    expect(parsePost(serializePost(p)).groupId).toBe("autumn-drop");
  });

  it("index row carries the group key", () => {
    expect(postIndexRow(post({ groupId: "g1" })).groupKey).toBe("g1");
    expect(postIndexRow(post()).groupKey).toBe("2026-09-14-atelier-hours");
  });
});
