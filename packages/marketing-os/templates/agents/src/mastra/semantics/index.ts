// agents/src/mastra/semantics/index.ts
//
// Runtime entry point for the semantic layer: compile the model for THIS store
// by probing the connected providers (GA4 via the broker, Shopify always-on),
// discovering GA4 custom dimensions/metrics, and reading the store's currency
// and timezone. The compiled model is cached briefly and drives explore_schema,
// describe_field, and (Phase F) query/explain_query.

import { compileModel, type CompileContext, type DiscoveredField } from "./compile";
import type { CompiledModel, CompiledView, Provider } from "./types";
import { ga4, GA4ReconnectRequiredError } from "../../../lib/ga4";
import { getShopifyClient } from "../../../lib/shopify";

export * from "./types";
export { compileModel } from "./compile";

const MODEL_TTL_MS = 5 * 60 * 1000;
let _cache: { model: CompiledModel; at: number } | null = null;

function ga4ScopePrefix(scope?: string): string {
  return scope === "USER" ? "customUser" : "customEvent";
}

async function detectGA4(): Promise<boolean> {
  try {
    await ga4.getDefaultPropertyId();
    return true;
  } catch (err) {
    if (err instanceof GA4ReconnectRequiredError) return false;
    // A transient API error shouldn't silently drop GA4 from the model.
    return false;
  }
}

async function loadDiscovered(): Promise<CompileContext["discovered"]> {
  try {
    const { customDimensions, customMetrics } = await ga4.getCustomDimensionsAndMetrics();
    const dimensions: DiscoveredField[] = (customDimensions as any[]).map((d) => ({
      apiName: `${ga4ScopePrefix(d.scope)}:${d.parameterName}`,
      displayName: d.displayName ?? d.parameterName,
      description: d.description,
      scope: d.scope,
    }));
    const metrics: DiscoveredField[] = (customMetrics as any[]).map((m) => ({
      apiName: `${ga4ScopePrefix(m.scope)}:${m.parameterName}`,
      displayName: m.displayName ?? m.parameterName,
      description: m.description,
      scope: m.scope,
    }));
    return { dimensions, metrics };
  } catch {
    return { dimensions: [], metrics: [] };
  }
}

async function loadStoreSettings(): Promise<{ currency: string; timezone: string; slug: string }> {
  const fallback = {
    currency: process.env.STORE_CURRENCY ?? "USD",
    timezone: process.env.STORE_TIMEZONE ?? "UTC",
    slug: process.env.STORE_SLUG ?? (process.env.SHOPIFY_STORE_URL ?? "store").replace(/\..*$/, ""),
  };
  try {
    const shopify = getShopifyClient();
    const data = await shopify.rest<{ shop: { currency: string; iana_timezone: string; myshopify_domain: string } }>(
      "shop.json"
    );
    return {
      currency: data.shop.currency ?? fallback.currency,
      timezone: data.shop.iana_timezone ?? fallback.timezone,
      slug: (data.shop.myshopify_domain ?? "").replace(/\.myshopify\.com$/, "") || fallback.slug,
    };
  } catch {
    return fallback;
  }
}

export async function getStoreModel(force = false): Promise<CompiledModel> {
  if (!force && _cache && Date.now() - _cache.at < MODEL_TTL_MS) {
    return _cache.model;
  }

  const [ga4Connected, store] = await Promise.all([detectGA4(), loadStoreSettings()]);

  // Shopify is always connected (the agent runs against an installed store).
  const connectedProviders: Provider[] = ["shopify"];
  if (ga4Connected) connectedProviders.push("ga4");

  const discovered = ga4Connected ? await loadDiscovered() : { dimensions: [], metrics: [] };

  const model = compileModel({
    store: { slug: store.slug, currency: store.currency, timezone: store.timezone },
    connectedProviders,
    discovered,
  });

  _cache = { model, at: Date.now() };
  return model;
}

// ---------------------------------------------------------------------------
// Introspection helpers (used by explore_schema / describe_field)
// ---------------------------------------------------------------------------

export interface FieldHit {
  view: string;
  field: string;
  kind: "measure" | "dimension";
  title: string;
  score: number;
  available: boolean;
}

/** Keyword + synonym search across every field of every (available) view. */
export function searchFields(model: CompiledModel, query: string): FieldHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: FieldHit[] = [];

  const scoreField = (
    f: { name: string; title: string; description: string; synonyms?: string[]; available?: boolean },
    view: string,
    kind: "measure" | "dimension"
  ) => {
    let score = 0;
    if (f.name.toLowerCase() === q) score += 5;
    else if (f.name.toLowerCase().includes(q)) score += 3;
    if (f.synonyms?.some((s) => s.toLowerCase() === q)) score += 4;
    else if (f.synonyms?.some((s) => s.toLowerCase().includes(q))) score += 2;
    if (f.title.toLowerCase().includes(q)) score += 2;
    if (f.description.toLowerCase().includes(q)) score += 1;
    if (score > 0) {
      hits.push({ view, field: f.name, kind, title: f.title, score, available: f.available !== false });
    }
  };

  for (const view of model.views) {
    for (const m of view.measures) scoreField(m, view.name, "measure");
    for (const d of view.dimensions) scoreField(d, view.name, "dimension");
  }
  return hits.sort((a, b) => b.score - a.score);
}

export function findView(model: CompiledModel, name: string): CompiledView | undefined {
  return model.views.find((v) => v.name === name);
}
