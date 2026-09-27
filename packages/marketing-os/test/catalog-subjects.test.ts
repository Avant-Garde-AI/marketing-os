import { describe, expect, it, vi } from "vitest";
import {
  readCatalogSubjects,
  type CatalogQuery,
} from "../templates/agents/lib/social/catalog-subjects";

function product(overrides: Record<string, unknown> = {}) {
  return {
    handle: "blue-study",
    title: "Blue Study",
    status: "ACTIVE",
    onlineStoreUrl: "https://shop.example/products/blue-study",
    featuredMedia: { image: { url: "https://cdn.example/blue.jpg" } },
    ...overrides,
  };
}

function queryWith(nodes: Array<ReturnType<typeof product> | null>): CatalogQuery {
  return vi.fn(async () => ({ data: { products: { nodes } } })) as unknown as CatalogQuery;
}

describe("readCatalogSubjects", () => {
  it("uses a bounded Admin GraphQL query and returns current catalog fields", async () => {
    const query = queryWith([product()]);

    await expect(readCatalogSubjects(["blue-study"], query)).resolves.toEqual([
      {
        handle: "blue-study",
        title: "Blue Study",
        status: "ACTIVE",
        onlineStoreUrl: "https://shop.example/products/blue-study",
        imageUrl: "https://cdn.example/blue.jpg",
      },
    ]);
    expect(query).toHaveBeenCalledOnce();
    const [document, variables] = vi.mocked(query).mock.calls[0]!;
    expect(document).toContain("products(first: $first, query: $query)");
    expect(document).toContain("featuredMedia { ... on MediaImage { image { url } } }");
    expect(variables).toEqual({ first: 6, query: "handle:blue-study" });
  });

  it("rejects returned handles that do not exactly match a requested handle", async () => {
    await expect(
      readCatalogSubjects(["blue-study"], queryWith([product({ handle: "blue-study-copy" })])),
    ).rejects.toThrow(/unexpected catalog handle/);
  });

  it("surfaces GraphQL errors rather than treating the catalog as empty", async () => {
    const query = vi.fn(async () => ({ errors: [{ message: "Access denied" }] })) as unknown as CatalogQuery;

    await expect(readCatalogSubjects(["blue-study"], query)).rejects.toThrow(/Access denied/);
  });

  it("allows at most six unique handles in a request", async () => {
    const query = queryWith([]);
    await expect(
      readCatalogSubjects(["a", "b", "c", "d", "e", "f", "g"], query),
    ).rejects.toThrow(/At most 6/);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not treat a missing result envelope as an empty catalog", async () => {
    await expect(readCatalogSubjects(["blue-study"], async () => ({}))).rejects.toThrow("no product result");
  });

  it("returns catalog records with missing image or publication URL intact for caller review", async () => {
    const query = queryWith([
      product({ status: "DRAFT", onlineStoreUrl: null, featuredMedia: null }),
    ]);
    await expect(readCatalogSubjects(["blue-study"], query)).resolves.toEqual([
      { handle: "blue-study", title: "Blue Study", status: "DRAFT" },
    ]);
  });
});
