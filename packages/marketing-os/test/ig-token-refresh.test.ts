import { describe, expect, it, vi } from "vitest";
import {
  ensureUsableInstagramToken,
  maybeRefreshInstagram,
  refreshInstagramToken,
  REFRESH_THRESHOLD_DAYS,
} from "../templates/agents/lib/social/channels/refresh";

/**
 * These encode the decisions that let a token die once already: when to renew,
 * when not to bother, and what counts as unrecoverable.
 */

function deps(over: Partial<Parameters<typeof maybeRefreshInstagram>[0]> = {}) {
  return {
    currentToken: async () => "IGAA-current",
    daysRemaining: 40,
    store: async () => {},
    ...over,
  };
}

describe("maybeRefreshInstagram", () => {
  it("leaves a healthy token alone", async () => {
    const store = vi.fn();
    const v = await maybeRefreshInstagram(deps({ daysRemaining: 40, store }));
    expect(v.action).toBe("skipped");
    expect(store).not.toHaveBeenCalled();
  });

  it("renews once inside the threshold", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "IGAA-new", expires_in: 60 * 86400 }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const store = vi.fn();
    const v = await maybeRefreshInstagram(
      deps({ daysRemaining: REFRESH_THRESHOLD_DAYS, store }),
    );
    expect(v.action).toBe("refreshed");
    expect(store).toHaveBeenCalledOnce();
    expect(store.mock.calls[0]![0].token).toBe("IGAA-new");
    vi.unstubAllGlobals();
  });

  it("refreshes when no expiry is known — that case IS the migration off env", async () => {
    // A store on the env bootstrap has no recorded expiry. Treating that as
    // "nothing to do" would leave it on env forever, which is the whole bug.
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ access_token: "IGAA-seeded", expires_in: 5184000 }),
    }));
    const store = vi.fn();
    const v = await maybeRefreshInstagram(deps({ daysRemaining: null, store }));
    expect(v.action).toBe("refreshed");
    expect(store).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("reports an ALREADY-expired token as unrecoverable, and says what a human must do", async () => {
    const store = vi.fn();
    const v = await maybeRefreshInstagram(deps({ daysRemaining: -3, store }));
    expect(v.action).toBe("failed");
    expect(v.action === "failed" && v.reason).toMatch(/EXPIRED/);
    expect(v.action === "failed" && v.reason).toMatch(/Meta app dashboard/);
    // Critically: it does not waste a call on an exchange that cannot succeed.
    expect(store).not.toHaveBeenCalled();
  });

  it("treats mint-succeeded-but-store-failed as a failure, not a success", async () => {
    // The new token exists and is unsaved. The old one still works, so this is
    // survivable — but silence would mean minting a fresh token every sweep
    // and keeping none of them.
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ access_token: "IGAA-new", expires_in: 5184000 }),
    }));
    const v = await maybeRefreshInstagram(
      deps({ daysRemaining: 3, store: async () => { throw new Error("vault down"); } }),
    );
    expect(v.action).toBe("failed");
    expect(v.action === "failed" && v.reason).toMatch(/could not STORE/);
    expect(v.action === "failed" && v.reason).toMatch(/vault down/);
    vi.unstubAllGlobals();
  });

  it("surfaces Instagram's own message rather than flattening it", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Session has expired", code: 190 } }),
    }));
    const v = await maybeRefreshInstagram(deps({ daysRemaining: 2 }));
    expect(v.action).toBe("failed");
    expect(v.action === "failed" && v.reason).toMatch(/Session has expired/);
    expect(v.action === "failed" && v.reason).toMatch(/code=190/);
    vi.unstubAllGlobals();
  });
});

describe("refreshInstagramToken", () => {
  it("assumes 60 days when Instagram omits expires_in", async () => {
    // Recording "unknown" would opt the token out of every future refresh.
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ access_token: "IGAA-new" }),
    }));
    const r = await refreshInstagramToken("IGAA-old");
    expect(r.expiresIn).toBe(60 * 86400);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    vi.unstubAllGlobals();
  });

  it("refuses a response with no token rather than storing undefined", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    await expect(refreshInstagramToken("IGAA-old")).rejects.toThrow(/refresh failed/);
    vi.unstubAllGlobals();
  });
});

describe("ensureUsableInstagramToken", () => {
  const ok = { ok: true, json: async () => ({ user_id: "1784", username: "arthaushq", account_type: "BUSINESS" }) };
  const dead = { ok: false, status: 400, json: async () => ({ error: { message: "Session has expired" } }) };

  it("leaves a working stored token alone, even when env differs", async () => {
    vi.stubGlobal("fetch", async () => ok);
    const store = vi.fn();
    const v = await ensureUsableInstagramToken({
      storedToken: async () => "vault-good",
      bootstrapToken: async () => "env-other",
      store,
    });
    expect(v.action).toBe("healthy");
    expect(store).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("repairs when a dead stored token shadows a working env one", async () => {
    // The exact Arthaus failure: a token regenerated in the Meta dashboard had
    // no effect because Vault was answering first with a revoked credential.
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (u: URL) => {
      const t = new URL(u).searchParams.get("access_token")!;
      seen.push(t);
      return t === "env-good" ? ok : dead;
    });
    const store = vi.fn();
    const v = await ensureUsableInstagramToken({
      storedToken: async () => "vault-stale",
      bootstrapToken: async () => "env-good",
      store,
    });
    expect(v.action).toBe("repaired");
    expect(store).toHaveBeenCalledOnce();
    expect(store.mock.calls[0]![0]).toBe("env-good");
    expect(store.mock.calls[0]![1].username).toBe("arthaushq");
    expect(seen).toEqual(["vault-stale", "env-good"]);
    vi.unstubAllGlobals();
  });

  it("does not 'repair' when both sources hold the same dead value", async () => {
    vi.stubGlobal("fetch", async () => dead);
    const store = vi.fn();
    const v = await ensureUsableInstagramToken({
      storedToken: async () => "same-dead",
      bootstrapToken: async () => "same-dead",
      store,
    });
    expect(v.action).toBe("broken");
    expect(v.action === "broken" && v.reason).toMatch(/only token available/);
    expect(store).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports both failures when neither token works", async () => {
    vi.stubGlobal("fetch", async () => dead);
    const v = await ensureUsableInstagramToken({
      storedToken: async () => "a",
      bootstrapToken: async () => "b",
      store: async () => {},
    });
    expect(v.action).toBe("broken");
    expect(v.action === "broken" && v.reason).toMatch(/stored token unusable/);
    expect(v.action === "broken" && v.reason).toMatch(/bootstrap token also refused/);
    vi.unstubAllGlobals();
  });
});
