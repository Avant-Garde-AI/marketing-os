// agents/app/api/mcp/route.ts
//
// The store's unified MCP endpoint. Stateless Streamable HTTP (single JSON
// response per request — mandatory on Vercel serverless). Exposes the semantic
// layer + GA4 primitives as MCP tools, the semantic:// resources, and analysis
// prompts. Auth is a connector token (Authorization: Bearer mos_… or ?token=),
// verified against the Marketing OS platform.

import { extractToken, verifyConnectorToken } from "@/lib/connector-auth";
import { runExploreSchema, runDescribeField } from "@/src/mastra/semantics/introspect";
import { runQuery, explainQuery } from "@/src/mastra/semantics/query";
import { ga4 } from "@/lib/ga4";
import {
  STATIC_RESOURCES,
  RESOURCE_TEMPLATES,
  readResource,
} from "@/src/mastra/semantics/mcp-resources";
import { PROMPTS, getPrompt } from "@/src/mastra/semantics/mcp-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INSTRUCTIONS = `This is the Marketing OS MCP endpoint for a single Shopify store. It exposes a governed marketing semantic layer over the store's connected data (Google Analytics 4 and Shopify commerce today; Google Ads and Meta when connected).

How to work here:
- Start with explore_schema (no args) to see the available views and what each answers. Views reflect exactly what is connected; unavailable views explain what to connect.
- For any field you have not used, call describe_field to confirm its meaning, format, and provenance before relying on it.
- Use query to get data. It returns a self-describing envelope: data plus coverage, freshness, timezone, currency, applied defaults, and caveats. Always report numbers with their currency and respect the caveats.
- For an expensive or uncertain query, call explain_query first — it validates and returns the compiled plan without spending quota.
- Prefer the semantic views over the raw GA4 primitive tools (get_account_summaries, run_report, …). Drop to primitives only when the semantic layer cannot express the question.
- Read semantic://glossary before comparing metrics across systems: GA4 key_events, platform conversions, and Shopify orders are three different counting systems, and sessions never reconcile with ad clicks.
- Invalid field names return did-you-mean guidance — follow it rather than guessing.

Resources: semantic://manifest (the full model), semantic://views/{view}, semantic://glossary, semantic://connections, semantic://cookbook. Prompts provide ready-made analysis playbooks.`;

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema mirrors the Mastra tools)
// ---------------------------------------------------------------------------

const queryJsonSchema = {
  type: "object",
  properties: {
    view: { type: "string", description: "The view to query (from explore_schema)." },
    measures: { type: "array", items: { type: "string" }, description: "Measure names to aggregate." },
    dimensions: { type: "array", items: { type: "string" }, description: "Dimension names to group by." },
    time: {
      type: "object",
      properties: {
        grain: { type: "string", enum: ["hour", "day", "week", "month", "quarter", "year"] },
        range: { description: "named range (last_30_days, this_month, yesterday, 7daysAgo) or {start,end}" },
      },
    },
    filters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          op: { type: "string", enum: ["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "between"] },
          value: {},
        },
        required: ["field", "op"],
      },
    },
    order: {
      type: "array",
      items: {
        type: "object",
        properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } },
        required: ["field", "dir"],
      },
    },
    limit: { type: "number" },
    offset: { type: "number" },
  },
  required: ["view", "measures"],
};

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "explore_schema",
    description:
      "Explore the store's marketing data model. No args → list views. { view } → that view's measures/dimensions/grains. { search } → find a field across all views (synonyms included).",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string" }, search: { type: "string" } },
    },
    run: (a) => runExploreSchema(a ?? {}),
  },
  {
    name: "describe_field",
    description:
      "Full definition of one field: meaning, format, per-provider provenance, formula, caveats, synonyms, enum values.",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string" }, field: { type: "string" } },
      required: ["view", "field"],
    },
    run: (a) => runDescribeField(a),
  },
  {
    name: "query",
    description:
      "Run a governed query and get a self-describing result envelope (data + coverage, freshness, timezone, currency, caveats). Prefer this for marketing questions.",
    inputSchema: queryJsonSchema,
    run: (a) => runQuery(a),
  },
  {
    name: "explain_query",
    description:
      "Validate a query and return the compiled plan WITHOUT executing it (zero quota). Same input as query.",
    inputSchema: queryJsonSchema,
    run: (a) => explainQuery(a),
  },
  // GA4 primitives (escape hatch) ------------------------------------------
  {
    name: "get_account_summaries",
    description: "[Primitive] List GA4 account summaries and their properties.",
    inputSchema: { type: "object", properties: {} },
    run: () => ga4.getAccountSummaries(),
  },
  {
    name: "get_property_details",
    description: "[Primitive] GA4 property details (name, timezone, currency).",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
    run: (a) => ga4.getPropertyDetails(a?.propertyId),
  },
  {
    name: "get_custom_dimensions_and_metrics",
    description: "[Primitive] List the GA4 property's custom dimensions and metrics.",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
    run: (a) => ga4.getCustomDimensionsAndMetrics(a?.propertyId),
  },
  {
    name: "run_report",
    description:
      "[Primitive] Run a GA4 core report. Args: dimensions (string[]), metrics (string[]), dateRanges ([{startDate,endDate}]), limit.",
    inputSchema: {
      type: "object",
      properties: {
        dimensions: { type: "array", items: { type: "string" } },
        metrics: { type: "array", items: { type: "string" } },
        dateRanges: { type: "array", items: { type: "object" } },
        limit: { type: "number" },
      },
      required: ["metrics"],
    },
    run: (a) =>
      ga4.runReport({
        dimensions: (a.dimensions ?? []).map((name: string) => ({ name })),
        metrics: (a.metrics ?? []).map((name: string) => ({ name })),
        dateRanges: a.dateRanges ?? [{ startDate: "30daysAgo", endDate: "today" }],
        limit: a.limit ?? 50,
      }),
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

function rpcResult(id: any, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: any, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function dispatch(msg: RpcRequest, clientProtocol?: string): Promise<object | null> {
  const { id, method, params } = msg;

  // Notifications (no id) get no response.
  if (id === undefined || id === null) {
    return null;
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: clientProtocol ?? PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: `marketing-os — ${process.env.STORE_SLUG ?? "store"}`, version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });

    case "tools/call": {
      const tool = TOOL_MAP.get(params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params?.arguments ?? {});
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }

    case "resources/list":
      return rpcResult(id, { resources: STATIC_RESOURCES });

    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: RESOURCE_TEMPLATES });

    case "resources/read": {
      const uri = params?.uri as string;
      const text = await readResource(uri);
      if (text === null) return rpcError(id, -32602, `Unknown resource: ${uri}`);
      return rpcResult(id, { contents: [{ uri, mimeType: "application/json", text }] });
    }

    case "prompts/list":
      return rpcResult(id, { prompts: PROMPTS });

    case "prompts/get": {
      const prompt = getPrompt(params?.name, params?.arguments ?? {});
      if (!prompt) return rpcError(id, -32602, `Unknown prompt: ${params?.name}`);
      return rpcResult(id, prompt);
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function GET() {
  // Stateless server: no SSE stream for server-initiated messages.
  return new Response("Method Not Allowed — use POST for MCP JSON-RPC.", {
    status: 405,
    headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" },
  });
}

export async function POST(req: Request) {
  // Auth: connector token via Bearer or ?token=.
  const token = extractToken(req);
  const auth = token ? await verifyConnectorToken(token) : { valid: false };
  if (!auth.valid) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: a valid connector token is required." } },
      { status: 401, headers: { ...CORS_HEADERS, "WWW-Authenticate": "Bearer" } }
    );
  }

  const clientProtocol = req.headers.get("mcp-protocol-version") ?? undefined;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS_HEADERS });
  }

  // Batch or single
  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((m) => dispatch(m as RpcRequest, clientProtocol)))).filter(
      (r): r is object => r !== null
    );
    return Response.json(responses, { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
  }

  const response = await dispatch(payload as RpcRequest, clientProtocol);
  if (response === null) {
    // Notification — acknowledge with 202 and no body.
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }
  return Response.json(response, { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}
