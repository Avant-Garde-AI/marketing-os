import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { listCampaigns, type EmailCampaignRow } from "@/lib/email/console-data";
import { emailSheetLink } from "@/lib/email/review-links";
import { getTenant } from "@/lib/tenant-context";
import { CopyLink } from "@/components/copy-link";
import { EmailPerformanceBand } from "@/components/email/performance";
import { ScheduleMonth } from "@/components/email/schedule-month";

/**
 * Email — what is going out, then what went out.
 *
 * The page used to open on results and list every month the same way, so the
 * question an owner arrives with most days — "what is about to send, and does
 * anything need me?" — was a scroll away and written in lifecycle words. It
 * now leads with the unsent campaigns in send order, each with a plain status
 * and one bulk action, and keeps results and the sent record below.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAN_PROMPT =
  "Plan next month's email calendar from our strategy and show me the proposal.";

/** Campaign lifecycle → chip register (wording over traffic lights). */
function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (status === "sent" || status === "measured") return "filled";
  if (status === "approved" || status === "drafted" || status === "scheduled") return "attention";
  return "outline";
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sendLabel(row: EmailCampaignRow): string {
  const at = row.sentAt ?? row.scheduledAt;
  if (!at) return "unscheduled";
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Lifecycle → what an owner would say. */
function plainStatus(row: EmailCampaignRow, now: number): { label: string; variant: "filled" | "outline" | "attention" } {
  const missed = row.scheduledAt ? new Date(row.scheduledAt).getTime() < now : false;
  if (row.status === "scheduled") return { label: "Scheduled", variant: "filled" };
  if (missed) return { label: "Missed its send time", variant: "attention" };
  if (row.status === "drafted") return { label: "Ready to schedule", variant: "attention" };
  if (row.status === "approved") return { label: "Approved, not scheduled", variant: "attention" };
  return { label: "Needs your approval", variant: "outline" };
}

const SENT = new Set(["sent", "measured"]);
/** An unsent campaign this far past its date is a leftover, not a plan. */
const STALE_MS = 14 * 24 * 3600 * 1000;

function CampaignRow({ c, chip }: { c: EmailCampaignRow; chip: { label: string; variant: "filled" | "outline" | "attention" } }) {
  return (
    <li>
      <Link
        href={`/email/campaigns/${encodeURIComponent(c.id)}`}
        className="group flex items-baseline gap-4 px-5 py-3.5 transition-colors duration-[160ms] hover:bg-gold-quiet/60"
      >
        <span className="tnum w-20 shrink-0 text-xs text-ink-3">{sendLabel(c)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug">{c.subject ?? `Campaign ${c.id}`}</span>
          <span className="mt-0.5 block text-[12px] text-ink-3">
            {c.archetype}
            {c.audienceRefs.length > 0 &&
              ` · ${c.audienceRefs.map((a) => a.name ?? a.key ?? a.id).filter(Boolean).join(", ")}`}
          </span>
        </span>
        <Chip variant={chip.variant}>{chip.label}</Chip>
      </Link>
    </li>
  );
}

export default async function EmailPage() {
  const campaigns = await listCampaigns();
  const { shop } = getTenant();
  const now = Date.now();
  const at = (c: EmailCampaignRow) => (c.scheduledAt ? new Date(c.scheduledAt).getTime() : Number.POSITIVE_INFINITY);

  const unsent = campaigns.filter((c) => !SENT.has(c.status));
  const upcoming = unsent.filter((c) => !c.scheduledAt || at(c) >= now - STALE_MS).sort((a, b) => at(a) - at(b));
  const leftovers = unsent.filter((c) => !upcoming.includes(c)).sort((a, b) => at(b) - at(a));
  const sent = campaigns.filter((c) => SENT.has(c.status));
  const upcomingMonths = [...new Set(upcoming.map((c) => c.calendarMonth).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();

  const sentByMonth = new Map<string, EmailCampaignRow[]>();
  for (const c of sent) {
    const list = sentByMonth.get(c.calendarMonth) ?? [];
    list.push(c);
    sentByMonth.set(c.calendarMonth, list);
  }
  const sentMonths = [...sentByMonth.keys()].sort().reverse();

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Email"
          title={
            <>
              Campaigns, <span className="italic">accounted for.</span>
            </>
          }
          sub="What is about to send and whether it needs you, then how the sent ones did."
        />

        {campaigns.length === 0 ? (
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  No campaigns yet. Ask your marketing agent to plan{" "}
                  <span className="italic">a month of email.</span>
                </>
              }
              sub="The agent lays out send slots from your email strategy — archetypes rotated, audiences within cadence caps — and every campaign carries its rationale."
              action={
                <Link href={`/chat?prompt=${encodeURIComponent(PLAN_PROMPT)}`} className="arrow-link text-[15px]">
                  Plan a month
                </Link>
              }
            />
          </div>
        ) : (
          <div className="animate-enter-2 space-y-10">
            {/* Going out — first, because it is the part that can need a decision. */}
            <section>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-display text-[20px]">Going out</h2>
                {upcomingMonths.map((month) => (
                  <span key={month} className="flex items-baseline gap-4 text-[13px]">
                    <Link href={`/calendar?month=${month}`} className="arrow-link">{monthLabel(month)} on the calendar</Link>
                    <a href={emailSheetLink(shop, month).url} target="_blank" rel="noreferrer" className="arrow-link">Review sheet</a>
                  </span>
                ))}
              </div>
              {upcoming.length === 0 ? (
                <div className="border border-hairline bg-raised px-5 py-4 text-[14px] text-ink-2">
                  Nothing is waiting to send.{" "}
                  <Link href={`/chat?prompt=${encodeURIComponent(PLAN_PROMPT)}`} className="arrow-link">Plan the next month</Link>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <ScheduleMonth
                      campaigns={upcoming.map((c) => ({
                        id: c.id,
                        subject: c.subject ?? `Campaign ${c.id}`,
                        status: c.status,
                        scheduledAt: c.scheduledAt,
                        audience: c.audienceRefs.map((a) => a.name ?? a.key ?? a.id).filter(Boolean).join(", "),
                      }))}
                    />
                  </div>
                  <ul className="divide-y divide-hairline border border-hairline bg-raised">
                    {upcoming.map((c) => <CampaignRow key={c.id} c={c} chip={plainStatus(c, now)} />)}
                  </ul>
                  {/* The whole month, shareable: one link listing every campaign
                      with its own review link. Signed and expiring, no console
                      account needed. */}
                  {upcomingMonths.map((month) => (
                    <div key={month} className="mt-3">
                      <CopyLink url={emailSheetLink(shop, month).url} label={`Share ${monthLabel(month)} for review`} />
                    </div>
                  ))}
                </>
              )}
            </section>

            {/* Sent — results, then the record. */}
            {sent.length > 0 && (
              <section className="space-y-6">
                <h2 className="font-display text-[20px]">Sent</h2>
                <EmailPerformanceBand rows={campaigns} currency={process.env.STORE_CURRENCY ?? "USD"} />
                {sentMonths.map((month) => (
                  <div key={month}>
                    <h3 className="mb-2 text-[13px] uppercase tracking-[0.14em] text-ink-3">{monthLabel(month)}</h3>
                    <ul className="divide-y divide-hairline border border-hairline bg-raised">
                      {sentByMonth.get(month)!.map((c) => (
                        <CampaignRow key={c.id} c={c} chip={{ label: c.status === "measured" ? "Sent, measured" : "Sent", variant: "filled" }} />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            {/* Leftovers: unsent and long past their date. Out of the way, not hidden. */}
            {leftovers.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[14px] text-ink-2">
                  {leftovers.length} older draft{leftovers.length === 1 ? "" : "s"} that never sent
                </summary>
                <ul className="mt-3 divide-y divide-hairline border border-hairline bg-raised">
                  {leftovers.map((c) => <CampaignRow key={c.id} c={c} chip={{ label: "Never sent", variant: "outline" }} />)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
