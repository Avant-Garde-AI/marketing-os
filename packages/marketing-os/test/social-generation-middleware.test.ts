import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runWithTenant: vi.fn(async (_tenant: unknown, fn: () => Promise<unknown>) => fn()),
  readGenerationInput: vi.fn(async () => ({
    plan: { id: "pilot" }, prepared: { sha256: "a".repeat(64), width: 1080, height: 1920, mimeType: "image/jpeg" },
    inputHash: "b".repeat(64), base64: "image-bytes",
  })),
  createServerClient: vi.fn(() => ({ auth: { getSession: async () => ({ data: { session: null } }) } })),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/server", () => {
  class ResponseStub {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200; }
    static next() { return new ResponseStub(null); }
    static redirect(url: URL) { return new ResponseStub({ location: url.toString() }, { status: 307 }); }
    static json(body: unknown, init?: { status?: number }) { return new ResponseStub(body, init); }
  }
  return { NextResponse: ResponseStub };
});
vi.mock("../templates/agents/lib/tenant-context", () => ({ runWithTenant: mocks.runWithTenant }));
vi.mock("../templates/agents/lib/social/repo", () => ({ socialRepo: {} }));
vi.mock("../templates/agents/lib/social/generation-input", () => ({ readGenerationInput: mocks.readGenerationInput }));
vi.mock("../templates/agents/lib/social/review-links", () => ({ socialGenerationReviewLink: () => ({ url: "https://review.example/pilot" }) }));

import { middleware } from "../templates/agents/middleware";
import { POST } from "../templates/agents/app/api/social/generation/input/route";

const request = (pathname: string) => ({ nextUrl: { pathname }, url: `https://runtime.example${pathname}` });

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("service-only generation input routing", () => {
  it("lets the exact route reach its own auth in hosted mode, while adjacent paths stay blocked", async () => {
    vi.stubEnv("MARKETING_OS_MODE", "hosted");
    expect((await middleware(request("/api/social/generation/input") as never)).status).toBe(200);
    expect((await middleware(request("/api/social/generation/input/other") as never)).status).toBe(403);
    expect((await middleware(request("/api/social/generation/other") as never)).status).toBe(403);
  });

  it("skips session redirect for this route in client-owned mode", async () => {
    vi.stubEnv("MARKETING_OS_MODE", "client-owned");
    vi.stubEnv("NODE_ENV", "production");
    expect((await middleware(request("/api/social/generation/input") as never)).status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("rejects callers without the gate secret and resolves the hosted tenant after authentication", async () => {
    vi.stubEnv("MARKETING_OS_MODE", "hosted");
    vi.stubEnv("ACTIONS_GATE_SECRET", "gate-secret");
    const body = { id: "pilot", shop: "arthaus-website.myshopify.com", githubRepo: "Arthaus-Inc/marketplace" };
    const post = (authorization?: string) => ({
      headers: { get: (key: string) => key === "authorization" ? authorization ?? null : null },
      json: async () => body,
    });
    expect((await POST(post() as never)).status).toBe(401);
    expect(mocks.readGenerationInput).not.toHaveBeenCalled();
    const response = await POST(post("Bearer gate-secret") as never);
    expect(response.status).toBe(200);
    expect(mocks.runWithTenant).toHaveBeenCalledWith({
      shop: body.shop, storeSlug: "arthaus-website", githubRepo: body.githubRepo,
    }, expect.any(Function));
    expect(mocks.readGenerationInput).toHaveBeenCalledWith({}, "pilot");
  });
});
