/**
 * External MCP tools (spec 18).
 *
 * Loads the third-party MCP servers a tenant has enabled and exposes their
 * tools to the marketing agent, merged into its tool map alongside the native
 * GA4/Shopify tools. Read at agent session init via the agent's dynamic `tools`
 * function, so this runs inside runWithTenant() and sees the correct tenant.
 *
 * Design constraints (spec 18 §2.4):
 *  - Per-tenant TTL cache (~5 min): external servers (e.g. Arthaus's Picasso
 *    Concierge) rate-limit aggressively; we must not re-handshake every turn.
 *  - Per-connection isolation + bounded timeout: a down/slow/rate-limited
 *    server drops its own tools for the turn and never fails the whole chat.
 *  - Tools are namespaced by the client as `<serverName>_<toolName>`, so they
 *    can't collide with the native tool map.
 */

import { MCPClient } from "@mastra/mcp";
import { HOSTED, getTenant } from "../../../lib/tenant-context";

const CACHE_TTL_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 8000;

interface RuntimeConnection {
  id: string;
  name: string;
  server_url: string;
  auth_type: "none" | "bearer_static";
  server_instructions: string | null;
  bearer_token?: string;
}

interface LoadedMcp {
  tools: Record<string, unknown>;
  instructions: string;
  expiresAt: number;
}

// Cache the resolved toolset per tenant, plus any in-flight load to dedupe the
// concurrent calls from the dynamic `tools` and `instructions` functions.
const cache = new Map<string, LoadedMcp>();
const inflight = new Map<string, Promise<LoadedMcp>>();

/** Sanitize a connection name into a stable MCP server key: [a-z0-9_]. */
function serverKey(conn: RuntimeConnection): string {
  const base = conn.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return base || `mcp_${conn.id.slice(0, 8)}`;
}

async function fetchConnections(shop: string, storeSlug: string): Promise<RuntimeConnection[]> {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  if (!apiUrl) return [];

  const headers: Record<string, string> = {};
  if (HOSTED) {
    const serviceKey = process.env.MOS_PLATFORM_SERVICE_KEY;
    if (!serviceKey) return [];
    headers.Authorization = `Bearer ${serviceKey}`;
    headers["x-mos-tenant-shop"] = shop;
  } else {
    const deploymentKey = process.env.MARKETING_OS_DEPLOYMENT_KEY;
    if (!deploymentKey) return [];
    headers.Authorization = `Bearer ${deploymentKey}`;
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/broker/mcp-connections`, { headers });
  if (!res.ok) {
    console.warn(`[external-mcp] broker returned ${res.status} for ${storeSlug}`);
    return [];
  }
  const data = (await res.json()) as { connections?: RuntimeConnection[] };
  return data.connections ?? [];
}

/** Load one connection's tools in isolation; returns {} on any failure. */
async function loadOne(
  conn: RuntimeConnection,
  storeSlug: string,
): Promise<Record<string, unknown>> {
  const key = serverKey(conn);
  const client = new MCPClient({
    id: `ext-${storeSlug}-${conn.id}`,
    servers: {
      [key]: {
        url: new URL(conn.server_url),
        timeout: CONNECT_TIMEOUT_MS,
        ...(conn.bearer_token
          ? { requestInit: { headers: { Authorization: `Bearer ${conn.bearer_token}` } } }
          : {}),
      },
    },
  });

  try {
    // listToolsWithErrors reports per-server failures instead of throwing, and
    // the client applies the per-server `timeout` above.
    const { tools, errors } = await client.listToolsWithErrors();
    for (const [name, err] of Object.entries(errors)) {
      console.warn(`[external-mcp] ${storeSlug}: "${conn.name}" (${name}) failed: ${err}`);
    }
    return tools as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[external-mcp] ${storeSlug}: failed to load "${conn.name}" (${conn.server_url}): ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return {};
  } finally {
    // Release sockets; a fresh client is built on the next cache miss.
    await client.disconnect().catch(() => {});
  }
}

async function load(shop: string, storeSlug: string): Promise<LoadedMcp> {
  const conns = await fetchConnections(shop, storeSlug).catch(() => []);
  if (!conns.length) {
    return { tools: {}, instructions: "", expiresAt: Date.now() + CACHE_TTL_MS };
  }

  // Isolate per connection so one bad server doesn't drop the others.
  const perConn = await Promise.all(conns.map((c) => loadOne(c, storeSlug)));
  const tools: Record<string, unknown> = {};
  for (const t of perConn) Object.assign(tools, t);

  const instructions = conns
    .filter((c) => c.server_instructions)
    .map((c) => `Tools from "${c.name}":\n${c.server_instructions}`)
    .join("\n\n");

  const loadedCount = Object.keys(tools).length;
  if (loadedCount) {
    console.log(`[external-mcp] ${storeSlug}: loaded ${loadedCount} tool(s) from ${conns.length} server(s)`);
  }

  return { tools, instructions, expiresAt: Date.now() + CACHE_TTL_MS };
}

async function loadCached(): Promise<LoadedMcp> {
  let tenant: { shop: string; storeSlug: string };
  try {
    tenant = getTenant();
  } catch {
    // No tenant context (shouldn't happen on the chat path) → no external tools.
    return { tools: {}, instructions: "", expiresAt: 0 };
  }

  const cacheKey = tenant.storeSlug;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = load(tenant.shop, tenant.storeSlug)
    .then((result) => {
      cache.set(cacheKey, result);
      return result;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  return promise;
}

/** External MCP tools for the current tenant (merge into the agent tool map). */
export async function getExternalMcpTools(): Promise<Record<string, unknown>> {
  return (await loadCached()).tools;
}

/**
 * The connected servers' own usage instructions, to append to the agent system
 * prompt so it knows how to drive the newly-available tools.
 */
export async function getExternalMcpInstructions(): Promise<string> {
  const { instructions } = await loadCached();
  return instructions ? `\n\nConnected external tools:\n${instructions}` : "";
}
