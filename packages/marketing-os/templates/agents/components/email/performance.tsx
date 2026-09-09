import { StatTile } from "@/components/primitives";
import type { EmailCampaignRow } from "@/lib/email/console-data";

/**
 * What the email programme actually did — on the page where the campaigns are.
 *
 * The numbers already existed: the email cron reads Klaviyo's campaign-values
 * after each send and stores them on the index row. Until now the only way to
 * see them was to ask the agent, which is the right surface for a question and
 * the wrong one for a glance.
 *
 * ## Rates are pooled, never averaged
 *
 * Every rate here is sum(numerator) / sum(denominator) across the campaigns in
 * view — the same rule the semantic layer's `email_performance` uses. That
 * consistency is the point: if this page averaged per-campaign rates while the
 * agent pooled them, the same question would get two different answers
 * depending on where it was asked, and the page would win because it looks
 * authoritative. Averaging also flatters small sends badly — a 200-recipient
 * test at 40% and a 3,400-recipient broadcast at 8% average to 24%, while the
 * pooled truth is 9.8%.
 *
 * ## Absent is not zero
 *
 * A campaign's numbers arrive about a day after it sends and keep moving for a
 * fortnight while Klaviyo attributes orders. So a send from this morning has no
 * row yet — and rendering that as 0% opens would be a lie told in the most
 * believable possible format. Unmeasured campaigns are counted separately and
 * named, never folded into the denominator.
 */

type Readback = Record<string, unknown>;

const num = (r: Readback | null, key: string): number | null => {
  const v = r?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** delivered + bounced — what the send actually attempted. */
function recipientsOf(r: Readback): number {
  return (num(r, "delivered") ?? 0) + (num(r, "bounced") ?? 0);
}

export interface EmailPerformance {
  measured: number;
  awaiting: number;
  recipients: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  revenue: number;
  openRate: number | null;
  clickRate: number | null;
  unsubRate: number | null;
  perCampaign: Array<{
    id: string;
    subject: string;
    sentAt: string | null;
    recipients: number;
    openRate: number | null;
    clickRate: number | null;
    revenue: number;
  }>;
}

/** Roll the index rows up. Only campaigns with a readback contribute. */
export function summarise(rows: EmailCampaignRow[]): EmailPerformance {
  const sent = rows.filter((r) => r.status === "sent" || r.status === "measured");
  const withData = sent.filter((r) => r.readback && recipientsOf(r.readback) > 0);

  let recipients = 0,
    delivered = 0,
    opens = 0,
    clicks = 0,
    unsubscribes = 0,
    revenue = 0;
  const perCampaign: EmailPerformance["perCampaign"] = [];

  for (const row of withData) {
    const r = row.readback as Readback;
    const rec = recipientsOf(r);
    const del = num(r, "delivered") ?? 0;
    const op = num(r, "opensUnique") ?? 0;
    const cl = num(r, "clicksUnique") ?? 0;
    recipients += rec;
    delivered += del;
    opens += op;
    clicks += cl;
    unsubscribes += num(r, "unsubscribes") ?? 0;
    revenue += num(r, "conversionValue") ?? 0;
    perCampaign.push({
      id: row.id,
      subject: row.subject ?? row.id,
      sentAt: row.sentAt ?? row.scheduledAt ?? null,
      recipients: rec,
      openRate: del > 0 ? op / del : null,
      clickRate: del > 0 ? cl / del : null,
      revenue: num(r, "conversionValue") ?? 0,
    });
  }

  perCampaign.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));

  return {
    measured: withData.length,
    awaiting: sent.length - withData.length,
    recipients,
    delivered,
    opens,
    clicks,
    unsubscribes,
    revenue,
    openRate: delivered > 0 ? opens / delivered : null,
    clickRate: delivered > 0 ? clicks / delivered : null,
    unsubRate: delivered > 0 ? unsubscribes / delivered : null,
    perCampaign,
  };
}

const pct = (v: number | null, dp = 1) => (v === null ? null : `${(v * 100).toFixed(dp)}%`);
const int = (v: number) => v.toLocaleString("en-US");

function money(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString("en-US")}`;
  }
}

/**
 * A rate as a bar, scaled against the highest rate in view rather than against
 * 100%. Email rates live in the single digits, so a 0–100 axis renders every
 * campaign as an identical sliver and hides exactly the differences worth
 * seeing. The number is always printed beside the bar — the bar ranks, the
 * figure informs.
 */
function Bar({ value, max, label }: { value: number | null; max: number; label: string }) {
  const width = value !== null && max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
      <span className="h-1.5 flex-1 bg-paper-2" aria-hidden="true">
        <span
          className="block h-full bg-gold transition-[width] duration-500"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="tnum w-14 shrink-0 text-right text-[12px] text-ink-2">
        {pct(value) ?? "—"}
      </span>
    </div>
  );
}

export function EmailPerformanceBand({
  rows,
  currency = "USD",
}: {
  rows: EmailCampaignRow[];
  currency?: string;
}) {
  const s = summarise(rows);
  const anySent = s.measured + s.awaiting;

  // Nothing has ever been sent — the campaign list's own empty state already
  // says what to do, and a wall of dashes above it would just be furniture.
  if (anySent === 0) return null;

  // Sent, but nothing has come back yet. Say that plainly, with when to expect
  // it, rather than showing a row of zeros that reads as a failed programme.
  if (s.measured === 0) {
    return (
      <div className="animate-enter-2 mb-8 border border-hairline bg-raised px-5 py-4">
        <p className="text-[14px] leading-relaxed text-ink-2">
          {anySent === 1
            ? "One campaign has gone out, and its numbers have not come back yet."
            : `${anySent} campaigns have gone out, and their numbers have not come back yet.`}
        </p>
        <p className="mt-1 text-[13px] text-ink-3">
          Results land about a day after a send and keep moving for a fortnight while orders are
          attributed. Nothing is wrong — there is simply nothing to show yet.
        </p>
      </div>
    );
  }

  // ONE shared scale across both metrics, not one per metric.
  //
  // Scaling opens and clicks independently ranks each metric well across
  // campaigns and lies badly within a campaign — and with a single campaign in
  // view it degenerates completely: both bars hit 100% and a 13.2% open rate
  // renders identically to a 1.4% click rate. A shared maximum keeps the
  // clicks bar honestly shorter than the opens bar it is a subset of, and
  // still ranks campaigns against each other. Cross-campaign click differences
  // compress, which is why the figure is printed beside every bar.
  const scale = Math.max(
    ...s.perCampaign.map((c) => Math.max(c.openRate ?? 0, c.clickRate ?? 0)),
    0.0001,
  );

  return (
    <section className="animate-enter-2 mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-[20px]">How the sends performed</h2>
        <span className="text-[12px] text-ink-3">
          {s.measured} measured
          {s.awaiting > 0 && ` · ${s.awaiting} still coming in`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Reached" value={int(s.recipients)} note="people the sends attempted" />
        <StatTile
          label="Open rate"
          value={pct(s.openRate)}
          note={`${int(s.opens)} opens — inflated by mail privacy`}
        />
        <StatTile
          label="Click rate"
          value={pct(s.clickRate)}
          note={`${int(s.clicks)} clicks — the honest signal`}
        />
        <StatTile
          label="Unsubscribes"
          value={int(s.unsubscribes)}
          note={pct(s.unsubRate, 2) ? `${pct(s.unsubRate, 2)} of delivered` : " "}
        />
        <StatTile
          label="Attributed revenue"
          value={s.revenue > 0 ? money(s.revenue, currency) : "—"}
          note={s.revenue > 0 ? "Klaviyo attribution" : "no orders attributed yet"}
        />
      </div>

      {/* Campaign-by-campaign. Bars are scaled to the best in view, so the
          ranking is legible even though every rate is a small number. */}
      <div className="mt-3 border border-hairline bg-raised">
        <ul className="divide-y divide-hairline">
          {s.perCampaign.map((c) => (
            <li key={c.id} className="px-5 py-4">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <span className="min-w-0 truncate text-[14px]">{c.subject}</span>
                <span className="tnum shrink-0 text-[12px] text-ink-3">
                  {int(c.recipients)} sent
                  {c.revenue > 0 && ` · ${money(c.revenue, currency)}`}
                </span>
              </div>
              <div className="space-y-1.5">
                <Bar value={c.openRate} max={scale} label="Opens" />
                <Bar value={c.clickRate} max={scale} label="Clicks" />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {s.awaiting > 0 && (
        <p className="mt-2 text-[12px] text-ink-3">
          {s.awaiting === 1 ? "One campaign is" : `${s.awaiting} campaigns are`} not counted above —
          sent too recently to have results.
        </p>
      )}
    </section>
  );
}
