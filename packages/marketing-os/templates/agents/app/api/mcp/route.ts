// agents/app/api/mcp/route.ts
//
// The store's unified MCP endpoint. Stateless Streamable HTTP (single JSON
// response per request — mandatory on Vercel serverless). Exposes the semantic
// layer + GA4 primitives as MCP tools, the semantic:// resources, and analysis
// prompts. Auth is a connector token (Authorization: Bearer mos_… or ?token=),
// verified against the Marketing OS platform.

import { extractToken, verifyConnectorToken } from "@/lib/connector-auth";
import { verifyProxyHandoff } from "@/lib/proxy-auth";
import { HOSTED, getTenant, runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { runExploreSchema, runDescribeField } from "@/src/mastra/semantics/introspect";
import { runQuery, explainQuery } from "@/src/mastra/semantics/query";
import { ga4 } from "@/lib/ga4";
import { resolveImagery, listRooms } from "@/lib/imagery/resolve";
import { createEmailTools } from "@/lib/email/tools";
import { emailRepo } from "@/lib/email/repo";
import { createKlaviyoClient } from "@/lib/email/klaviyo-client";
import { emailTools } from "@/src/mastra/tools/email";
import { emailAuthoringTools } from "@/src/mastra/tools/email-authoring";
import { actionTools } from "@/src/mastra/tools/actions";
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

/**
 * Invoke one email-pack read tool.
 *
 * The pack's tools close over the tenant's repo and Klaviyo client, so they are
 * constructed per call rather than at module load — this route already runs
 * inside runWithTenant, and a module-level instance would bind whichever tenant
 * happened to warm the lambda.
 *
 * The pack's enablement gate still applies underneath: a store without the
 * email pack enabled (or without Klaviyo connected) gets the pack's own error,
 * which is more useful than hiding the tool from tools/list.
 */
async function emailTool(name: string, args: unknown): Promise<unknown> {
  const defs = createEmailTools(emailRepo, createKlaviyoClient()) as unknown as Record<
    string,
    { execute: (i: unknown) => Promise<unknown> } | undefined
  >;
  const def = defs[name];
  if (!def) throw new Error(`Unknown email tool: ${name}`);
  return def.execute(args);
}

/** The runtime's Mastra email tools (email_render_preview lives here, not in the pack). */
function emailToolMap(): Record<string, { execute: (i: never) => Promise<unknown> }> {
  return emailTools as unknown as Record<string, { execute: (i: never) => Promise<unknown> }>;
}

/** Invoke a Mastra tool from the MCP dispatch (their execute takes the raw input). */
async function runMastra(tool: unknown, args: unknown): Promise<unknown> {
  const t = tool as { execute: (i: never) => Promise<unknown> } | undefined;
  if (!t?.execute) throw new Error("tool is not available on this deployment");
  return t.execute(args as never);
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

  // -------------------------------------------------------------------------
  // Imagery — the store's mockup pipeline, exposed declaratively.
  //
  // A caller asks for a ROLE, not a URL. The resolver composites the artwork
  // into the store's room-template library and applies the house rules (oak
  // first, never white, no room scenes for square art, treatment by role), then
  // returns the winner plus the runners-up so a vision pass or a human can
  // override. Uses no image generation, so it is unaffected by the Gemini
  // spend cap.
  //
  // The URLs are SIGNED and expire — fine for a preview, but anything that will
  // be sent must be uploaded to the ESP first. `expiresInMinutes` says so in
  // the payload rather than only in the docs.
  // -------------------------------------------------------------------------
  {
    name: "imagery_resolve",
    description:
      "Resolve a lifestyle/product shot for one artwork. Give the artwork's public image URL, a stable key, and the ROLE it plays (hero-editorial and hero-room get the work in a styled room; hero-artist and hero-product get the leaning studio shot). Returns the chosen image plus ranked alternatives, each with the reason it ranked there, and the provenance string to record on the campaign. Signed URLs expire — upload to the ESP before sending.",
    inputSchema: {
      type: "object",
      properties: {
        artworkUrl: { type: "string", description: "Public https URL of the artwork image to composite." },
        artworkKey: { type: "string", description: "Stable key (e.g. the Shopify handle) — seeds template selection so the same piece resolves consistently across campaigns." },
        role: {
          type: "string",
          enum: ["hero-editorial", "hero-room", "hero-artist", "hero-product", "thumbnail"],
          description: "What the image is for; picks the treatment.",
        },
        orientation: { type: "string", enum: ["portrait", "landscape", "square"], description: "Artwork orientation. 'square' suppresses room scenes — the library has no square rooms." },
        rooms: { type: "array", items: { type: "string" }, description: "Optional preferred room ids (see imagery_rooms), e.g. a seasonal mood." },
        title: { type: "string" },
      },
      required: ["artworkUrl", "artworkKey", "role"],
    },
    run: (a) => resolveImagery(a),
  },
  {
    name: "imagery_rooms",
    description:
      "List the room settings imagery_resolve can actually composite into (built templates only, with their mood and room type). Use this to pick a seasonal or tonal room rather than guessing an id.",
    inputSchema: { type: "object", properties: {} },
    run: () => listRooms(),
  },

  // -------------------------------------------------------------------------
  // Email campaign reads (the pack's read surface; writes stay Actions).
  //
  // Built per-request because the tools close over the tenant's repo and
  // Klaviyo client, and this route already runs inside runWithTenant.
  // -------------------------------------------------------------------------
  {
    name: "email_plan_propose",
    description:
      "Propose a month's email campaign calendar from the store's email strategy: send slots by cadence and preferred days, archetypes rotated by weight, audiences under their cadence caps, every slot carrying its rationale. Deterministic and read-only — approving a plan is an Action.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM" },
        campaignsOverride: { type: "number" },
        context: { type: "object", description: "Optional { topMovers, seasonal, readback } woven into rationales." },
      },
      required: ["month"],
    },
    run: (a) => emailTool("email_plan_propose", a),
  },
  {
    name: "email_calendar_read",
    description: "Read the store's email calendar for a month: every slot, its archetype, audience, status and linked campaign, plus gap analysis against the strategy.",
    inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } }, required: ["month"] },
    run: (a) => emailTool("email_calendar_read", a),
  },
  {
    name: "email_campaign_read",
    description: "Read one campaign's full state: subject candidates, preview text, audience, sections, Klaviyo ids and status.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a) => emailTool("email_campaign_read", a),
  },
  {
    name: "klaviyo_audiences_read",
    description: "Live Klaviyo lists and segments with profile counts, for choosing and sizing a campaign audience.",
    inputSchema: { type: "object", properties: {} },
    run: (a) => emailTool("klaviyo_audiences_read", a ?? {}),
  },
  {
    name: "klaviyo_performance_read",
    description: "Campaign performance from Klaviyo over a window. Always report the attribution basis it returns alongside the numbers.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO date" },
        until: { type: "string", description: "ISO date" },
        campaignIds: { type: "array", items: { type: "string" } },
      },
    },
    run: (a) => emailTool("klaviyo_performance_read", a ?? {}),
  },

  // -------------------------------------------------------------------------
  // Campaign authoring + staging.
  //
  // Completes the chain an MCP client (a Claude Code session, say) needs to
  // drive a campaign end to end: plan → author content → preview → stage for
  // approval. The final publish step is deliberately absent — see the note on
  // propose_email_draft.
  // -------------------------------------------------------------------------
  {
    name: "email_campaign_upsert",
    description:
      "Create or update a campaign's CONTENT in the store repo: subject, preview text, audience, and the ordered sections of the email. Writes only the repo artifact — nothing is created in Klaviyo and nothing sends. Pass only the fields you want to change; omitted fields are preserved. Refuses to edit a campaign already drafted or scheduled, so an approved send and its artifact cannot drift apart.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Campaign id, e.g. 2026-09-01-artist-mirimo." },
        archetype: { type: "string", description: "Required when creating." },
        subject: { type: "string" },
        subjectCandidates: { type: "array", items: { type: "string" } },
        previewText: { type: "string" },
        audienceIncluded: {
          type: "array",
          items: { type: "object", properties: { type: { type: "string", enum: ["list", "segment"] }, id: { type: "string" }, label: { type: "string" } }, required: ["type", "id"] },
        },
        audienceExcluded: { type: "array", items: { type: "object" } },
        sections: {
          type: "array",
          description: "The email body in order. An html section carries `blocks` (heading, paragraph, button, productRow, eyebrow, callout, ctaBand, featuredCard, list, swatches, chips, trustBadges, divider, image, graphCallout); a surface section carries `alt` plus an imageUrl (e.g. from imagery_resolve).",
          items: { type: "object" },
        },
        skeletonRef: { type: "string" },
        copyFormulaRef: { type: "string" },
        body: { type: "string", description: "Markdown rationale kept with the artifact." },
        scheduledAt: { type: "string", description: "Intended send time (ISO). Recording it does NOT schedule anything." },
      },
      required: ["id"],
    },
    run: (a) => runMastra(emailAuthoringTools.email_campaign_upsert, a),
  },
  {
    name: "email_render_preview",
    description:
      "Assemble a campaign's current state into real email HTML and return a preview URL a human can open, plus the invariant report (errors/warnings). Read-only; nothing touches Klaviyo. Run this before staging so problems surface early.",
    inputSchema: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"] },
    run: (a) => runMastra(emailToolMap().email_render_preview, a),
  },
  {
    name: "propose_email_draft",
    description:
      "Stage an approved campaign to Klaviyo FOR APPROVAL: runs the action's read-only preview, creates a governed proposal, and posts the approval card to Slack. Nothing is created in Klaviyo and nothing sends until a store admin approves that card — approval requires a verified human identity, which an API token does not carry, so it deliberately cannot be done from here. Returns the proposal id and the summary the approver will see.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        channel: { type: "string", description: "Slack channel id for the card (defaults to the store's digest channel)." },
      },
      required: ["campaignId"],
    },
    run: (a) =>
      runMastra(actionTools.propose_action, {
        kind: "klaviyo.create_campaign_draft",
        params: { campaignId: a.campaignId },
        ...(a.channel ? { channel: a.channel } : {}),
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

/** Resolve the request's tenant from whichever auth succeeded. */
function resolveTenantFromAuth(
  req: Request,
  tokenAuth: { valid: boolean; tenantId?: string; shop?: string; storeSlug?: string }
): TenantContext | null {
  if (tokenAuth.valid && tokenAuth.shop && tokenAuth.storeSlug) {
    return { tenantId: tokenAuth.tenantId, shop: tokenAuth.shop, storeSlug: tokenAuth.storeSlug };
  }
  // Proxy handoff: shop travels in the router-signed header.
  const shop = req.headers.get("x-mos-proxy-shop");
  if (shop) {
    return { shop, storeSlug: shop.replace(/\.myshopify\.com$/, "") };
  }
  // Client-owned fallback: the deployment is the tenant (env-derived).
  if (!HOSTED) return getTenant();
  return null;
}

export async function POST(req: Request) {
  // Auth: a connector token (Bearer or ?token=), OR a router-signed proxy
  // handoff (Shopify App Proxy path — Shopify's HMAC was verified upstream).
  const token = extractToken(req);
  const tokenAuth = token ? await verifyConnectorToken(token) : { valid: false };
  const authed = tokenAuth.valid || verifyProxyHandoff(req);
  if (!authed) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: a valid connector token is required." } },
      { status: 401, headers: { ...CORS_HEADERS, "WWW-Authenticate": "Bearer" } }
    );
  }

  // Per-request tenant resolution (spec 11 §3.1): in the pooled hosted runtime
  // the tenant is NEVER implied by the deployment. Every downstream data
  // access (broker tokens, Shopify client, semantic model cache, storage)
  // reads this context.
  const tenant = resolveTenantFromAuth(req, tokenAuth);
  if (!tenant) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: could not resolve a tenant for this request." } },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const clientProtocol = req.headers.get("mcp-protocol-version") ?? undefined;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS_HEADERS });
  }

  return runWithTenant(tenant, async () => {
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
  });
}
