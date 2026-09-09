// agents/src/mastra/semantics/query/klaviyo-plan.ts
//
// The email_performance planner.
//
// Unlike the GA4 and Shopify planners, this one does not call a vendor API at
// query time. Klaviyo's campaign-values endpoint answers about campaigns you
// name, not about "the last 90 days of email", and it is rate-limited enough
// that a per-question fan-out would be slow and quota-hostile. So the email
// cron reads each campaign's numbers ONCE after send (`/api/cron/email` step 3,
// after a maturation window) and stores them on `mos_email_campaigns.readback`.
// This planner reads that table.
//
// The consequence to be honest about: these numbers are a snapshot taken at
// readback, not live. A campaign sent an hour ago has no row yet. That is
// stated in the view's freshness note and repeated as a caveat rather than
// left for someone to infer from a suspiciously round zero.
//
// ## Rates are recomputed, never averaged
//
// Every rate here is `sum(numerator) / sum(denominator)` across the matching
// campaigns — not the mean of the per-campaign rates. Those two disagree
// whenever campaigns differ in size, and they disagree in the direction that
// flatters small sends: a 200-recipient test at 40% and a 3,400-recipient
// broadcast at 8% average to 24%, while the true pooled rate is 9.8%. The
// stored row keeps Klaviyo's own per-campaign rate for single-campaign reads,
// but any aggregate is rebuilt from the counts.

import { Pool } from "pg";
import { getTenant } from "../../../../lib/tenant-context";
import type { ProviderResult } from "./ga4-plan";
import type { ValidatedQuery } from "./types";

let _pool: Pool | null = null;
function pool(): Pool {
  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) throw new Error("email_performance needs SUPABASE_DATABASE_URL or DATABASE_URL");
  if (!_pool) _pool = new Pool({ connectionString: cs, max: 3 });
  return _pool;
}

/** A readback field, and how it aggregates. Counts sum; rates are rebuilt. */
const COUNT_SQL: Record<string, string> = {
  // `recipients` is not a field Klaviyo returns — delivered + bounced is the
  // number the send actually attempted, and it reconciles exactly against
  // Klaviyo's own recipient count.
  recipients: "COALESCE((readback->>'delivered')::numeric,0) + COALESCE((readback->>'bounced')::numeric,0)",
  delivered: "COALESCE((readback->>'delivered')::numeric,0)",
  bounced: "COALESCE((readback->>'bounced')::numeric,0)",
  opens_unique: "COALESCE((readback->>'opensUnique')::numeric,0)",
  clicks_unique: "COALESCE((readback->>'clicksUnique')::numeric,0)",
  unsubscribes: "COALESCE((readback->>'unsubscribes')::numeric,0)",
  spam_complaints: "COALESCE((readback->>'spamComplaints')::numeric,0)",
  conversions: "COALESCE((readback->>'conversions')::numeric,0)",
  conversion_value: "COALESCE((readback->>'conversionValue')::numeric,0)",
};

/** rate name -> [numerator, denominator] in COUNT_SQL terms. */
const RATE_PARTS: Record<string, [string, string]> = {
  delivery_rate: ["delivered", "recipients"],
  open_rate: ["opens_unique", "delivered"],
  click_rate: ["clicks_unique", "delivered"],
  click_to_open_rate: ["clicks_unique", "opens_unique"],
  unsubscribe_rate: ["unsubscribes", "delivered"],
  bounce_rate: ["bounced", "recipients"],
  conversion_rate: ["conversions", "delivered"],
  revenue_per_recipient: ["conversion_value", "recipients"],
};

const DIMENSION_SQL: Record<string, string> = {
  date: "to_char(sent_at, 'YYYY-MM-DD')",
  month: "to_char(sent_at, 'YYYY-MM')",
  campaign: "subject",
  campaign_id: "id",
  archetype: "archetype",
  status: "status",
};

export interface EmailPlan {
  sql: string;
  params: unknown[];
  groupBy: string[];
  select: string[];
}

export function buildEmailPlan(vq: ValidatedQuery): EmailPlan {
  const dims = vq.dimensions.map((d) => d.name).filter((n) => n in DIMENSION_SQL);
  const measures = vq.measures.map((m) => m.name);

  const selectParts: string[] = [];
  const groupBy: string[] = [];
  for (const d of dims) {
    selectParts.push(`${DIMENSION_SQL[d]} AS "${d}"`);
    groupBy.push(DIMENSION_SQL[d]);
  }

  // Whatever a rate needs, aggregate underneath it — the numerator and
  // denominator are summed first and divided once.
  for (const m of measures) {
    if (m === "campaigns") {
      selectParts.push(`COUNT(*)::numeric AS "campaigns"`);
    } else if (m in COUNT_SQL) {
      selectParts.push(`SUM(${COUNT_SQL[m]}) AS "${m}"`);
    } else if (m in RATE_PARTS) {
      const [num, den] = RATE_PARTS[m];
      // NULLIF keeps a zero denominator out of the result rather than turning
      // "nobody was sent this" into a division error or a fake 0%.
      selectParts.push(
        `CASE WHEN SUM(${COUNT_SQL[den]}) > 0 ` +
          `THEN SUM(${COUNT_SQL[num]}) / SUM(${COUNT_SQL[den]}) ELSE NULL END AS "${m}"`,
      );
    }
  }
  if (selectParts.length === 0) selectParts.push(`COUNT(*)::numeric AS "campaigns"`);

  const params: unknown[] = [getTenant().shop, vq.time.start, vq.time.end];
  const where = [
    // Tenant scoping is not optional in a pooled runtime — one missing
    // predicate here leaks another store's send performance.
    "tenant_id = $1",
    "readback IS NOT NULL",
    "sent_at IS NOT NULL",
    "sent_at >= $2::date",
    "sent_at < ($3::date + interval '1 day')",
  ];

  for (const f of vq.filters) {
    const col = DIMENSION_SQL[f.field.name];
    if (!col) continue;
    if (f.op === "eq" || f.op === "neq") {
      params.push(String(f.value));
      where.push(`${col} ${f.op === "eq" ? "=" : "<>"} $${params.length}`);
    } else if (f.op === "in" && Array.isArray(f.value)) {
      params.push(f.value.map(String));
      where.push(`${col} = ANY($${params.length})`);
    } else if (f.op === "contains") {
      params.push(`%${String(f.value)}%`);
      where.push(`${col} ILIKE $${params.length}`);
    }
  }

  const order = vq.order
    .map((o) => `"${o.name}" ${o.dir === "desc" ? "DESC" : "ASC"}`)
    .join(", ");

  const sql =
    `SELECT ${selectParts.join(", ")} FROM mos_email_campaigns ` +
    `WHERE ${where.join(" AND ")}` +
    (groupBy.length ? ` GROUP BY ${groupBy.join(", ")}` : "") +
    (order ? ` ORDER BY ${order}` : groupBy.length ? ` ORDER BY 1 ASC` : "") +
    ` LIMIT ${vq.limit + 1} OFFSET ${vq.offset}`;

  return { sql, params, groupBy, select: selectParts };
}

export async function runEmailQuery(vq: ValidatedQuery): Promise<ProviderResult> {
  const plan = buildEmailPlan(vq);
  const res = await pool().query(plan.sql, plan.params);
  const truncated = res.rows.length > vq.limit;
  const rows = (truncated ? res.rows.slice(0, vq.limit) : res.rows).map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      // pg returns numerics as strings to protect precision; these are counts
      // and rates well inside float range, and a string here would silently
      // break every chart and comparison downstream.
      out[k] = typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
    return out;
  });
  return { rows, rowCount: rows.length, truncated };
}
