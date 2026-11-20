/**
 * Resolve a corpus store's page set (spec 35 P2).
 *
 * Hand-picked product URLs rot. Shopify storefronts publish `/products.json`,
 * so the resolver picks a live, purchasable product with images and checks
 * that a collection page responds. Non-Shopify stores keep their home page
 * only and are flagged so a reviewer can add pages by hand.
 *
 * Read-only public GETs, one store at a time, plain identifying user agent.
 */
import type { CorpusStore } from "../corpus.js";

export interface ResolveResult {
  url: string;
  reachable: boolean;
  shopify: boolean;
  pages: CorpusStore["pages"];
  notes: string[];
}

const UA = "design-craft-corpus/0.1 (+https://github.com/Avant-Garde-AI/marketing-os)";

async function get(url: string, f: typeof fetch): Promise<Response | null> {
  try {
    return await f(url, { headers: { "user-agent": UA, accept: "application/json,text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
}

export async function resolveStorePages(store: Pick<CorpusStore, "url">, f: typeof fetch = fetch): Promise<ResolveResult> {
  const base = store.url.replace(/\/$/, "");
  const out: ResolveResult = { url: store.url, reachable: false, shopify: false, pages: [], notes: [] };

  const home = await get(`${base}/`, f);
  if (!home || !home.ok) {
    out.notes.push(`home ${home ? home.status : "unreachable"}`);
    return out;
  }
  out.reachable = true;
  out.pages.push({ type: "home", url: "/" });

  const pj = await get(`${base}/products.json?limit=30`, f);
  let products: { handle?: string; images?: unknown[]; variants?: { available?: boolean }[]; product_type?: string }[] = [];
  if (pj?.ok) {
    try {
      const body = (await pj.json()) as { products?: typeof products };
      products = Array.isArray(body.products) ? body.products : [];
    } catch {
      /* not JSON: not a Shopify storefront */
    }
  }
  if (!products.length) {
    out.notes.push("no /products.json: not Shopify, or the endpoint is disabled. Add pages by hand");
    return out;
  }
  out.shopify = true;

  // Prefer a real, in-stock product with imagery. Gift cards and samples are poor PDP exemplars.
  const pick =
    products.find((p) => p.handle && (p.images?.length ?? 0) > 0 && !/gift|sample|card|insurance|donation/i.test(`${p.handle} ${p.product_type ?? ""}`) && p.variants?.some((v) => v.available)) ??
    products.find((p) => p.handle && (p.images?.length ?? 0) > 0);
  if (pick?.handle) out.pages.push({ type: "product", url: `/products/${pick.handle}` });
  else out.notes.push("no product with images");

  const col = await get(`${base}/collections/all`, f);
  if (col?.ok) out.pages.push({ type: "collection", url: "/collections/all" });
  else out.notes.push(`/collections/all ${col ? col.status : "unreachable"}: add a collection by hand`);

  return out;
}
