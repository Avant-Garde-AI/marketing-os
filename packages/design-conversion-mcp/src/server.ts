/**
 * The Design Conversion MCP server core (spec 35, the pre-model decision layer).
 *
 * Transport-free: `handle(message, ctx)` takes one JSON-RPC message and returns
 * the response (or null for a notification). `stdio.ts` and `http.ts` wrap it.
 * The same core runs locally from the open-source CLI (bring your own VLM key)
 * and hosted by Marketing OS (account-scoped tokens, metered audits), which
 * plugs in through `authorize`.
 *
 * Tools are reads: nothing here mutates a store. An agent that acts on a
 * stroke does so in its own repo, and in Marketing OS through the action gate.
 */
import { z } from "zod";
import {
  ALL_CATEGORIES, benchmarkFor, CONVERSION_LENS, CONVERSION_STAGES, conversionRole, DTC_SEED_AXES, isRecognized,
  resolveAdmitted, STROKE_CAVEATS, suggestStrokes, vocabularyReport, normalizeAxis, normalizeValue,
  familyOf, type Benchmarks, type LabelRecord, type PageType, type Taxonomy, type VisionModel, type Vocabulary,
} from "@avant-garde/design-craft";
import { assertPublicUrl, auditImages, type PageImages } from "./audit.js";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_NAME = "design-conversion";
export const SERVER_VERSION = "0.1.0";

export interface DesignConversionDeps {
  vocabulary: Vocabulary;
  benchmarks: Benchmarks;
  /** Value families per axis (axis → decision → value). Conventions and strokes use them when present. */
  taxonomy?: Taxonomy;
  /** Label records behind the benchmarks; only `design_report` needs them. */
  labels?: LabelRecord[];
  /** Perception model (any OpenAI-compatible VLM). Without it the audit tools explain how to configure one. */
  vision?: VisionModel;
  /** Captures one URL (Playwright locally). Without it, `design_audit_page` is unavailable and screenshots are the way in. */
  capture?: (url: string, viewport: "desktop" | "mobile") => Promise<PageImages & { capturedAt: string }>;
  /** Called before every tool call. Throw to deny (auth scope, quota). `costly` marks calls that spend model tokens. */
  authorize?: (call: { tool: string; costly: boolean }, ctx: CallContext) => Promise<void>;
  /** Allow capturing private/local URLs (local development against a dev theme). Default false. */
  allowPrivateUrls?: boolean;
  /** Human label for where this server runs, shown in instructions ("local", "Marketing OS hosted"). */
  deployment?: string;
}

/** Per-request context the transport fills in (the authenticated principal, if any). */
export interface CallContext {
  principal?: { kind: "account" | "tenant" | "local"; id: string; scopes?: string[] };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

/** A tool failure the caller should see as a tool result (isError), not a protocol error. */
export class ToolError extends Error {}

const PAGE_TYPES = ["home", "collection", "product", "cart", "landing", "other"] as const;
const pageTypeSchema = z.enum(PAGE_TYPES);
const viewportSchema = z.enum(["desktop", "mobile"]).default("desktop");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function createDesignConversionServer(deps: DesignConversionDeps) {
  const categories = Object.entries(deps.benchmarks.categories)
    .filter(([k]) => k !== ALL_CATEGORIES)
    .map(([k, c]) => `${k} (${c.brands} brands${c.fallback ? `, uses "${c.fallback}"` : ""})`);
  const categoryHelp = `Store category. Known: ${categories.join(", ")}. Anything else uses the cross-category benchmark.`;

  const tools: ToolDef[] = [
    {
      name: "design_vocabulary",
      description:
        "The DTC design-craft vocabulary: named design axes (questions a designer answers on a storefront page), each with its conversion role and the values earned from real storefronts (admitted only after ≥3 distinct brands used them). Filter by axis, stage or page type.",
      costly: false,
      input: z.object({
        axis: z.string().optional(),
        stage: z.enum(CONVERSION_STAGES.map((s) => s.stage) as [string, ...string[]]).optional(),
        pageType: pageTypeSchema.optional(),
        maxValues: z.number().int().positive().max(100).default(12),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          axis: { type: "string", description: "One axis, e.g. buy-box-structure." },
          stage: { type: "string", enum: CONVERSION_STAGES.map((s) => s.stage), description: "Purchase-path stage." },
          pageType: { type: "string", enum: PAGE_TYPES },
          maxValues: { type: "number", description: "Values per axis (default 12, most-used first)." },
        },
      },
      run: (a) => vocabularyView(deps.vocabulary, a, deps.taxonomy),
    },
    {
      name: "design_benchmark",
      description:
        "How the category's DTC brands answer each design axis: the conventions (most-used admitted values, their brand share, and example brands to go and look at), grouped by purchase-path stage. Conventions are prevalence among reputable DTC stores, not measured conversion.",
      costly: false,
      input: z.object({ category: z.string().optional(), pageType: pageTypeSchema.optional(), viewport: z.enum(["desktop", "mobile"]).optional(), axis: z.string().optional(), top: z.number().int().positive().max(20).default(3) }),
      jsonSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: categoryHelp },
          pageType: { type: "string", enum: PAGE_TYPES, description: "Only axes visible on this page type." },
          viewport: { type: "string", enum: ["desktop", "mobile"], description: "Conventions on this viewport only (default: both pooled)." },
          axis: { type: "string" },
          top: { type: "number", description: "Values per axis (default 3)." },
        },
      },
      run: (a) => benchmarkView(deps, a),
    },
    {
      name: "design_suggest_strokes",
      description:
        "Rank the next design moves (strokes) for a page you have already described: pass its treatments per axis (vocabulary names, or your own words: they are resolved to admitted values) and get strokes ordered by conversion stage weight × gap to the category convention, plus strengths and distinctive moves. Deterministic, no model call.",
      costly: false,
      input: z.object({
        category: z.string().optional(),
        pageType: pageTypeSchema,
        viewport: viewportSchema,
        facets: z.record(z.string(), z.string().nullable()),
        limit: z.number().int().positive().max(25).default(8),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: categoryHelp },
          pageType: { type: "string", enum: PAGE_TYPES },
          viewport: { type: "string", enum: ["desktop", "mobile"], description: "Compared with this viewport's pages only (default desktop)." },
          facets: {
            type: "object",
            additionalProperties: { type: ["string", "null"] },
            description: "axis → the treatment the page uses (null = none). Unknown treatments are kept as distinctive moves.",
          },
          limit: { type: "number" },
        },
        required: ["pageType", "facets"],
      },
      run: (a) => suggestView(deps, a),
    },
    {
      name: "design_audit_screenshot",
      description:
        "Audit a storefront screenshot: a vision model labels the page against the vocabulary, then the page is compared with its category's conventions and the next strokes are ranked. Send the full-page screenshot (and optionally the first screen). Spends one vision-model call.",
      costly: true,
      input: z.object({
        image: z.string().min(1),
        foldImage: z.string().optional(),
        url: z.string().url(),
        category: z.string().optional(),
        pageType: pageTypeSchema,
        viewport: viewportSchema,
        limit: z.number().int().positive().max(25).default(8),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Full-page screenshot: base64 PNG/JPEG or a data: URL." },
          foldImage: { type: "string", description: "Optional first-screen screenshot (base64 or data: URL)." },
          url: { type: "string", description: "The page's URL (identifies the brand; not fetched)." },
          category: { type: "string", description: categoryHelp },
          pageType: { type: "string", enum: PAGE_TYPES },
          viewport: { type: "string", enum: ["desktop", "mobile"] },
          limit: { type: "number" },
        },
        required: ["image", "url", "pageType"],
      },
      run: async (a) => {
        const vision = needVision(deps);
        const full = decodeImage(a.image);
        const fold = a.foldImage ? decodeImage(a.foldImage) : undefined;
        return auditImages(
          { url: a.url, category: a.category, pageType: a.pageType, viewport: a.viewport, images: { full: full.data, mime: full.mime, ...(fold ? { fold: fold.data } : {}) } },
          { vision, vocabulary: deps.vocabulary, benchmarks: deps.benchmarks, taxonomy: deps.taxonomy, limit: a.limit },
        );
      },
    },
    {
      name: "design_audit_page",
      description:
        "Audit a live storefront URL end to end: capture it in a browser (first screen + full page), label it against the vocabulary with a vision model, and rank the next strokes against its category. Screenshots stay in memory and are discarded. Spends one vision-model call.",
      costly: true,
      input: z.object({ url: z.string().url(), category: z.string().optional(), pageType: pageTypeSchema, viewport: viewportSchema, limit: z.number().int().positive().max(25).default(8) }),
      jsonSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          category: { type: "string", description: categoryHelp },
          pageType: { type: "string", enum: PAGE_TYPES },
          viewport: { type: "string", enum: ["desktop", "mobile"] },
          limit: { type: "number" },
        },
        required: ["url", "pageType"],
      },
      run: async (a) => {
        const vision = needVision(deps);
        if (!deps.capture) throw new ToolError("This deployment cannot capture pages. Take a screenshot and call design_audit_screenshot instead.");
        if (!deps.allowPrivateUrls) assertPublicUrl(a.url);
        const shot = await deps.capture(a.url, a.viewport);
        return auditImages(
          { url: a.url, category: a.category, pageType: a.pageType, viewport: a.viewport, capturedAt: shot.capturedAt, images: shot },
          { vision, vocabulary: deps.vocabulary, benchmarks: deps.benchmarks, taxonomy: deps.taxonomy, limit: a.limit },
        );
      },
    },
    {
      name: "design_report",
      description: "Vocabulary health: the MVP criteria (recognized axes, admitted values, storefronts, categories), coverage by purchase-path stage, emergence, and how many values have measured outcomes.",
      costly: false,
      input: z.object({}),
      jsonSchema: { type: "object", properties: {} },
      run: async () => {
        if (!deps.labels) throw new ToolError("This deployment was started without label records, so the report is unavailable.");
        return vocabularyReport(deps.vocabulary, deps.labels);
      },
    },
  ];

  const instructions = [
    `Design Conversion MCP (${deps.deployment ?? "local"}): conversion-oriented storefront design decisions, one named move at a time.`,
    "",
    "The vocabulary is extracted from real DTC storefronts: a value is admitted only after ≥3 distinct brands used it. Every axis has a conversion role: a purchase-path stage (attention → orientation → evaluation → confidence → commitment → basket) and a lever.",
    "",
    "How to work:",
    "- To review a page: design_audit_page (a URL, when this server can capture) or design_audit_screenshot (a screenshot you took). Then work the returned strokes top-down.",
    "- If you already know what a page does, describe it in design_suggest_strokes: no model call.",
    "- design_benchmark shows the category's conventions with example brands; design_vocabulary explains an axis and its values.",
    "- The taxonomy is axis (a question) → family (a decision) → value (one named treatment). Conventions are measured on families, so a stroke changes a decision; `to` is the family's most-used treatment in the category.",
    "- A stroke is one move on one axis: `from` → `to`. Implement it inside the brand's own tokens (DESIGN.md, theme settings): the stroke chooses the move, the brand decides how it looks.",
    "",
    "Report evidence honestly:",
    ...STROKE_CAVEATS.map((c) => `- ${c}`),
    "- Say which benchmark a stroke used and how many brands it rests on. Never present a stroke as a guaranteed conversion gain.",
  ].join("\n");

  const resources = [
    { uri: "design://method", name: "Method", mimeType: "text/markdown", description: "What this server knows, how strokes are ranked, and the honesty rules." },
    { uri: "design://lens", name: "Conversion lens", mimeType: "application/json", description: "Stage, lever and conversion question for every axis." },
    { uri: "design://vocabulary", name: "Vocabulary", mimeType: "application/json", description: "Recognized axes and admitted values." },
    { uri: "design://taxonomy", name: "Taxonomy", mimeType: "application/json", description: "Axis → family (decision) → value." },
  ];

  async function callTool(name: string, args: unknown, ctx: CallContext) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) {
      return { content: [{ type: "text", text: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` }], isError: true };
    }
    try {
      await deps.authorize?.({ tool: name, costly: tool.costly }, ctx);
      const out = await tool.run(parsed.data);
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      // Tool and auth failures are results the agent can read and act on; messages never carry secrets.
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  }

  function readResource(uri: string) {
    if (uri === "design://method") return { uri, mimeType: "text/markdown", text: methodDoc(deps) };
    if (uri === "design://lens") return { uri, mimeType: "application/json", text: JSON.stringify({ stages: CONVERSION_STAGES, axes: CONVERSION_LENS }, null, 2) };
    if (uri === "design://vocabulary") return { uri, mimeType: "application/json", text: JSON.stringify(vocabularyView(deps.vocabulary, { maxValues: 100 }, deps.taxonomy), null, 2) };
    if (uri === "design://taxonomy") return deps.taxonomy ? { uri, mimeType: "application/json", text: JSON.stringify(deps.taxonomy, null, 2) } : null;
    const m = /^design:\/\/benchmarks\/([a-z0-9-]+)$/.exec(uri);
    if (m) return { uri, mimeType: "application/json", text: JSON.stringify(benchmarkView(deps, { category: m[1], top: 5 }), null, 2) };
    return null;
  }

  async function handle(msg: JsonRpcRequest, ctx: CallContext = {}): Promise<JsonRpcResponse | null> {
    const id = msg.id ?? null;
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
    // Notifications get no response.
    if (msg.id === undefined) return null;
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return ok({
          protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema, annotations: { readOnlyHint: true, openWorldHint: t.costly } })) });
      case "tools/call":
        return ok(await callTool(msg.params?.name, msg.params?.arguments, ctx));
      case "resources/list":
        return ok({ resources });
      case "resources/templates/list":
        return ok({ resourceTemplates: [{ uriTemplate: "design://benchmarks/{category}", name: "Category benchmark", mimeType: "application/json" }] });
      case "resources/read": {
        const r = readResource(String(msg.params?.uri ?? ""));
        return r ? ok({ contents: [r] }) : fail(-32002, `Resource not found: ${msg.params?.uri}`);
      }
      case "prompts/list":
        return ok({ prompts: [PROMPT] });
      case "prompts/get":
        if (msg.params?.name !== PROMPT.name) return fail(-32602, `Unknown prompt: ${msg.params?.name}`);
        return ok(promptMessages(msg.params?.arguments ?? {}));
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  return { handle, callTool, readResource, tools: tools.map(({ name, description, costly }) => ({ name, description, costly })), instructions };
}

export type DesignConversionServer = ReturnType<typeof createDesignConversionServer>;

interface ToolDef {
  name: string;
  description: string;
  costly: boolean;
  input: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  run: (args: any) => Promise<unknown> | unknown;
}

// ── Views ────────────────────────────────────────────────────────────────────

function axisPages(axis: string): PageType[] {
  return (DTC_SEED_AXES.find((s) => s.axis === axis)?.pages ?? []) as PageType[];
}

function vocabularyView(v: Vocabulary, a: { axis?: string; stage?: string; pageType?: PageType; maxValues?: number }, taxonomy?: Taxonomy) {
  const want = a.axis ? normalizeAxis(a.axis) : null;
  const axes = Object.keys(v.axes)
    .filter((k) => isRecognized(v, k))
    .filter((k) => !want || k === want || v.axes[k]!.aliases?.includes(want))
    .map((k) => {
      const ax = v.axes[k]!;
      const role = conversionRole(k);
      return {
        axis: k,
        question: ax.description ?? null,
        origin: ax.origin,
        brands: ax.axisSupport.length,
        ...(role ? { stage: role.stage, lever: role.lever, conversionQuestion: role.job } : {}),
        pages: axisPages(k),
        ...(ax.aliases?.length ? { aliases: ax.aliases } : {}),
        ...(taxonomy?.axes[k] ? { families: taxonomy.axes[k]!.families.map((f) => ({ family: f.key, label: f.label, decision: f.description, values: f.values.length })) } : {}),
        values: Object.entries(ax.values)
          .filter(([, e]) => e.admitted)
          .sort(([, x], [, y]) => y.support.length - x.support.length)
          .slice(0, a.maxValues ?? 12)
          .map(([value, e]) => ({ value, ...(familyOf(taxonomy, k, value) ? { family: familyOf(taxonomy, k, value)!.key } : {}), ...(e.gloss ? { gloss: e.gloss } : {}), brands: e.support.length })),
      };
    })
    .filter((x) => !a.stage || ("stage" in x && x.stage === a.stage))
    .filter((x) => !a.pageType || !x.pages.length || x.pages.includes(a.pageType))
    .sort((x, y) => x.axis.localeCompare(y.axis));
  if (want && !axes.length) throw new ToolError(`No recognized axis "${want}". Call design_vocabulary with no arguments to list axes.`);
  return { axes, admissionRule: `A value is admitted after ${v.admissionThreshold} distinct brands use it.` };
}

function benchmarkView(deps: DesignConversionDeps, a: { category?: string; pageType?: PageType; viewport?: "desktop" | "mobile"; axis?: string; top?: number }) {
  const { key, benchmark, axes, viewport } = benchmarkFor(deps.benchmarks, a.category, a.viewport);
  const want = a.axis ? normalizeAxis(a.axis) : null;
  const byStage = new Map<string, unknown[]>();
  for (const [axis, b] of Object.entries(axes)) {
    if (want && axis !== want) continue;
    if (a.pageType && !b.pageTypes.includes(a.pageType) && !axisPages(axis).includes(a.pageType)) continue;
    const role = conversionRole(axis);
    const stage = role?.stage ?? "unmapped";
    const list = byStage.get(stage) ?? byStage.set(stage, []).get(stage)!;
    list.push({
      axis,
      ...(role ? { lever: role.lever, conversionQuestion: role.job } : {}),
      brandsAnswering: b.brands,
      ...(b.families ? { decisions: b.families.slice(0, a.top ?? 3).map((f) => ({ family: f.family, label: f.label, brands: f.brands, share: f.share, examples: f.examples, mostUsed: f.values[0]?.value })) } : {}),
      conventions: b.values.slice(0, a.top ?? 3).map((x) => {
        const gloss = deps.vocabulary.axes[axis]?.values[x.value]?.gloss;
        return { ...x, ...(gloss ? { gloss } : {}) };
      }),
    });
  }
  const order = [...CONVERSION_STAGES.map((s) => s.stage), "unmapped"];
  return {
    benchmark: key,
    viewport: viewport ?? "both",
    brands: benchmark.brands,
    ...(a.category && normalizeValue(a.category) !== key ? { note: `"${a.category}" has fewer than ${deps.benchmarks.minBrands} brands in the corpus (or none), so the "${key}" benchmark is shown.` } : {}),
    source: deps.benchmarks.source,
    stages: order.filter((s) => byStage.has(s)).map((stage) => ({ stage, axes: byStage.get(stage) })),
    caveat: STROKE_CAVEATS[0],
  };
}

function suggestView(deps: DesignConversionDeps, a: { category?: string; pageType: PageType; viewport: "desktop" | "mobile"; facets: Record<string, string | null>; limit: number }) {
  const facets: Record<string, string | null> = {};
  const novel: { axis: string; value: string }[] = [];
  const resolved: { given: string; axis: string; value: string }[] = [];
  for (const [axis, value] of Object.entries(a.facets)) {
    if (value == null || value === "") {
      facets[normalizeAxis(axis)] = null;
      continue;
    }
    const r = resolveAdmitted(deps.vocabulary, axis, value);
    if (r) {
      facets[r.axis] = r.value;
      if (r.value !== normalizeValue(value)) resolved.push({ given: value, axis: r.axis, value: r.value });
    } else novel.push({ axis: normalizeAxis(axis), value: normalizeValue(value) });
  }
  const plan = suggestStrokes({ facets, novel, category: a.category, pageType: a.pageType, viewport: a.viewport, benchmarks: deps.benchmarks, vocabulary: deps.vocabulary, ...(deps.taxonomy ? { taxonomy: deps.taxonomy } : {}), limit: a.limit });
  return { ...plan, ...(resolved.length ? { resolved } : {}) };
}

function needVision(deps: DesignConversionDeps): VisionModel {
  if (!deps.vision) {
    throw new ToolError(
      "No vision model is configured, so pages can't be labeled here. Locally: set DESIGN_CONVERSION_API_KEY (and optionally DESIGN_CONVERSION_BASE_URL / DESIGN_CONVERSION_MODEL for any OpenAI-compatible VLM) and restart. Or describe the page yourself and call design_suggest_strokes.",
    );
  }
  return deps.vision;
}

export function decodeImage(s: string): { data: Buffer; mime: "image/png" | "image/jpeg" } {
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,(.*)$/s.exec(s.trim());
  const b64 = (m ? m[2]! : s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new ToolError("image must be base64 (or a data: URL)");
  const data = Buffer.from(b64, "base64");
  if (data.length > MAX_IMAGE_BYTES) throw new ToolError(`image is ${(data.length / 1e6).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1e6} MB`);
  const png = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  if (!png && !jpeg) throw new ToolError("image must be a PNG or JPEG");
  return { data, mime: png ? "image/png" : "image/jpeg" };
}

// ── Prompt + method ──────────────────────────────────────────────────────────

const PROMPT = {
  name: "conversion_design_review",
  description: "Review one storefront page for conversion, stroke by stroke, and implement inside the brand.",
  arguments: [
    { name: "url", description: "The page to review", required: true },
    { name: "category", description: "Store category (apparel, beauty, home, food-bev, …)", required: false },
    { name: "pageType", description: "home | collection | product | cart | landing", required: true },
  ],
};

function promptMessages(args: Record<string, string>) {
  const text = [
    `Review ${args.url ?? "the page"} (${args.pageType ?? "page type unknown"}${args.category ? `, ${args.category}` : ""}) for conversion, one design move at a time.`,
    "",
    "1. Audit it: design_audit_page with the URL (or design_audit_screenshot with a screenshot you take). Do desktop and mobile if both matter.",
    "2. Read the plan: strokes are ranked by purchase-path stage weight × gap to the category convention. Read strengths (keep them) and distinctive moves (likely the brand's edge; do not erase them).",
    "3. Pick at most three strokes. For each, say what changes for the shopper (the axis's conversion question), the evidence (benchmark, brands, share), and the risk.",
    "4. Implement each stroke inside the brand's tokens (DESIGN.md, theme settings). Change one axis per commit so each move can be measured and reverted on its own.",
    "5. Re-audit and confirm the axis moved to the intended value.",
    "",
    "Never call a stroke a proven conversion gain: the ranking is category convention until outcomes are measured.",
  ].join("\n");
  return { description: PROMPT.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

function methodDoc(deps: DesignConversionDeps): string {
  const s = deps.benchmarks.source;
  return [
    "# Design Conversion MCP: method",
    "",
    `Benchmarks: ${s.brands} DTC brands, ${s.labels} labeled pages${s.capturedFrom ? `, captured ${s.capturedFrom} to ${s.capturedTo}` : ""}. Vocabulary ${deps.benchmarks.vocabularyRef}.`,
    "",
    "## Vocabulary",
    "A vision model labels each storefront page as named treatments on design axes. A treatment becomes a vocabulary value only after it recurs across ≥3 distinct brands, and synonyms are folded by a judged merge whose every decision is recorded. Values are the action space: a stroke moves one axis to one admitted value.",
    "",
    "## Conversion lens",
    "Each axis is assigned a purchase-path stage and a lever:",
    ...CONVERSION_STAGES.map((st) => `- **${st.stage}**: ${st.question}`),
    "These assignments and the page-type stage weights are stated hypotheses (see design://lens), to be replaced by weights learned from outcomes.",
    "",
    "## Taxonomy",
    "Admitted values are specific, so each axis's values are grouped into families: the distinct decisions a designer chooses between (a static vs a rotating announcement bar). A model proposes the grouping once per axis; a validator makes every family partition the admitted values exactly, and reviewers can override any placement. Conventions, strengths and strokes are measured on families.",
    "",
    "## Ranking",
    "score = (convention share − the page's current share) × stage weight for the page type × confidence (brands answering / (brands answering + 5)), scaled by measured outcomes when a value has them (offered/chosen through an approval gate).",
    `Categories with fewer than ${deps.benchmarks.minBrands} brands use the cross-category benchmark.`,
    "",
    "## Honesty rules",
    ...STROKE_CAVEATS.map((c) => `- ${c}`),
    "- The dataset ships labels only: no third-party screenshots are stored or redistributed.",
  ].join("\n");
}
