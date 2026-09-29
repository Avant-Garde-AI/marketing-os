import { afterEach, describe, expect, it, vi } from "vitest";

const shop = "arthaus-website.myshopify.com";
const inputHash = "a".repeat(64);
const job = {
  id: "11111111-1111-4111-8111-111111111111", artifactId: "artwork-loop-1", postId: "2026-09-post-1", state: "submitted",
  caption: "A quiet artwork in motion", prompt: "Subtle movement of the existing artwork", inputHash,
  sourcePreviewUrl: `https://store.example/review/generation/artwork-loop-1?shop=${shop}&hash=${inputHash}`,
  videoUrl: null, thumbnailUrl: null, durationSec: null, estimatedCredits: 20, maximumCredits: 30,
  errorCode: null, createdAt: "2026-09-28T12:00:00.000Z",
};

async function modules(hosted = false) {
  vi.resetModules();
  vi.stubEnv("MARKETING_OS_MODE", hosted ? "hosted" : "client-owned");
  vi.stubEnv("MARKETING_OS_API_URL", "https://platform.example");
  vi.stubEnv("MARKETING_OS_DEPLOYMENT_KEY", "deployment-secret");
  vi.stubEnv("MOS_PLATFORM_SERVICE_KEY", "service-secret");
  const [{ runWithTenant }, review] = await Promise.all([
    import("../templates/agents/lib/tenant-context"),
    import("../templates/agents/lib/social/generation-review"),
  ]);
  return { runWithTenant, review };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("social generation review broker read", () => {
  it("uses a tenant-bound GET and deduplicates the latest month job per post", async () => {
    const { runWithTenant, review } = await modules();
    const calls: { url: URL; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ jobs: [job, { ...job, id: "older-job" }] });
    });
    const jobs = await runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobsForMonth("2026-09"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ postId: "2026-09-post-1", state: "submitted", maximumCredits: 30 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.toString()).toBe("https://platform.example/api/broker/social-generation?month=2026-09");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer deployment-secret");
    expect(new Headers(calls[0]?.init.headers).get("x-mos-tenant-shop")).toBeNull();
  });

  it("binds hosted reads to the resolved tenant and rejects cross-post or unsafe media", async () => {
    const { runWithTenant, review } = await modules(true);
    const calls: { url: URL; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ job });
    });
    const loaded = await runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost("2026-09-post-1"));
    expect(loaded?.postId).toBe("2026-09-post-1");
    expect(calls[0]?.url.searchParams.get("postId")).toBe("2026-09-post-1");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer service-secret");
    expect(new Headers(calls[0]?.init.headers).get("x-mos-tenant-shop")).toBe(shop);
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost("post-2")))
      .rejects.toThrow(/post mismatch/);
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job, videoUrl: "https://evil.example/clip.mp4" } }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost("2026-09-post-1")))
      .rejects.toThrow(/media/);
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job,
      sourcePreviewUrl: `https://store.example/review/generation/artwork-loop-1?shop=other.myshopify.com&hash=${inputHash}` } }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost("2026-09-post-1")))
      .rejects.toThrow(/media/);
  });

  it("rejects invalid month and oversized responses without a generation request", async () => {
    const { runWithTenant, review } = await modules();
    const fetch = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1)));
    vi.stubGlobal("fetch", fetch);
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobsForMonth("2026-99")))
      .rejects.toThrow(/month/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobsForMonth("2026-09")))
      .rejects.toThrow(/too large/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a platform month result with a post from another month", async () => {
    const { runWithTenant, review } = await modules();
    vi.stubGlobal("fetch", async () => Response.json({ jobs: [{ ...job, postId: "2026-10-post-1" }] }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobsForMonth("2026-09")))
      .rejects.toThrow(/another month/);
  });

  it("accepts the observed video and poster CDN hosts but rejects lookalikes", async () => {
    const { runWithTenant, review } = await modules();
    const videoUrl = "https://d8j0ntlcm91z4.cloudfront.net/pilot.mp4";
    const thumbnailUrl = "https://d2ol7oe51mr4n9.cloudfront.net/pilot.jpg";
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job, videoUrl, thumbnailUrl, durationSec: 5 } }));
    const loaded = await runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost(job.postId));
    expect(loaded).toMatchObject({ videoUrl, thumbnailUrl, durationSec: 5 });
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job,
      videoUrl: "https://d8j0ntlcm91z4.cloudfront.net.evil.example/pilot.mp4" } }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost(job.postId)))
      .rejects.toThrow(/media/);
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job,
      thumbnailUrl: "https://other.cloudfront.net/pilot.jpg" } }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost(job.postId)))
      .rejects.toThrow(/media/);
    vi.stubGlobal("fetch", async () => Response.json({ job: { ...job,
      videoUrl: "https://cdn.higgsfield.ai/legacy.mp4" } }));
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, () => review.loadGenerationJobForPost(job.postId)))
      .resolves.toMatchObject({ videoUrl: "https://cdn.higgsfield.ai/legacy.mp4" });
  });
});
