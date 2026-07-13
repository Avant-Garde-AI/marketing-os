/**
 * External MCP tools (spec 18).
 *
 * Exposes a tenant's enabled third-party MCP servers to the marketing agent,
 * merged into its tool map alongside the native GA4/Shopify tools. Read at
 * session init via the agent's dynamic `tools` function, so this runs inside
 * runWithTenant() and sees the correct tenant.
 *
 * IMPLEMENTATION NOTE — stateless HTTP, not the SDK client.
 * We deliberately do NOT use @mastra/mcp's MCPClient to *invoke* tools. That
 * client keeps a stateful connection with a standalone SSE stream; against a
 * STATELESS Streamable-HTTP server (e.g. Arthaus's Picasso Concierge, which
 * returns no mcp-session-id) the connection goes "Not connected" between
 * listing and calling, and its reconnect hangs to the timeout — so every tool
 * call failed in production. The server, however, answers a plain `tools/call`
 * POST directly (no initialize needed) in a few seconds. So we speak just
 * enough MCP over fetch: one POST to `tools/list` at load (TTL-cached), and one
 * POST per `tools/call` at invocation. No sessions, no reconnects, no SSE.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { HOSTED, getTenant } from "../../../lib/tenant-context";

const CACHE_TTL_MS = 5 * 60 * 1000;
const LIST_TIMEOUT_MS = 8_000;
// Tool calls can be heavy (art-graph queries, concierge LLM) — measured 4–12s.
const CALL_TIMEOUT_MS = 30_000;

interface RuntimeConnection {
  id: string;
  name: string;
  server_url: string;
  auth_type: "none" | "bearer_static";
  server_instructions: string | null;
  bearer_token?: string;
}

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

interface LoadedMcp {
  tools: Record<string, unknown>;
  instructions: string;
  expiresAt: number;
}

const cache = new Map<string, LoadedMcp>();
const inflight = new Map<string, Promise<LoadedMcp>>();

// ---------------------------------------------------------------------------
// Minimal MCP-over-HTTP (stateless)
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

function parseSse(text: string): unknown {
  let parsed: unknown = null;
  for (const line of text.split("\n")) {
    const t = line.trimEnd();
    if (t.startsWith("data:")) {
      const payload = t.slice(5).trim();
      if (payload) {
        try {
          parsed = JSON.parse(payload);
        } catch {
          /* ignore non-JSON data lines */
        }
      }
    }
  }
  return parsed;
}

async function mcpPost(
  serverUrl: string,
  body: unknown,
  bearer: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; json: { result?: any; error?: { message?: string } } | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(serverUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    let json: unknown = null;
    if (ct.includes("text/event-stream")) json = parseSse(text);
    else {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, json: json as { result?: any; error?: { message?: string } } | null };
  } finally {
    clearTimeout(timer);
  }
}

/** One tools/call POST, with a single retry on 429 (the server rate-limits). */
async function callRemoteTool(
  conn: RuntimeConnection,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status, json } = await mcpPost(
      conn.server_url,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args ?? {} } },
      conn.bearer_token,
      CALL_TIMEOUT_MS,
    );
    if (status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (status !== 200) throw new Error(`${toolName}: server returned HTTP ${status}`);
    if (json?.error) throw new Error(`${toolName}: ${json.error.message ?? "MCP error"}`);
    const content = (json?.result?.content ?? []) as { type?: string; text?: string }[];
    const text = content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    return text || json?.result || {};
  }
  throw new Error(`${toolName}: rate-limited (429) after retry`);
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod (covers the object/string/number/boolean/array shapes MCP
// tool inputSchemas use; unknown shapes fall back to z.any()).
// ---------------------------------------------------------------------------

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/**
 * Convert an MCP tool inputSchema (JSON Schema subset) to Zod. Produces schemas
 * that Gemini's function-calling accepts: it resolves the common nullable
 * pattern `anyOf: [{...}, {type:"null"}]` and `type: ["x","null"]` to the inner
 * type made optional, and never emits a bare `z.any()` for a typed field (an
 * untyped function parameter makes Gemini emit malformed calls / stream errors).
 */
function jsonSchemaToZod(schema: JsonSchema | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();

  // Nullable / union via anyOf|oneOf → inner non-null type, marked optional.
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && variants.length) {
    const nonNull = variants.find((v) => v && v.type !== "null");
    const hasNull = variants.some((v) => v && v.type === "null");
    const inner = nonNull ? jsonSchemaToZod(nonNull) : z.string();
    return hasNull ? inner.optional() : inner;
  }

  // `type` may be an array like ["string","null"] — pick the non-null member.
  let type = schema.type;
  if (Array.isArray(type)) type = type.find((t) => t !== "null") ?? "string";

  switch (type) {
    case "string": {
      const s = z.string();
      return schema.description ? s.describe(schema.description) : s;
    }
    case "integer":
    case "number": {
      const s = z.number();
      return schema.description ? s.describe(schema.description) : s;
    }
    case "boolean":
      return schema.description ? z.boolean().describe(schema.description) : z.boolean();
    case "array":
      return z.array(jsonSchemaToZod(schema.items));
    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {};
      const required = new Set(schema.required ?? []);
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        let field = jsonSchemaToZod(v);
        if (!required.has(k)) field = field.optional();
        shape[k] = field;
      }
      return z.object(shape);
    }
    default:
      // Unknown/absent type: a permissive string keeps the param VALID for
      // Gemini rather than untyped (z.any()); optional-ness handled by caller.
      return z.string();
  }
}

// ---------------------------------------------------------------------------
// Connection fetch (broker) + tool building
// ---------------------------------------------------------------------------

/** Sanitize a connection name into a stable tool-namespace key: [a-z0-9_]. */
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

/** tools/list one connection, build a namespaced Mastra tool per remote tool. */
async function buildToolsForConnection(
  conn: RuntimeConnection,
  storeSlug: string,
): Promise<Record<string, unknown>> {
  let remoteTools: RemoteTool[] = [];
  try {
    const { status, json } = await mcpPost(
      conn.server_url,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      conn.bearer_token,
      LIST_TIMEOUT_MS,
    );
    if (status !== 200 || json?.error) {
      console.warn(`[external-mcp] ${storeSlug}: "${conn.name}" tools/list failed (HTTP ${status})`);
      return {};
    }
    remoteTools = (json?.result?.tools ?? []) as RemoteTool[];
  } catch (err) {
    console.warn(
      `[external-mcp] ${storeSlug}: "${conn.name}" tools/list error: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return {};
  }

  const key = serverKey(conn);
  const out: Record<string, unknown> = {};
  for (const t of remoteTools) {
    const toolId = `${key}_${t.name}`;
    out[toolId] = createTool({
      id: toolId,
      description: t.description ?? `${t.name} (from ${conn.name})`,
      inputSchema: jsonSchemaToZod(t.inputSchema ?? { type: "object", properties: {} }),
      execute: async (inputData: unknown) => {
        try {
          return await callRemoteTool(conn, t.name, inputData);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[external-mcp] ${storeSlug}: tool ${toolId} failed: ${message}`);
          // Return an error payload rather than throwing, so the agent can tell
          // the user the source was unreachable instead of aborting the turn.
          return { error: `The "${conn.name}" tool could not be reached: ${message}` };
        }
      },
    });
  }
  return out;
}

async function load(shop: string, storeSlug: string): Promise<LoadedMcp> {
  const conns = await fetchConnections(shop, storeSlug).catch(() => []);
  if (!conns.length) {
    return { tools: {}, instructions: "", expiresAt: Date.now() + CACHE_TTL_MS };
  }

  const perConn = await Promise.all(conns.map((c) => buildToolsForConnection(c, storeSlug)));
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
