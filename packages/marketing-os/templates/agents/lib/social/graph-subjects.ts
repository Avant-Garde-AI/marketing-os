/** VENDORED from packages/skills/social-media/src/graph-subjects.ts; change the canonical module first. */
import { createHash } from "node:crypto";
import { z } from "zod";

const text = z.string().trim().min(1);
const handle = text.regex(/^[a-z0-9][a-z0-9-]{0,200}$/);
const facetValues = z.array(text.max(300)).max(50).default([]);
const resultSchema = z.object({ results: z.array(z.object({ handle, title: text.max(1000), artist: z.string().optional() })).max(100) });
const facetsSchema = z.object({ artworks: z.array(z.object({ handle, palette: facetValues, subject: facetValues, movement: facetValues, mood: facetValues })).max(100) });

export interface CatalogSubject {
  handle: string;
  title: string;
  status: string;
  onlineStoreUrl?: string;
  imageUrl?: string;
}
export interface SubjectReceipt {
  ref: string;
  kind: "graph" | "catalog";
  operation: string;
  capturedAt: string;
  digest: string;
  /** Bounded normalized evidence returned with the packet, not a persisted artifact. */
  data: unknown;
}
export interface GraphSubjectPacket {
  tenant: string;
  query: string;
  receipts: SubjectReceipt[];
  subjects: Array<{
    handle: string;
    title: string;
    artist?: string;
    facets: { palette: string[]; subject: string[]; movement: string[]; mood: string[] };
    productUrl: string;
    imageUrl: string;
    /** An active Online Store listing does not establish stock availability. */
    inventoryAvailability: "unknown";
    sourceRefs: string[];
  }>;
  rejected: Array<{ handle: string; reasons: string[] }>;
}
export interface GraphSubjectDependencies {
  tenant: string;
  callGraph: (operation: "explore_concept" | "get_artwork_facets", args: Record<string, unknown>) => Promise<unknown>;
  readCatalog: (handles: string[]) => Promise<CatalogSubject[]>;
  now?: () => string;
}

/** Resolves only the two required reads from the current tenant's enabled tool map. */
export function bindGraphSubjectReads(prefix: string, tools: Record<string, unknown>): GraphSubjectDependencies["callGraph"] {
  if (!/^[a-z0-9_]{1,100}$/.test(prefix)) throw new Error("Use the exact enabled graph connection prefix");
  const bound = new Map<string, { execute: (args: unknown) => Promise<unknown> }>();
  for (const operation of ["explore_concept", "get_artwork_facets"] as const) {
    const candidate = tools[`${prefix}_${operation}`] as { execute?: unknown } | undefined;
    if (!candidate || typeof candidate.execute !== "function") throw new Error(`Enabled graph connection is missing ${operation}`);
    bound.set(operation, candidate as { execute: (args: unknown) => Promise<unknown> });
  }
  return async (operation, args) => {
    const tool = bound.get(operation);
    if (!tool) throw new Error("Graph subject adapter permits only configured read operations");
    return tool.execute(args);
  };
}

function decode(raw: unknown): unknown {
  if (typeof raw === "string") {
    if (raw.length > 200_000) throw new Error("Graph response exceeds the bounded subject packet limit");
    return decode(JSON.parse(raw));
  }
  if (!raw || typeof raw !== "object") throw new Error("Graph response is not structured data");
  const value = raw as Record<string, unknown>;
  if (value.error || value.isError === true) throw new Error("Graph query failed; no subjects were verified");
  if (value.structuredContent) return decode(value.structuredContent);
  if (Array.isArray(value.content)) {
    const blocks = value.content.filter((c): c is { type: string; text: string } => Boolean(c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string"));
    if (blocks.length !== 1) throw new Error("Graph response must contain one structured result");
    return decode(blocks[0]!.text);
  }
  if (JSON.stringify(raw).length > 200_000) throw new Error("Graph response exceeds the bounded subject packet limit");
  return raw;
}

function receipt(tenant: string, kind: SubjectReceipt["kind"], operation: string, capturedAt: string, args: unknown, data: unknown): SubjectReceipt {
  const digest = createHash("sha256").update(JSON.stringify({ tenant, kind, operation, capturedAt, args, data })).digest("hex");
  return { ref: `${kind}:${digest}`, kind, operation, capturedAt, digest, data };
}
function https(value: string | undefined): value is string {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

/** Read-only acquisition of graph-discovered, current catalog subjects. Does not assess semantic concept needs or generate creative. */
export async function collectGraphSubjects(
  request: { concept: string; limit: number },
  dependencies: GraphSubjectDependencies
): Promise<GraphSubjectPacket> {
  const query = text.max(200).parse(request.concept);
  const limit = z.number().int().min(1).max(6).parse(request.limit);
  const tenant = text.parse(dependencies.tenant);
  const capturedAt = z.string().datetime().parse((dependencies.now ?? (() => new Date().toISOString()))());
  const exploreArgs = { concept: query, limit };
  const explored = resultSchema.parse(decode(await dependencies.callGraph("explore_concept", exploreArgs)));
  const selected = explored.results.slice(0, limit);
  if (new Set(selected.map((r) => r.handle)).size !== selected.length) throw new Error("Graph query returned duplicate catalog handles");
  const discovery = receipt(tenant, "graph", "explore_concept", capturedAt, exploreArgs, selected);
  const packet: GraphSubjectPacket = { tenant, query, receipts: [discovery], subjects: [], rejected: [] };
  if (!selected.length) return packet;

  // Graph aliases are explicit and preserved; catalog lookup always uses the original exact handle.
  const graphHandle = (h: string) => h.replace(/(?:-no-frame|-old)$/, "");
  const facetArgs = { handles: [...new Set(selected.map((r) => graphHandle(r.handle)))] };
  const facets = facetsSchema.parse(decode(await dependencies.callGraph("get_artwork_facets", facetArgs)));
  if (new Set(facets.artworks.map((r) => r.handle)).size !== facets.artworks.length) throw new Error("Graph facets returned duplicate handles");
  const facetReceipt = receipt(tenant, "graph", "get_artwork_facets", capturedAt, facetArgs, facets.artworks);
  packet.receipts.push(facetReceipt);
  const catalog = await dependencies.readCatalog(selected.map((r) => r.handle));
  if (new Set(catalog.map((r) => r.handle)).size !== catalog.length || catalog.some((r) => !selected.some((s) => s.handle === r.handle)))
    throw new Error("Catalog reader returned unexpected or duplicate handles");
  const catalogReceipt = receipt(tenant, "catalog", "products-by-handle", capturedAt, { handles: selected.map((r) => r.handle) }, catalog);
  packet.receipts.push(catalogReceipt);
  for (const result of selected) {
    const facts = facets.artworks.find((r) => r.handle === graphHandle(result.handle));
    const product = catalog.find((r) => r.handle === result.handle);
    const reasons: string[] = [];
    if (!facts || ![...facts.palette, ...facts.subject, ...facts.movement, ...facts.mood].length) reasons.push("graph-facets-missing");
    if (!product) reasons.push("catalog-product-missing");
    else {
      if (product.status.toUpperCase() !== "ACTIVE") reasons.push("catalog-product-inactive");
      if (!https(product.onlineStoreUrl)) reasons.push("catalog-online-store-url-missing");
      if (!https(product.imageUrl)) reasons.push("catalog-image-missing");
      if (!product.title.trim()) reasons.push("catalog-title-missing");
    }
    if (reasons.length) { packet.rejected.push({ handle: result.handle, reasons }); continue; }
    packet.subjects.push({
      handle: result.handle, title: product!.title, ...(result.artist ? { artist: result.artist } : {}),
      facets: { palette: facts!.palette, subject: facts!.subject, movement: facts!.movement, mood: facts!.mood },
      productUrl: product!.onlineStoreUrl!, imageUrl: product!.imageUrl!, inventoryAvailability: "unknown",
      sourceRefs: [discovery.ref, facetReceipt.ref, catalogReceipt.ref],
    });
  }
  return packet;
}
