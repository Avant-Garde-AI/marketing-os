// agents/src/mastra/semantics/query/index.ts
//
// Orchestration: runQuery (validate → route to provider → execute → envelope)
// and explainQuery (validate → compiled plan, no execution). The result
// envelope is the second half of the self-refinement loop: every result is
// self-describing (coverage, freshness, timezone, currency, caveats, truncation).

import { getStoreModel } from "../index";
import type { CompiledView, Provider } from "../types";
import { GA4ReconnectRequiredError } from "../../../../lib/ga4";
import { validateQuery } from "./validate";
import { buildGA4Request, runGA4Query } from "./ga4-plan";
import { buildShopifyPlan, runShopifyCommerceQuery } from "./shopify-plan";
import type { ExplainResult, QueryError, QueryInput, ResultEnvelope, ValidatedQuery } from "./types";
import { isQueryError } from "./types";

export * from "./types";

const CONNECT_URL = process.env.MARKETING_OS_API_URL
  ? `${process.env.MARKETING_OS_API_URL.replace(/\/$/, "")}/app/integrations`
  : undefined;

/** Which provider executes this view's query. */
function primaryProvider(view: CompiledView): Provider {
  if (view.requires.includes("shopify") && !view.requires.includes("ga4")) return "shopify";
  if (view.requires.includes("ga4")) return "ga4";
  return view.requires[0];
}

function collectCaveats(vq: ValidatedQuery): string[] {
  const caveats = new Set<string>();
  for (const f of [...vq.measures, ...vq.dimensions]) {
    for (const c of f.caveats ?? []) caveats.add(c);
  }
  return [...caveats];
}

function freshnessFor(view: CompiledView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of view.coverage) {
    out[p] = view.freshness.latencyNote;
  }
  return out;
}

export async function runQuery(input: QueryInput): Promise<ResultEnvelope | QueryError> {
  const model = await getStoreModel();
  const vq = validateQuery(model, input, CONNECT_URL);
  if (isQueryError(vq)) return vq;

  const provider = primaryProvider(vq.view);
  let result;
  try {
    result = provider === "shopify" ? await runShopifyCommerceQuery(vq) : await runGA4Query(vq);
  } catch (err) {
    if (err instanceof GA4ReconnectRequiredError) {
      return {
        error: "RECONNECT_REQUIRED",
        provider: "google",
        message: err.message,
        reconnect_url: err.reconnectUrl ?? CONNECT_URL,
      };
    }
    const status = (err as { status?: number })?.status;
    if (provider === "shopify" && (status === 401 || status === 403)) {
      return {
        error: "RECONNECT_REQUIRED",
        provider: "shopify",
        message:
          "The Shopify access token is invalid or expired. Reopen the Marketing OS app in your Shopify admin to refresh it.",
        reconnect_url: CONNECT_URL,
      };
    }
    return {
      error: "PROVIDER_ERROR",
      provider,
      message: err instanceof Error ? err.message : String(err),
      status,
      hint: "The data provider returned an error. Try a narrower range or retry; if it persists, check the connection in Integrations.",
    };
  }

  const caveats = collectCaveats(vq);
  if (result.truncated) {
    caveats.push(
      provider === "shopify"
        ? "Result truncated at 250 orders; widen the grain or narrow the range for complete totals."
        : "Result truncated; increase limit or add filters to see all rows."
    );
  }

  return {
    data: result.rows,
    meta: {
      view: vq.view.name,
      coverage: vq.view.coverage,
      row_count: result.rowCount,
      truncated: result.truncated,
      time: {
        grain: vq.time.grain,
        range: { start: vq.time.start, end: vq.time.end },
        timezone: vq.time.timezone,
      },
      currency: model.store.currency,
      freshness: freshnessFor(vq.view),
      applied_defaults: vq.appliedDefaults,
      caveats,
    },
  };
}

export async function explainQuery(input: QueryInput): Promise<ExplainResult | QueryError> {
  const model = await getStoreModel();
  const vq = validateQuery(model, input, CONNECT_URL);
  if (isQueryError(vq)) return vq;

  const provider = primaryProvider(vq.view);
  const warnings: string[] = [];
  if (vq.view.coverage.length < vq.view.requires.length && vq.view.partialOk) {
    warnings.push(`Partial coverage: only ${vq.view.coverage.join(", ")} connected.`);
  }
  for (const c of collectCaveats(vq)) warnings.push(c);

  if (provider === "shopify") {
    const plan = buildShopifyPlan(vq);
    return {
      view: vq.view.name,
      provider,
      plan: plan as unknown as Record<string, unknown>,
      estimated_rows: "unknown (depends on order count in range)",
      warnings,
      note: "This plan was validated but NOT executed. Shopify aggregation is client-side; no quota cost to preview.",
    };
  }

  const ga4 = buildGA4Request(vq);
  return {
    view: vq.view.name,
    provider,
    plan: {
      api: "GA4 Data API properties.runReport",
      request: ga4.request,
      output_columns: [...ga4.dimensionCols, ...ga4.metricCols],
    },
    estimated_rows: `≤ ${vq.limit}`,
    warnings,
    note: "This plan was validated but NOT executed — zero GA4 quota cost. Call query with the same input to run it.",
  };
}
