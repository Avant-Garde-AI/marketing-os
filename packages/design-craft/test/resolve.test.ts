import { describe, expect, it } from "vitest";
import { resolveStorePages } from "../src/adapters/shopify-pages.js";

const fakeFetch = (routes: Record<string, { status: number; body?: unknown }>) =>
  (async (url: string) => {
    const path = new URL(url).pathname + new URL(url).search;
    const r = routes[path] ?? { status: 404 };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;

describe("resolveStorePages", () => {
  it("picks an in-stock product with images, skipping gift cards", async () => {
    const r = await resolveStorePages(
      { url: "https://shop.example" },
      fakeFetch({
        "/": { status: 200, body: "<html>" },
        "/products.json?limit=30": {
          status: 200,
          body: {
            products: [
              { handle: "gift-card", images: [{}], variants: [{ available: true }] },
              { handle: "sold-out-tee", images: [{}], variants: [{ available: false }] },
              { handle: "no-image-mug", images: [], variants: [{ available: true }] },
              { handle: "linen-shirt", images: [{}], variants: [{ available: true }] },
            ],
          },
        },
        "/collections/all": { status: 200, body: "<html>" },
      }),
    );
    expect(r.shopify).toBe(true);
    expect(r.pages).toEqual([
      { type: "home", url: "/" },
      { type: "product", url: "/products/linen-shirt" },
      { type: "collection", url: "/collections/all" },
    ]);
  });

  it("keeps a non-Shopify store's home page and says why", async () => {
    const r = await resolveStorePages({ url: "https://custom.example" }, fakeFetch({ "/": { status: 200, body: "<html>" }, "/products.json?limit=30": { status: 200, body: "<html>not json" } }));
    expect(r).toMatchObject({ reachable: true, shopify: false, pages: [{ type: "home", url: "/" }] });
    expect(r.notes[0]).toMatch(/not Shopify/);
  });

  it("reports an unreachable store", async () => {
    const r = await resolveStorePages({ url: "https://blocked.example" }, fakeFetch({ "/": { status: 403 } }));
    expect(r).toMatchObject({ reachable: false, pages: [] });
  });
});
