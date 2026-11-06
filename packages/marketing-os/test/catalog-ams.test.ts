import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AMS_INTERNAL_URL", "https://ams.example/artwork-ms");
  vi.stubEnv("AMS_INTERNAL_API_KEY", "test-key");
  vi.stubEnv("AMS_PREVIEW_URL", undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function respond(body: unknown) {
  const fetch = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("unwraps the AMS new-artists envelope and preserves selection facts and previews", async () => {
  const artist = { artistId: 7, pageReady: true, live: 4, topics: [{ topic: "folk", searchTerms: ["folk prints"] }], works: [{ artworkId: 42, handle: "folk-birds", name: "Birds", url: "https://store.example/products/folk-birds" }] };
  const fetch = respond({ success: true, data: { days: 7, count: 1, artists: [artist] } });
  const { newArtists } = await import("../templates/agents/lib/catalog/ams");
  expect(await newArtists({})).toEqual({ days: 7, minLive: 3, artists: [{ ...artist, works: [{ ...artist.works[0], previewUrl: "https://ams.example/artwork-ms/api/internal/artworks/42/preview" }] }] });
  expect(fetch.mock.calls[0][0]).toContain("/catalog/new-artists?days=7&minLive=3");
});

it("unwraps the AMS handle lookup into the tool's artists array", async () => {
  const rows = [{ handle: "birds", artistId: 7, firstLiveAt: "2026-11-01" }];
  const fetch = respond({ success: true, data: { count: 1, handles: rows } });
  const { handleArtists } = await import("../templates/agents/lib/catalog/ams");
  expect(await handleArtists({ handles: ["birds", "birds"] })).toEqual({ artists: rows });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ handles: ["birds"] });
});

it("distinguishes a confirmed empty week from an invalid upstream response", async () => {
  respond({ success: true, data: { count: 0, artists: [] } });
  const { newArtists } = await import("../templates/agents/lib/catalog/ams");
  expect((await newArtists({})).artists).toEqual([]);
  respond({ success: true, data: { count: 0 } });
  await expect(newArtists({})).rejects.toThrow("missing the artists array");
});

it("rejects a malformed handle lookup and skips an empty request", async () => {
  const fetch = respond({ success: true, data: { count: 0 } });
  const { handleArtists } = await import("../templates/agents/lib/catalog/ams");
  expect(await handleArtists({})).toEqual({ artists: [] });
  expect(fetch).not.toHaveBeenCalled();
  await expect(handleArtists({ handles: ["birds"] })).rejects.toThrow("missing the handles array");
});

it("reports an upstream failure even when HTTP status is 200", async () => {
  respond({ success: false, error: "catalogue unavailable" });
  const { newArtists } = await import("../templates/agents/lib/catalog/ams");
  await expect(newArtists({})).rejects.toThrow("catalogue unavailable");
});

it("continues to support direct array payloads", async () => {
  respond({ success: true, data: [{ artistId: 7 }] });
  const { newArtists } = await import("../templates/agents/lib/catalog/ams");
  expect((await newArtists({})).artists).toEqual([{ artistId: 7, works: [] }]);
});
