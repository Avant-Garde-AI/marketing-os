import { describe, expect, it, vi } from "vitest";
import { bindGraphSubjectReads, collectGraphSubjects, parseGraphFacetAliases, type GraphSubjectDependencies } from "../src/graph-subjects";

function dependencies(): GraphSubjectDependencies {
  return {
    tenant: "store-a", now: () => "2026-09-25T12:00:00.000Z",
    facetHandleAliases: { "blue-study-no-frame": "blue-study" },
    callGraph: vi.fn(async (operation) => operation === "explore_concept"
      ? { results: [{ handle: "blue-study-no-frame", title: "Stale title", artist: "Artist A" }] }
      : { artworks: [{ handle: "blue-study", palette: ["blue"], subject: ["sea"], movement: [] }] }),
    readCatalog: vi.fn(async () => [{ handle: "blue-study-no-frame", title: "Current title", status: "ACTIVE", onlineStoreUrl: "https://store.example/products/blue-study-no-frame", imageUrl: "https://cdn.example/current.jpg" }]),
  };
}

describe("graph-to-catalog subject packets", () => {
  it("reads only the selected connection's explicit aliases and defaults to exact identity", () => {
    const raw = JSON.stringify({ version: 1, connections: { art_graph: { facetHandleAliases: { "work-old": "work" } } } });
    expect(parseGraphFacetAliases(raw, "art_graph")).toEqual({ "work-old": "work" });
    expect(parseGraphFacetAliases(raw, "other_graph")).toEqual({});
    expect(parseGraphFacetAliases(null, "art_graph")).toEqual({});
    expect(() => parseGraphFacetAliases("{}", "art_graph")).toThrow();
    expect(() => parseGraphFacetAliases("x".repeat(50_001), "art_graph")).toThrow("exceeds");
  });
  it("never infers another store's suffix aliases and refuses invalid configured identities", async () => {
    const deps = { ...dependencies(), facetHandleAliases: undefined };
    const packet = await collectGraphSubjects({ concept: "quiet water", limit: 1 }, deps);
    expect(deps.callGraph).toHaveBeenNthCalledWith(2, "get_artwork_facets", { handles: ["blue-study-no-frame"] });
    expect(packet.subjects).toEqual([]);
    expect(packet.rejected[0]?.reasons).toContain("graph-facets-missing");
    await expect(collectGraphSubjects({ concept: "quiet", limit: 1 }, { ...dependencies(), facetHandleAliases: { "blue-study-no-frame": "../other" } })).rejects.toThrow();
  });
  it("binds only required enabled connection reads and rejects unavailable connections", async () => {
    const explore = vi.fn(async () => ({ results: [] }));
    const call = bindGraphSubjectReads("picasso_concierge", {
      picasso_concierge_explore_concept: { execute: explore },
      picasso_concierge_get_artwork_facets: { execute: vi.fn() },
    });
    await call("explore_concept", { concept: "quiet" });
    expect(explore).toHaveBeenCalledWith({ concept: "quiet" });
    expect(() => bindGraphSubjectReads("other", {})).toThrow("missing");
  });
  it("uses graph aliases only for facets and keeps exact catalog handles and current fields", async () => {
    const deps = dependencies();
    const packet = await collectGraphSubjects({ concept: "quiet water", limit: 3 }, deps);
    expect(deps.callGraph).toHaveBeenNthCalledWith(2, "get_artwork_facets", { handles: ["blue-study"] });
    expect(deps.readCatalog).toHaveBeenCalledWith(["blue-study-no-frame"]);
    expect(packet.subjects[0]).toMatchObject({ handle: "blue-study-no-frame", title: "Current title", imageUrl: "https://cdn.example/current.jpg", inventoryAvailability: "unknown" });
    expect(packet.subjects[0]!.sourceRefs).toEqual(packet.receipts.map((r) => r.ref));
    const other = await collectGraphSubjects({ concept: "quiet water", limit: 3 }, { ...dependencies(), tenant: "store-b" });
    expect(packet.receipts[0]!.ref).not.toBe(other.receipts[0]!.ref);
  });

  it("retains inactive, missing catalog and missing facet cases as explicit rejections", async () => {
    const deps = dependencies();
    deps.callGraph = async (operation) => operation === "explore_concept"
      ? { results: [{ handle: "draft", title: "Draft" }, { handle: "missing", title: "Missing" }] }
      : { artworks: [{ handle: "draft", palette: ["blue"] }] };
    deps.readCatalog = async () => [{ handle: "draft", title: "Draft", status: "DRAFT" }];
    const packet = await collectGraphSubjects({ concept: "quiet water", limit: 3 }, deps);
    expect(packet.subjects).toEqual([]);
    expect(packet.rejected).toEqual([
      { handle: "draft", reasons: ["catalog-product-inactive", "catalog-online-store-url-missing", "catalog-image-missing"] },
      { handle: "missing", reasons: ["graph-facets-missing", "catalog-product-missing"] },
    ]);
  });

  it("fails closed for graph errors, duplicates, unrelated catalog records and excessive selection", async () => {
    const deps = dependencies();
    await expect(collectGraphSubjects({ concept: "quiet", limit: 7 }, deps)).rejects.toThrow();
    expect(deps.callGraph).not.toHaveBeenCalled();
    await expect(collectGraphSubjects({ concept: "quiet", limit: 1 }, { ...deps, callGraph: async () => ({ error: "down" }) })).rejects.toThrow("Graph query failed");
    await expect(collectGraphSubjects({ concept: "quiet", limit: 1 }, { ...dependencies(), readCatalog: async () => [{ handle: "other", title: "Other", status: "ACTIVE" }] })).rejects.toThrow("unexpected");
    await expect(collectGraphSubjects({ concept: "quiet", limit: 3 }, { ...dependencies(), callGraph: async () => ({ results: [{ handle: "same", title: "One" }, { handle: "same", title: "Two" }] }) })).rejects.toThrow("duplicate");
  });

  it("does not call facets or catalog when the graph has no subjects", async () => {
    const deps = dependencies();
    deps.callGraph = vi.fn(async () => JSON.stringify({ results: [] }));
    const packet = await collectGraphSubjects({ concept: "quiet", limit: 3 }, deps);
    expect(packet.subjects).toEqual([]);
    expect(deps.callGraph).toHaveBeenCalledOnce();
    expect(deps.readCatalog).not.toHaveBeenCalled();
  });
});
