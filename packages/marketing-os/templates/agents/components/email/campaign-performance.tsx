import type { Retrospective, Verdict } from "@/lib/email/retrospective";

/**
 * How this one campaign did, against the store's own other sends.
 *
 * The list page answers "how is email going". This answers "how did THIS go",
 * which is a different question and the one people arrive on a campaign page
 * holding. It reads `buildRetrospective` — the same module the agent's
 * retrospective tool reads — so the page and the agent cannot tell different
 * stories about the same send.
 *
 * Every rate is shown against a baseline pooled from the other measured
 * campaigns, because a rate alone cannot be called good or bad. Where the
 * baseline is too thin to support a comparison, the caveat says so instead of
 * the design implying confidence through a tidy percentage.
 */

const pct = (v: number | null, dp = 1) => (v === null ? "—" : `${(v * 100).toFixed(dp)}%`);
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
 * The comparison, as judged by the retrospective module rather than re-decided
 * here. Shows the ratio for scale and the verdict for meaning, and the verdict
 * is direction-aware: more opens is better, more unsubscribes is worse, and
 * rendering both as "1.8× the usual" invites someone to read churn as success.
 */
function Versus({ v }: { v: Verdict | undefined }) {
  if (!v || v.band === "no baseline") return <span className="text-ink-3">no baseline</span>;
  if (v.band === "about usual") return <span className="text-ink-3">about usual</span>;
  const worse = v.band === "worse";
  return (
    <span className={worse ? "text-danger" : "text-ink"}>
      {v.ratio!.toFixed(2)}× — {worse ? "worse than usual" : "better than usual"}
    </span>
  );
}

function Row({
  label,
  value,
  versus,
  note,
}: {
  label: string;
  value: string;
  versus?: Verdict;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-4 border-t border-hairline py-2.5 first:border-t-0">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
      <span className="tnum w-20 shrink-0 text-[16px]">{value}</span>
      <span className="w-32 shrink-0 text-[12px]">
        {versus !== undefined && <Versus v={versus} />}
      </span>
      {note && <span className="min-w-0 flex-1 text-[12px] text-ink-3">{note}</span>}
    </div>
  );
}

export function CampaignPerformance({
  retro,
  currency = "USD",
}: {
  retro: Retrospective;
  currency?: string;
}) {
  const p = retro.performance;

  // Not measured yet — say which, and why, rather than rendering an empty grid
  // that reads as a campaign that did nothing.
  if (!p) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 font-display text-[20px]">Performance</h2>
        <div className="border border-hairline bg-raised px-5 py-4">
          {retro.caveats.map((c, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-ink-2">
              {c}
            </p>
          ))}
        </div>
      </section>
    );
  }

  const b = retro.baseline;
  const v = retro.versus;

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-[20px]">Performance</h2>
        <span className="text-[12px] text-ink-3">
          {b ? `against ${b.campaigns} other measured campaign${b.campaigns === 1 ? "" : "s"}` : "no baseline yet"}
        </span>
      </div>

      <div className="border border-hairline bg-raised px-5 py-3">
        <Row label="Delivered" value={int(p.delivered)} note={`${int(p.bounced)} bounced`} />
        <Row
          label="Open rate"
          value={pct(p.openRate)}
          versus={v?.openRate}
          note={`${int(p.opens)} opens`}
        />
        <Row
          label="Click rate"
          value={pct(p.clickRate)}
          versus={v?.clickRate}
          note={`${int(p.clicks)} clicks`}
        />
        <Row
          label="Click-to-open"
          value={pct(p.clickToOpenRate)}
          note="of those who opened, the share who clicked"
        />
        <Row
          label="Unsubscribes"
          value={int(p.unsubscribes)}
          versus={v?.unsubRate}
          note={pct(p.unsubRate, 2) + " of delivered"}
        />
        <Row
          label="Attributed revenue"
          value={p.revenue > 0 ? money(p.revenue, currency) : "—"}
          note={p.revenue > 0 ? "Klaviyo attribution" : "no orders attributed"}
        />
      </div>

      {/* The limits on what any of this can be used to claim. Deliberately not
          collapsed behind anything — a caveat nobody reads is decoration. */}
      {retro.caveats.length > 0 && (
        <ul className="mt-2 space-y-1">
          {retro.caveats.map((c, i) => (
            <li key={i} className="border-l-2 border-gold pl-3 text-[12px] leading-relaxed text-ink-3">
              {c}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
