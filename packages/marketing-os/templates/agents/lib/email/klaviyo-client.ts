/**
 * Broker-backed KlaviyoClient (email-campaign WS1-R3).
 *
 * Implements the PACK-OWNED interface (lib/email/types.ts — vendored from
 * packages/skills/email-campaign) against https://a.klaviyo.com/api:
 *
 *  - Credentials arrive per call via the platform broker
 *    (getBrokerToken("klaviyo", "email") — cached with a TTL safety margin).
 *    Auth header follows the broker's token_type: private keys use
 *    `Authorization: Klaviyo-API-Key <key>`, OAuth uses `Bearer <token>`.
 *  - `revision: 2026-07-15` pinned on every request (03 §2).
 *  - Full JSON:API handling: one private request() core + a cursor-pagination
 *    helper (`page[cursor]` via links.next) used by every list method.
 *  - Rate discipline (03 §9): honor Retry-After on 429 (+ full jitter),
 *    exponential backoff with full jitter on 5xx, max 3 retries; an
 *    in-process per-tenant concurrency gate (4 simultaneous requests) so one
 *    tenant can't starve the others in the pooled runtime.
 *  - NEVER logs tokens; errors surface Klaviyo's JSON:API `errors` details
 *    plus HTTP status.
 *
 * The pack never sees a credential; tests inject `fetchImpl` +
 * `getCredentials` fakes through KlaviyoClientOptions.
 */

import { getBrokerToken } from "../broker-client";
import { getTenant } from "../tenant-context";
import type {
  CampaignValuesQuery,
  CampaignValuesRow,
  CreateCampaignInput,
  KlaviyoAudience,
  KlaviyoClient,
  KlaviyoMetric,
  KlaviyoTemplate,
  KlaviyoTemplateSummary,
  KlaviyoUniversalContentBlock,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pinned API revision (03 §2) — revisit on Klaviyo's ~2-year revision clock. */
export const KLAVIYO_REVISION = "2026-07-15";

export const KLAVIYO_BASE_URL = "https://a.klaviyo.com/api";

/**
 * Method → endpoint map, centralized.
 *
 * NOTE (03 §12.2): per-endpoint rate-limit tiers AND several exact paths /
 * payload shapes below were NOT captured by the platform research (overview
 * pages omit them; Reporting has historically been low-tier). Re-verify each
 * against the live Klaviyo reference during the Arthaus smoke
 * (scripts/verify-klaviyo.ts) and encode per-endpoint budgets here if the
 * shared gate proves too coarse. Paths flagged "VERIFY" are the ones 03 was
 * thin on.
 */
const EP = {
  accounts: "/accounts",
  lists: "/lists",
  segments: "/segments",
  templates: "/templates",
  template: (id: string) => `/templates/${encodeURIComponent(id)}`,
  /** VERIFY: 03 §3 says POST /templates/{id}/render; current reference may
   * route this as POST /template-render with the id in the body. */
  templateRender: (id: string) => `/templates/${encodeURIComponent(id)}/render`,
  /** VERIFY: 03 §3 calls it `/universal-content`; the live API names the
   * resource `template-universal-content`. OAuth-app-gated either way — the
   * client degrades 403/404 to []. */
  universalContent: "/template-universal-content",
  metrics: "/metrics",
  campaignValuesReports: "/campaign-values-reports",
  campaigns: "/campaigns",
  campaign: (id: string) => `/campaigns/${encodeURIComponent(id)}`,
  assignTemplate: "/campaign-message-assign-template",
  sendJobs: "/campaign-send-jobs",
  sendJob: (id: string) => `/campaign-send-jobs/${encodeURIComponent(id)}`,
  recipientEstimationJobs: "/campaign-recipient-estimation-jobs",
  recipientEstimationJob: (id: string) =>
    `/campaign-recipient-estimation-jobs/${encodeURIComponent(id)}`,
  recipientEstimation: (id: string) =>
    `/campaign-recipient-estimations/${encodeURIComponent(id)}`,
  imageUpload: "/image-upload",
} as const;

/** Statistics requested from campaign-values-reports (03 §8), mapped 1:1 to
 * the pack's CampaignValuesRow fields below. */
const REPORT_STATISTICS = [
  "delivered",
  "bounced",
  "delivery_rate",
  "opens",
  "opens_unique",
  "open_rate",
  "clicks",
  "clicks_unique",
  "click_rate",
  "click_to_open_rate",
  "unsubscribes",
  "unsubscribe_rate",
  "spam_complaints",
  "conversions",
  "conversion_uniques",
  "conversion_value",
  "revenue_per_recipient",
  "average_order_value",
] as const;

/** statistic key → CampaignValuesRow field. */
const STAT_TO_ROW: Record<(typeof REPORT_STATISTICS)[number], keyof CampaignValuesRow> = {
  delivered: "delivered",
  bounced: "bounced",
  delivery_rate: "deliveryRate",
  opens: "opens",
  opens_unique: "opensUnique",
  open_rate: "openRate",
  clicks: "clicks",
  clicks_unique: "clicksUnique",
  click_rate: "clickRate",
  click_to_open_rate: "clickToOpenRate",
  unsubscribes: "unsubscribes",
  unsubscribe_rate: "unsubscribeRate",
  spam_complaints: "spamComplaints",
  conversions: "conversions",
  conversion_uniques: "conversionUniques",
  conversion_value: "conversionValue",
  revenue_per_recipient: "revenuePerRecipient",
  average_order_value: "averageOrderValue",
};

/** Images API constraints (03 §5) — enforced client-side before any bytes move. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

/** Reporting timeframe hard limit (03 §8) — rejected client-side. */
const MAX_TIMEFRAME_MS = 366 * 24 * 60 * 60 * 1000;

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;
/** Per-tenant in-process concurrency cap (03 §9 fairness in the pooled runtime). */
const TENANT_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface KlaviyoJsonApiError {
  id?: string;
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
}

/** Carries Klaviyo's JSON:API error details + HTTP status. Never the token. */
export class KlaviyoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors: KlaviyoJsonApiError[] = []
  ) {
    super(message);
    this.name = "KlaviyoApiError";
  }
}

// ---------------------------------------------------------------------------
// Credentials (broker seam)
// ---------------------------------------------------------------------------

export type KlaviyoTokenType = "klaviyo-api-key" | "bearer";

export interface KlaviyoCredentials {
  token: string;
  tokenType: KlaviyoTokenType;
}

/** Infer the auth scheme when the broker context omits token_type. */
export function inferTokenType(token: string, contextTokenType?: unknown): KlaviyoTokenType {
  if (contextTokenType === "klaviyo-api-key" || contextTokenType === "bearer") {
    return contextTokenType;
  }
  return token.startsWith("pk_") ? "klaviyo-api-key" : "bearer";
}

async function brokerCredentials(): Promise<KlaviyoCredentials> {
  const tok = await getBrokerToken("klaviyo", "email");
  return {
    token: tok.accessToken,
    tokenType: inferTokenType(tok.accessToken, tok.context["token_type"]),
  };
}

function authHeader(creds: KlaviyoCredentials): string {
  return creds.tokenType === "klaviyo-api-key"
    ? `Klaviyo-API-Key ${creds.token}`
    : `Bearer ${creds.token}`;
}

// ---------------------------------------------------------------------------
// Per-tenant concurrency gate — a plain promise-queue semaphore. Slots are
// held only for the duration of a fetch (never across retry sleeps), so a
// tenant hammering Klaviyo queues behind itself instead of starving others.
// ---------------------------------------------------------------------------

class TenantGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    // The releasing call transferred its slot; `active` stays constant.
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

const tenantGates = new Map<string, TenantGate>();

function gateFor(tenantKey: string): TenantGate {
  let gate = tenantGates.get(tenantKey);
  if (!gate) {
    gate = new TenantGate(TENANT_CONCURRENCY);
    tenantGates.set(tenantKey, gate);
  }
  return gate;
}

// ---------------------------------------------------------------------------
// JSON:API shapes (the slice we consume)
// ---------------------------------------------------------------------------

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | Array<{ type: string; id: string }> | null }>;
}

interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  links?: { next?: string | null };
  errors?: KlaviyoJsonApiError[];
}

function asArray(data: JsonApiDocument["data"]): JsonApiResource[] {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

function asOne(doc: JsonApiDocument, what: string): JsonApiResource {
  const d = doc.data;
  if (!d || Array.isArray(d)) throw new KlaviyoApiError(`Klaviyo response missing ${what}`, 0);
  return d;
}

function attr<T>(res: JsonApiResource | undefined, key: string): T | undefined {
  return res?.attributes?.[key] as T | undefined;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface KlaviyoClientOptions {
  /** Fetch seam for tests (recorded fixtures) — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Credential seam — defaults to broker-issued per-tenant credentials. */
  getCredentials?: () => Promise<KlaviyoCredentials>;
  /** Concurrency-gate key — defaults to the resolved tenant's shop. */
  tenantKey?: () => string;
  /** Recipient-estimation polling knobs (bounded; tests shrink them). */
  pollIntervalMs?: number;
  maxPolls?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter: uniform over [0, min(cap, base * 2^attempt)). */
function backoffDelay(attempt: number): number {
  return Math.random() * Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("Retry-After");
  if (h === null) return null;
  const secs = Number(h);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

interface RequestOptions {
  method?: string;
  /** Path relative to KLAVIYO_BASE_URL … */
  path?: string;
  /** … or an absolute URL (pagination links.next). */
  url?: string;
  query?: Record<string, string>;
  body?: unknown;
  form?: FormData;
}

export function createKlaviyoClient(options: KlaviyoClientOptions = {}): KlaviyoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getCredentials = options.getCredentials ?? brokerCredentials;
  const tenantKey =
    options.tenantKey ?? (() => getTenant().shop || getTenant().storeSlug || "default");
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxPolls = options.maxPolls ?? 20;

  // -- request core ---------------------------------------------------------

  async function request(opts: RequestOptions): Promise<JsonApiDocument> {
    const method = opts.method ?? "GET";
    let url: string;
    if (opts.url) {
      url = opts.url;
    } else {
      const u = new URL(`${KLAVIYO_BASE_URL}${opts.path ?? "/"}`);
      for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);
      url = u.toString();
    }

    const creds = await getCredentials();
    const headers: Record<string, string> = {
      Authorization: authHeader(creds),
      revision: KLAVIYO_REVISION,
      accept: "application/vnd.api+json",
    };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form; // fetch sets the multipart boundary
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/vnd.api+json";
      body = JSON.stringify(opts.body);
    }

    const gate = gateFor(tenantKey());

    for (let attempt = 0; ; attempt++) {
      await gate.acquire();
      let res: Response;
      try {
        res = await fetchImpl(url, { method, headers, body });
      } finally {
        gate.release(); // never hold a slot across a retry sleep
      }

      if (res.ok) {
        const text = await res.text();
        if (!text) return {};
        try {
          return JSON.parse(text) as JsonApiDocument;
        } catch {
          throw new KlaviyoApiError(
            `Klaviyo returned non-JSON body (${res.status}) on ${method} ${opts.path ?? url}`,
            res.status
          );
        }
      }

      const retryable429 = res.status === 429;
      const retryable5xx = res.status >= 500 && res.status <= 599;
      if ((retryable429 || retryable5xx) && attempt < MAX_RETRIES) {
        const ra = retryable429 ? retryAfterMs(res) : null;
        // Honor Retry-After when present; add full jitter either way so a
        // synchronized burst doesn't re-collide on the same window edge.
        const delay = ra !== null ? ra + Math.random() * 250 : backoffDelay(attempt);
        await sleep(delay);
        continue;
      }

      // Terminal: surface Klaviyo's JSON:API error details + status.
      let errors: KlaviyoJsonApiError[] = [];
      try {
        const parsed = (await res.json()) as JsonApiDocument;
        errors = parsed.errors ?? [];
      } catch {
        // non-JSON error body — status alone will have to do
      }
      const detail =
        errors.map((e) => e.detail ?? e.title ?? e.code).filter(Boolean).join("; ") ||
        res.statusText ||
        "no error detail";
      throw new KlaviyoApiError(
        `Klaviyo API ${res.status} on ${method} ${opts.path ?? url}: ${detail}`,
        res.status,
        errors
      );
    }
  }

  /** Cursor pagination: collect data[] across pages by following links.next
   * (which carries the `page[cursor]` param). */
  async function listAll(path: string, query?: Record<string, string>): Promise<JsonApiResource[]> {
    const out: JsonApiResource[] = [];
    let doc = await request({ path, query });
    for (;;) {
      out.push(...asArray(doc.data));
      const next = doc.links?.next;
      if (!next) return out;
      doc = await request({ url: next });
    }
  }

  // -- interface implementation ---------------------------------------------

  const client: KlaviyoClient = {
    // ---- Reads ----

    async listAudiences(): Promise<KlaviyoAudience[]> {
      // LIVE-VERIFIED 2026-07-17 (Arthaus, revision 2026-07-15):
      // `additional-fields=profile_count` is REJECTED on the collection
      // endpoints ("additional-fields must be in []") — counts are only
      // served on single-resource GETs. So: list the collections plain, then
      // fetch counts per audience (03 §6's stricter-rate-limit surface; the
      // per-tenant gate + audience-selection frequency keep this cheap).
      const [lists, segments] = await Promise.all([
        listAll(EP.lists),
        listAll(EP.segments),
      ]);
      const withCount = async (type: "list" | "segment", r: JsonApiResource): Promise<KlaviyoAudience> => {
        const base: KlaviyoAudience = { type, id: r.id, name: attr<string>(r, "name") ?? r.id };
        try {
          const single = await request({
            path: `${type === "list" ? EP.lists : EP.segments}/${r.id}`,
            query: { [`additional-fields[${type}]`]: "profile_count" },
          });
          const one = (single.data as JsonApiResource | JsonApiResource[] | null);
          const res = Array.isArray(one) ? one[0] : one;
          const count = res ? attr<number>(res, "profile_count") : undefined;
          return typeof count === "number" ? { ...base, profileCount: count } : base;
        } catch {
          return base; // counts are advisory; the audience itself matters
        }
      };
      return Promise.all([
        ...lists.map((r) => withCount("list", r)),
        ...segments.map((r) => withCount("segment", r)),
      ]);
    },

    async listTemplates(): Promise<KlaviyoTemplateSummary[]> {
      const rows = await listAll(EP.templates);
      return rows.map((r) => ({
        id: r.id,
        name: attr<string>(r, "name") ?? r.id,
        editorType: attr<string>(r, "editor_type") ?? "UNKNOWN",
        ...(attr<string>(r, "updated") ? { updated: attr<string>(r, "updated") } : {}),
      }));
    },

    async getTemplate(id: string): Promise<KlaviyoTemplate> {
      // Content (html/text) is included on the single GET (03 §3).
      const doc = await request({ path: EP.template(id) });
      const r = asOne(doc, `template ${id}`);
      return {
        id: r.id,
        name: attr<string>(r, "name") ?? r.id,
        editorType: attr<string>(r, "editor_type") ?? "UNKNOWN",
        ...(attr<string>(r, "updated") ? { updated: attr<string>(r, "updated") } : {}),
        ...(attr<string>(r, "html") !== undefined ? { html: attr<string>(r, "html") } : {}),
        ...(attr<string>(r, "text") !== undefined ? { text: attr<string>(r, "text") } : {}),
      };
    },

    async listUniversalContent(): Promise<KlaviyoUniversalContentBlock[]> {
      // OAuth-app-gated (03 §3) — private-key tenants get 403 (or 404); that
      // is a normal condition, not an error: degrade to [].
      let rows: JsonApiResource[];
      try {
        rows = await listAll(EP.universalContent);
      } catch (e) {
        if (e instanceof KlaviyoApiError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
      return rows.map((r) => {
        const definition = attr<{ data?: { content?: string } }>(r, "definition");
        const html = definition?.data?.content ?? attr<string>(r, "html");
        return {
          id: r.id,
          name: attr<string>(r, "name") ?? r.id,
          ...(html !== undefined ? { html } : {}),
        };
      });
    },

    async listMetrics(): Promise<KlaviyoMetric[]> {
      const rows = await listAll(EP.metrics);
      return rows.map((r) => {
        const integration = attr<{ name?: string }>(r, "integration");
        return {
          id: r.id,
          name: attr<string>(r, "name") ?? r.id,
          ...(integration?.name ? { integration: integration.name } : {}),
        };
      });
    },

    async campaignValuesReport(query: CampaignValuesQuery): Promise<CampaignValuesRow[]> {
      const start = Date.parse(query.timeframe.start);
      const end = Date.parse(query.timeframe.end);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new Error("campaignValuesReport: timeframe.end must be after timeframe.start");
      }
      if (end - start > MAX_TIMEFRAME_MS) {
        throw new Error(
          "campaignValuesReport: timeframe exceeds Klaviyo's 1-year reporting limit — split the query"
        );
      }
      const attributes: Record<string, unknown> = {
        timeframe: { start: query.timeframe.start, end: query.timeframe.end },
        conversion_metric_id: query.conversionMetricId,
        statistics: [...REPORT_STATISTICS],
      };
      if (query.campaignIds?.length) {
        // List filters accept ≤100 items, AND-only (03 §8).
        if (query.campaignIds.length > 100) {
          throw new Error("campaignValuesReport: at most 100 campaign ids per report (API limit)");
        }
        const ids = query.campaignIds.map((id) => `"${id}"`).join(",");
        attributes["filter"] = `any(campaign_id,[${ids}])`;
      }
      const doc = await request({
        method: "POST",
        path: EP.campaignValuesReports,
        body: { data: { type: "campaign-values-report", attributes } },
      });
      const results =
        attr<Array<{ groupings?: Record<string, unknown>; statistics?: Record<string, unknown> }>>(
          asOne(doc, "campaign-values-report"),
          "results"
        ) ?? [];
      return results.map((res) => {
        const row: CampaignValuesRow = {
          campaignId: String(res.groupings?.["campaign_id"] ?? ""),
        };
        for (const stat of REPORT_STATISTICS) {
          const v = res.statistics?.[stat];
          if (typeof v === "number") {
            (row as unknown as Record<string, unknown>)[STAT_TO_ROW[stat]] = v;
          }
        }
        return row;
      });
    },

    async estimateRecipients(campaignId: string): Promise<{ estimatedCount: number }> {
      // Create the estimation job (409 = already running → just poll).
      try {
        await request({
          method: "POST",
          path: EP.recipientEstimationJobs,
          body: { data: { type: "campaign-recipient-estimation-job", id: campaignId } },
        });
      } catch (e) {
        if (!(e instanceof KlaviyoApiError && e.status === 409)) throw e;
      }
      // Bounded poll until the job completes.
      for (let i = 0; i < maxPolls; i++) {
        const jobDoc = await request({ path: EP.recipientEstimationJob(campaignId) });
        const status = attr<string>(asOne(jobDoc, "estimation job"), "status");
        if (status === "complete") {
          const estDoc = await request({ path: EP.recipientEstimation(campaignId) });
          const count = attr<number>(asOne(estDoc, "estimation"), "estimated_recipient_count");
          return { estimatedCount: typeof count === "number" ? count : 0 };
        }
        if (status === "cancelled" || status === "failed") {
          throw new KlaviyoApiError(
            `Klaviyo recipient estimation for campaign ${campaignId} ended ${status}`,
            0
          );
        }
        await sleep(pollIntervalMs);
      }
      throw new KlaviyoApiError(
        `Klaviyo recipient estimation for campaign ${campaignId} did not complete within ${maxPolls} polls`,
        0
      );
    },

    async getSendJob(campaignId: string): Promise<{ status: string }> {
      const doc = await request({ path: EP.sendJob(campaignId) });
      return { status: attr<string>(asOne(doc, "send job"), "status") ?? "unknown" };
    },

    async getCampaignStatus(campaignId: string): Promise<{ status: string; scheduledAt?: string }> {
      const doc = await request({ path: EP.campaign(campaignId) });
      const r = asOne(doc, `campaign ${campaignId}`);
      const scheduledAt = attr<string>(r, "scheduled_at") ?? attr<string>(r, "send_time");
      return {
        status: attr<string>(r, "status") ?? "unknown",
        ...(scheduledAt ? { scheduledAt } : {}),
      };
    },

    async renderTemplate(
      id: string,
      context?: Record<string, unknown>
    ): Promise<{ html: string; text?: string }> {
      const doc = await request({
        method: "POST",
        path: EP.templateRender(id),
        body: { data: { type: "template", id, attributes: { context: context ?? {} } } },
      });
      const r = asOne(doc, `rendered template ${id}`);
      const text = attr<string>(r, "text");
      return { html: attr<string>(r, "html") ?? "", ...(text !== undefined ? { text } : {}) };
    },

    // ---- Writes (called ONLY from Action execute() paths, spec 20) ----

    async createTemplate(input: { name: string; html: string }): Promise<{ id: string }> {
      const doc = await request({
        method: "POST",
        path: EP.templates,
        body: {
          data: {
            type: "template",
            attributes: { name: input.name, editor_type: "CODE", html: input.html },
          },
        },
      });
      return { id: asOne(doc, "created template").id };
    },

    async updateTemplate(id: string, input: { html: string; name?: string }): Promise<void> {
      await request({
        method: "PATCH",
        path: EP.template(id),
        body: {
          data: {
            type: "template",
            id,
            attributes: { html: input.html, ...(input.name ? { name: input.name } : {}) },
          },
        },
      });
    },

    async createCampaign(
      input: CreateCampaignInput
    ): Promise<{ campaignId: string; messageId: string }> {
      const content: Record<string, unknown> = { subject: input.subject };
      if (input.previewText !== undefined) content["preview_text"] = input.previewText;
      if (input.fromEmail !== undefined) content["from_email"] = input.fromEmail;
      if (input.fromLabel !== undefined) content["from_label"] = input.fromLabel;

      const trackingOptions: Record<string, unknown> = { is_add_utm: true };
      if (input.utmParams?.length) trackingOptions["utm_params"] = input.utmParams;

      const doc = await request({
        method: "POST",
        path: EP.campaigns,
        body: {
          data: {
            type: "campaign",
            attributes: {
              name: input.name,
              audiences: {
                included: input.audiences.included,
                excluded: input.audiences.excluded ?? [],
              },
              send_options: { use_smart_sending: input.useSmartSending ?? true },
              tracking_options: trackingOptions,
              "campaign-messages": {
                data: [
                  {
                    type: "campaign-message",
                    attributes: {
                      definition: { channel: "email", label: input.name, content },
                    },
                  },
                ],
              },
            },
          },
        },
      });

      const campaign = asOne(doc, "created campaign");
      // Message id: prefer `included`, fall back to the relationship linkage.
      let messageId = doc.included?.find((r) => r.type === "campaign-message")?.id;
      if (!messageId) {
        const rel = campaign.relationships?.["campaign-messages"]?.data;
        messageId = Array.isArray(rel) ? rel[0]?.id : rel?.id;
      }
      if (!messageId) {
        throw new KlaviyoApiError(
          `Klaviyo campaign ${campaign.id} created but no campaign-message id was returned`,
          0
        );
      }
      return { campaignId: campaign.id, messageId };
    },

    async assignTemplate(messageId: string, templateId: string): Promise<void> {
      // Separate assign endpoint (03 §4) — a campaign cannot be scheduled
      // without a template assigned.
      await request({
        method: "POST",
        path: EP.assignTemplate,
        body: {
          data: {
            type: "campaign-message",
            id: messageId,
            relationships: { template: { data: { type: "template", id: templateId } } },
          },
        },
      });
    },

    async updateCampaignSendStrategy(
      campaignId: string,
      strategy: { datetime: string }
    ): Promise<void> {
      await request({
        method: "PATCH",
        path: EP.campaign(campaignId),
        body: {
          data: {
            type: "campaign",
            id: campaignId,
            attributes: {
              send_strategy: { method: "static", datetime: strategy.datetime },
            },
          },
        },
      });
    },

    async createSendJob(campaignId: string): Promise<{ status: string }> {
      const doc = await request({
        method: "POST",
        path: EP.sendJobs,
        body: { data: { type: "campaign-send-job", id: campaignId } },
      });
      const status = doc.data && !Array.isArray(doc.data) ? attr<string>(doc.data, "status") : undefined;
      return { status: status ?? "queued" };
    },

    async cancelSendJob(campaignId: string, opts?: { revertToDraft?: boolean }): Promise<void> {
      await request({
        method: "PATCH",
        path: EP.sendJob(campaignId),
        body: {
          data: {
            type: "campaign-send-job",
            id: campaignId,
            attributes: { action: opts?.revertToDraft ? "revert" : "cancel" },
          },
        },
      });
    },

    async uploadImage(input: {
      name: string;
      data: Uint8Array;
      mediaType: string;
    }): Promise<{ id: string; imageUrl: string }> {
      // Client-side guards (03 §5): ≤5 MB; jpeg/png/gif only (no webp/svg).
      if (!IMAGE_MEDIA_TYPES.has(input.mediaType)) {
        throw new Error(
          `uploadImage: unsupported media type "${input.mediaType}" — Klaviyo accepts image/jpeg, image/png, image/gif (03 §5)`
        );
      }
      if (input.data.byteLength > IMAGE_MAX_BYTES) {
        throw new Error(
          `uploadImage: "${input.name}" is ${input.data.byteLength} bytes — Klaviyo's limit is 5 MB (03 §5); re-export smaller`
        );
      }
      const form = new FormData();
      form.append(
        "file",
        new Blob([input.data as unknown as BlobPart], { type: input.mediaType }),
        input.name
      );
      form.append("name", input.name);
      const doc = await request({ method: "POST", path: EP.imageUpload, form });
      const r = asOne(doc, "uploaded image");
      const imageUrl = attr<string>(r, "image_url") ?? attr<string>(r, "url");
      if (!imageUrl) {
        throw new KlaviyoApiError(`Klaviyo image upload for "${input.name}" returned no image_url`, 0);
      }
      return { id: r.id, imageUrl };
    },
  };

  return client;
}
