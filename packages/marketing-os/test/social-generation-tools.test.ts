import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithTenant } from "../templates/agents/lib/tenant-context";
import { socialGenerationTools } from "../templates/agents/src/mastra/tools/social-generation";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("social generation broker tools", () => {
  it("sends a fixed proposal shape with broker auth and never returns credentials", async () => {
    vi.stubEnv("MARKETING_OS_API_URL", "https://platform.example");
    vi.stubEnv("MARKETING_OS_DEPLOYMENT_KEY", "deployment-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ proposalId: "proposal-1", status: "pending" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { artifactId: "passion-flower-loop-pilot", maximumCredits: 12 };
    const result = await runWithTenant({ shop: "arthaus-website.myshopify.com", storeSlug: "arthaus-website" },
      () => socialGenerationTools.social_generation_prepare.execute!(input as never, {} as never));
    expect(result).toEqual({ proposalId: "proposal-1", status: "pending" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://platform.example/api/broker/social-generation");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(init.headers).toMatchObject({ Authorization: "Bearer deployment-secret" });
    expect(socialGenerationTools.social_generation_prepare.inputSchema.safeParse({ ...input, maximumCredits: 101 }).success).toBe(false);
    expect(socialGenerationTools.social_generation_prepare.inputSchema.safeParse({ ...input, model: "arbitrary" }).success).toBe(false);
  });

  it("reads status by ID without a spending request body", async () => {
    vi.stubEnv("MARKETING_OS_API_URL", "https://platform.example");
    vi.stubEnv("MARKETING_OS_DEPLOYMENT_KEY", "deployment-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ phase: "unknown", attempts: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = "123e4567-e89b-42d3-a456-426614174000";
    await runWithTenant({ shop: "arthaus-website.myshopify.com", storeSlug: "arthaus-website" },
      () => socialGenerationTools.social_generation_status.execute!({ id } as never, {} as never));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://platform.example/api/broker/social-generation?id=${id}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});
