import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithTenant } from "../templates/agents/lib/tenant-context";
import { runWithGenerationActor } from "../templates/agents/lib/social/generation-authority";
import { socialGenerationTools } from "../templates/agents/src/mastra/tools/social-generation";
import crypto from "node:crypto";

// The CLI package does not install Mastra; generated consoles do.
vi.mock("@mastra/core/tools", () => ({ createTool: (definition: unknown) => definition }));

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
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it("refuses a generation run without verified request-bound actor provenance", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(runWithTenant({ shop: "arthaus-website.myshopify.com", storeSlug: "arthaus-website" },
      () => socialGenerationTools.social_generation_run.execute!({ artifactId: "pilot", maximumCredits: 8 } as never, {} as never)))
      .rejects.toThrow("Authenticated generation request required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs exact run body, shop and timestamp and returns a signed one-page review", async () => {
    vi.stubEnv("MARKETING_OS_API_URL", "https://platform.example");
    vi.stubEnv("MARKETING_OS_DEPLOYMENT_KEY", "deployment-secret");
    vi.stubEnv("ACTIONS_GATE_SECRET", "gate-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ postId: "2026-09-passion-flower", phase: "submitted" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const shop = "arthaus-website.myshopify.com";
    const result = await runWithTenant({ shop, storeSlug: "arthaus-website" }, () =>
      runWithGenerationActor({ surface: "console", subject: "shopify-admin:arthaus-website.myshopify.com" }, () =>
        socialGenerationTools.social_generation_run.execute!({ artifactId: "pilot", maximumCredits: 8 } as never, {} as never)));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(JSON.parse(body)).toEqual({ action: "run", artifactId: "pilot", maximumCredits: 8,
      actor: { surface: "console", subject: "shopify-admin:arthaus-website.myshopify.com" } });
    expect(headers["x-mos-run-shop"]).toBe(shop);
    expect(headers["x-mos-run-sig"]).toBe(crypto.createHmac("sha256", "gate-secret")
      .update(`social-generation-run:v1\n${shop}\n${headers["x-mos-run-ts"]}\n${body}`).digest("hex"));
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ postId: "2026-09-passion-flower", reviewUrl: expect.stringContaining("/review/social/"),
      sheetUrl: expect.stringContaining("month=2026-09") });
  });
});
