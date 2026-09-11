/**
 * A campaign, measured against this store's own history.
 *
 * ## Why a shared module rather than logic in each surface
 *
 * Two things want to answer "how did this email do": the campaign page, and the
 * agent when someone asks it to look back at a send. If each computed its own
 * comparison they would drift, and the page would win every disagreement by
 * looking authoritative. So the arithmetic lives here once and both read it.
 *
 * ## A rate alone is not a finding
 *
 * "13.4% opens" is not analysis; it is a number with nowhere to stand. The only
 * honest comparison available is the store's OWN other sends — industry
 * benchmarks are gathered from different lists, different senders and different
 * definitions of an open, and pasting one in would manufacture a verdict rather
 * than support one. So every figure here is expressed against a baseline pooled
 * from this store's other measured campaigns, and the campaign under review is
 * excluded from its own baseline.
 *
 * ## Refusing to over-read
 *
 * With a handful of sends, a baseline is a hint, not evidence. Two campaigns
 * differing by three points of open rate is well inside the noise of who
 * happened to be in each audience. This module reports the size of the baseline
 * and says plainly when it is too thin to carry an argument, because the
 * failure mode is not a wrong number — it is a confident story told from four
 * data points, which is exactly what a language model will produce if handed
 * bare figures and asked what they mean.
 */

import { safeQuery, tenantIdForShop } from "../platform-db";
import { getTenant } from "../tenant-context";

/**
 * The slice of an index row a retrospective needs. Declared here rather than
 * imported from the console's data layer so this module — and the agent tool
 * built on it — works in the pooled runtime too, which ships no console UI.
 */
export interface CampaignRow {
  id: string;
  subject: string | null;
  archetype: string;
  status: string;
  sentAt: string | null;
  scheduledAt: string | null;
  readback: Record<string, unknown> | null;
}

export interface Measured {
  delivered: number;
  recipients: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  bounced: number;
  revenue: number;
  openRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
  unsubRate: number | null;
}

export interface Retrospective {
  id: string;
  subject: string | null;
  archetype: string | null;
  sentAt: string | null;
  /** This campaign's own numbers. Null when it has not been measured yet. */
  performance: Measured | null;
  /** Pooled across the store's OTHER measured campaigns. */
  baseline: (Measured & { campaigns: number }) | null;
  /** Multiplicative difference vs baseline, e.g. 1.12 = 12% better. */
  versus: { openRate: number | null; clickRate: number | null; unsubRate: number | null } | null;
  /** Things a reader must know before drawing a conclusion. */
  caveats: string[];
}

const n = (r: Record<string, unknown> | null, k: string): number => {
  const v = r?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

function measure(rows: Array<Record<string, unknown>>): Measured {
  let delivered = 0,
    bounced = 0,
    opens = 0,
    clicks = 0,
    unsubscribes = 0,
    revenue = 0;
  for (const r of rows) {
    delivered += n(r, "delivered");
    bounced += n(r, "bounced");
    opens += n(r, "opensUnique");
    clicks += n(r, "clicksUnique");
    unsubscribes += n(r, "unsubscribes");
    revenue += n(r, "conversionValue");
  }
  // Pooled, never averaged — the same rule the console band and the semantic
  // layer use. Averaging per-campaign rates lets a small send outvote a large
  // one, which is precisely backwards when the question is "what works here".
  return {
    delivered,
    recipients: delivered + bounced,
    opens,
    clicks,
    unsubscribes,
    bounced,
    revenue,
    openRate: delivered > 0 ? opens / delivered : null,
    clickRate: delivered > 0 ? clicks / delivered : null,
    clickToOpenRate: opens > 0 ? clicks / opens : null,
    unsubRate: delivered > 0 ? unsubscribes / delivered : null,
  };
}

const measuredRows = (rows: CampaignRow[]) =>
  rows.filter(
    (r) =>
      (r.status === "sent" || r.status === "measured") &&
      r.readback &&
      n(r.readback, "delivered") > 0,
  );

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

/**
 * Build the retrospective for one campaign out of the full campaign list.
 * Pure — the caller fetches; this decides what the numbers are allowed to say.
 */
export function buildRetrospective(campaignId: string, all: CampaignRow[]): Retrospective {
  const row = all.find((r) => r.id === campaignId);
  const caveats: string[] = [];

  if (!row) {
    return {
      id: campaignId,
      subject: null,
      archetype: null,
      sentAt: null,
      performance: null,
      baseline: null,
      versus: null,
      caveats: [`No campaign "${campaignId}" in this store's index.`],
    };
  }

  const measured = measuredRows(all);
  const mine = measured.find((r) => r.id === campaignId);
  const others = measured.filter((r) => r.id !== campaignId);

  const performance = mine ? measure([mine.readback as Record<string, unknown>]) : null;
  const baseline =
    others.length > 0
      ? { ...measure(others.map((r) => r.readback as Record<string, unknown>)), campaigns: others.length }
      : null;

  if (!performance) {
    caveats.push(
      row.status === "sent" || row.status === "measured"
        ? "This campaign has sent but its numbers have not been read back yet — results arrive about a day after a send. Absent, not zero."
        : `This campaign has not sent (status "${row.status}"), so there is nothing to measure.`,
    );
  }

  if (!baseline) {
    caveats.push(
      "No other measured campaign to compare against, so these figures stand alone. A rate without a baseline cannot be called good or bad.",
    );
  } else if (baseline.campaigns < 3) {
    caveats.push(
      `The baseline is only ${baseline.campaigns} other campaign${baseline.campaigns === 1 ? "" : "s"}. ` +
        `Treat any difference as a hint worth watching, not a result — at this size the gap between two sends ` +
        `is comfortably explained by who happened to be in each audience.`,
    );
  }

  // Opens are the number everyone reaches for and the least trustworthy one.
  if (performance) {
    caveats.push(
      "Open rate is inflated by mail privacy protection, which fetches images without a human reading anything. Click rate is the load-bearing engagement signal.",
    );
  }
  if (performance && performance.revenue === 0 && (performance.clicks ?? 0) > 0) {
    caveats.push(
      "Clicks but no attributed revenue. That can mean the landing page or the offer did not convert — or simply that Klaviyo's attribution window has not caught the order yet.",
    );
  }

  return {
    id: row.id,
    subject: row.subject ?? null,
    archetype: row.archetype ?? null,
    sentAt: row.sentAt ?? row.scheduledAt ?? null,
    performance,
    baseline,
    versus:
      performance && baseline
        ? {
            openRate: ratio(performance.openRate, baseline.openRate),
            clickRate: ratio(performance.clickRate, baseline.clickRate),
            unsubRate: ratio(performance.unsubRate, baseline.unsubRate),
          }
        : null,
    caveats,
  };
}


/**
 * Fetch this store's campaign index rows.
 *
 * Deliberately NOT imported from console-data: that module belongs to the
 * console UI, and the pooled runtime that serves Slack does not ship it. An
 * agent tool reaching into a page's data layer is how a capability ends up
 * working on one surface and missing on the other — which is exactly the shape
 * of bug that has cost this pack the most time.
 */
export async function loadCampaignRows(): Promise<CampaignRow[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) {
    throw new Error(
      `retrospective: could not resolve a tenant id for "${shop}" — a lookup failure, not a store with no campaigns.`,
    );
  }
  const rows = await safeQuery<{
    id: string;
    subject: string | null;
    archetype: string | null;
    status: string;
    sent_at: Date | string | null;
    scheduled_at: Date | string | null;
    readback: Record<string, unknown> | null;
  }>(
    "retrospective",
    `SELECT id, subject, archetype, status, sent_at, scheduled_at, readback
       FROM mos_email_campaigns WHERE tenant_id = $1`,
    [tid],
  );
  if (rows === null) {
    throw new Error(
      "retrospective: the campaign index is unreachable, so no campaign can be reviewed. A connection failure, not an empty history.",
    );
  }
  const iso = (v: Date | string | null) =>
    v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    archetype: r.archetype ?? "",
    status: r.status,
    sentAt: iso(r.sent_at),
    scheduledAt: iso(r.scheduled_at),
    readback: r.readback,
  })) as unknown as CampaignRow[];
}
