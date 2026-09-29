import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { verifyChatHandoff, verifyConsoleAuthority } from "../templates/agents/lib/proxy-auth";

afterEach(() => vi.unstubAllEnvs());

describe("console generation authority", () => {
  it("requires a console-only signature in addition to a valid legacy chat handoff", () => {
    vi.stubEnv("MCP_PROXY_SECRET", "chat-secret");
    const shop = "arthaus-website.myshopify.com";
    const ts = String(Date.now());
    const legacy = crypto.createHmac("sha256", "chat-secret").update(`chat.${shop}.${ts}`).digest("hex");
    const base = { "x-mos-chat-shop": shop, "x-mos-chat-ts": ts, "x-mos-chat-sig": legacy };
    const request = (headers: Record<string, string>) => new Request("https://runtime.example/api/chat", { headers });
    expect(verifyChatHandoff(request(base))).toBe(shop);
    expect(verifyConsoleAuthority(request(base), shop)).toBeNull();
    const actor = `shopify-admin:${shop}`;
    const sig = crypto.createHmac("sha256", "chat-secret")
      .update(`chat-authority:v1\n${shop}\n${ts}\nconsole\n${actor}`).digest("hex");
    const signed = { ...base, "x-mos-chat-surface": "console", "x-mos-chat-actor": actor,
      "x-mos-chat-authority-sig": sig };
    expect(verifyConsoleAuthority(request(signed), shop)).toBe(actor);
    expect(verifyConsoleAuthority(request({ ...signed, "x-mos-chat-actor": "shopify-admin:another-shop" }), shop)).toBeNull();
    expect(verifyConsoleAuthority(request(signed), "another-shop" )).toBeNull();
  });
});
