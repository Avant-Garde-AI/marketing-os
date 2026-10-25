import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
const store = vi.hoisted(() => new Map<string, string>());
vi.mock("../templates/agents/lib/social/repo", () => ({
  socialRepo: { readFile: async (p: string) => store.get(p) ?? null, writeFile: vi.fn() },
}));
vi.mock("../templates/agents/lib/social/register-actions", () => ({
  socialActionDeps: () => ({}),
}));
vi.mock("../templates/agents/lib/social/generation-publishing", () => ({
  readPublishableCarousel: vi.fn(),
  persistCarouselBinding: vi.fn(),
  carouselManifestHash: vi.fn(),
}));
vi.mock("../templates/agents/lib/social/generation-review", () => ({
  loadGenerationJobForPost: vi.fn(),
  loadGenerationJobsForMonth: vi.fn(),
}));
vi.mock("../templates/agents/lib/social/generation-video", () => ({
  validateGeneratedVideo: vi.fn(),
}));
vi.mock("../templates/agents/lib/tenant-context", () => ({
  HOSTED: false,
  getTenant: () => ({ shop: "a.myshopify.com" }),
}));
import { planSocialWindow } from "../templates/agents/lib/social/autopilot-production";
import { socialRepo } from "../templates/agents/lib/social/repo";
import { parsePost, serializePost } from "../templates/agents/lib/social/artifacts";
import { approvalHash } from "../templates/agents/lib/social/actions";
const policy = {
  schemaVersion: 1 as const,
  enabled: true,
  account: { id: "123", username: "art" },
  firstPostDate: "2026-10-28",
  timeZone: "America/Chicago",
  localTime: "10:00",
  batchDays: 14 as const,
  leadDays: 7 as const,
  maximumCredits: 125,
  maximumJobCredits: 8,
  minimumReviewHours: 24,
  requireSlackNotice: true as const,
  publishUnlessPaused: true as const,
  recipeIds: ["artwork-loop", "real-home"],
};
const source = {
  sourceRef: "catalog:one",
  verificationRef: "proof#one",
  sourceSha256: "a".repeat(64),
  sourcePath: `social/production/sources/${"a".repeat(64)}.jpeg.b64`,
  width: 1200,
  height: 1600,
};
const plan = (scene: boolean, n: number) => ({
  id: `seed-${n}`,
  postId: `2026-10-01-seed-${n}`,
  slotId: "slot",
  recipeId: scene ? "real-home" : "artwork-loop",
  mechanic: scene ? "collection-scene" : "artwork-loop",
  ...(scene ? { scene: "real-home", sceneComposition: "single-artwork" } : {}),
  sources: [source],
  prompt: scene
    ? "A blank frame in a warm room."
    : "Beat 1: Wind crosses the leaves. Beat 2: Petals turn toward the light. Beat 3: The leaves return.",
  caption: "Imagined room. Art by @artist",
  transform: {
    kind: "contain-pad",
    width: 1080,
    height: scene ? 1350 : 1920,
    background: "#f4f3ee",
  },
});
let input: any;
beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  const recipes = JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        recipeId: "artwork-loop",
        caption: "A garden in motion. Art by @artist",
        artistHandles: ["@artist"],
        targetLink: "https://example.com/art",
        body: "Source-grounded motion.",
        plans: [plan(false, 0)],
      },
      {
        recipeId: "real-home",
        caption: "An imagined reading room. Art by @artist",
        artistHandles: ["@artist"],
        targetLink: "https://example.com/art",
        body: "Three related corners.",
        plans: [1, 2, 3].map((n) => plan(true, n)),
      },
    ],
  });
  store.set("social/autopilot/recipes.json", recipes);
  input = {
    policy,
    index: 0,
    grantId: "d00a17c1-cc92-4ad7-845e-3ffb8eb4ed7c",
    recipeHash: createHash("sha256").update(recipes).digest("hex"),
  };
});
describe("deterministic fortnightly social production", () => {
  it("plans seven loops and twenty-one scenes with 119 reserved credits and no writes", async () => {
    const { batch, plans } = await planSocialWindow(input);
    expect(batch.posts).toHaveLength(14);
    expect(batch.generationJobs).toHaveLength(28);
    expect(batch.reservedMaximumCredits).toBe(119);
    expect(plans.filter((p) => p.mechanic === "artwork-loop")).toHaveLength(7);
    expect(batch.posts[3].plannedAt).toBe("2026-10-31T15:00:00.000Z");
    expect(batch.posts[4].plannedAt).toBe("2026-11-01T16:00:00.000Z");
    expect(socialRepo.writeFile).not.toHaveBeenCalled();
  });
  it("uses disjoint dates and immutable generation ids in the next fortnight", async () => {
    const a = await planSocialWindow(input),
      b = await planSocialWindow({ ...input, index: 1 });
    const ids = new Set(a.plans.map((p) => p.id));
    expect(b.plans.some((p) => ids.has(p.id))).toBe(false);
    expect(b.batch.range.from).toBe("2026-11-11");
  });
  it("refuses changed recipes, missing credits, lost disclosure and insufficient caps", async () => {
    await expect(planSocialWindow({ ...input, recipeHash: "b".repeat(64) })).rejects.toThrow();
    await expect(
      planSocialWindow({ ...input, captions: Array(14).fill("No credit") })
    ).rejects.toThrow();
    await expect(
      planSocialWindow({ ...input, captions: Array(14).fill("A room. @artist") })
    ).rejects.toThrow();
    await expect(
      planSocialWindow({ ...input, policy: { ...policy, maximumCredits: 100 } })
    ).rejects.toThrow();
  });
  it("round trips automation and binds it into consent while preserving manual hashes", () => {
    const post: any = {
      id: "one",
      channel: "instagram",
      copy: "Art",
      assetRefs: [],
      targetLink: "https://example.com",
      provenance: [],
      status: "proposed",
      body: "",
    };
    const manual = approvalHash(post);
    post.automation = {
      grantId: input.grantId,
      batchId: "auto-2026-10-28",
      windowFrom: "2026-10-28",
    };
    const parsed = parsePost(serializePost(post));
    expect(parsed.automation).toEqual(post.automation);
    expect(approvalHash(parsed)).not.toBe(manual);
    delete post.automation;
    expect(approvalHash(post)).toBe(manual);
  });
});
