import { afterEach, expect, it, vi } from "vitest";
import { instagramPostOutcomes } from "../templates/agents/lib/social/channels/instagram";
import type { SocialPost } from "../templates/agents/lib/social/types";

const post = { id: "post", channel: "instagram", status: "published", copy: "Caption", channelAccount: { id: "12", username: "store" },
  platform: { id: "123", permalink: "https://instagram.example/123", publishedAt: "2026-10-09T15:00:00Z" } } as SocialPost;
const tokens = { accessToken: vi.fn(async () => "test-token") };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("refuses account drift and never reads another destination's metrics", async () => {
  const fetcher = vi.fn(async () => Response.json({ user_id: "different", username: "other" }));
  vi.stubGlobal("fetch", fetcher);
  await expect(instagramPostOutcomes(post, tokens)).rejects.toThrow(/destination differs/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]![0])).toContain("/me?");
});

it("refuses unofficial hosts and unpublished posts before requesting credentials", async () => {
  vi.stubEnv("SOCIAL_IG_GRAPH_BASE", "https://untrusted.example/v23.0");
  await expect(instagramPostOutcomes(post, tokens)).rejects.toThrow(/official/);
  expect(tokens.accessToken).not.toHaveBeenCalled();
  vi.stubEnv("SOCIAL_IG_GRAPH_BASE", "https://graph.instagram.com/v23.0");
  await expect(instagramPostOutcomes({ ...post, status: "scheduled" }, tokens)).rejects.toThrow(/published/);
  expect(tokens.accessToken).not.toHaveBeenCalled();
});

it("uses only GET reads and retains denied metrics without exposing provider error text", async () => {
  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    expect(init?.method ?? "GET").toBe("GET");
    if (url.pathname.endsWith("/me")) return Response.json({ user_id: "12", username: "store" });
    expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(url.searchParams.has("access_token")).toBe(false);
    if (url.pathname.endsWith("/insights")) return Response.json({ error: { message: "DO NOT EXPOSE PROVIDER DETAILS" } }, { status: 403 });
    return Response.json({ id: "123", caption: post.copy, timestamp: post.platform!.publishedAt, like_count: 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await instagramPostOutcomes(post, tokens, new Date("2026-10-09T18:00:00Z"));
  expect(result.metrics.views).toEqual({ status: "unavailable", reason: "provider-rejected" });
  expect(result.metrics.likes).toEqual({ status: "available", value: 0 });
  expect(JSON.stringify(result)).not.toContain("DO NOT EXPOSE");
  expect(fetcher).toHaveBeenCalledTimes(6);
});
