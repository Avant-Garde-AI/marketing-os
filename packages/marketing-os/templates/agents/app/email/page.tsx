import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { listCampaigns, type EmailCampaignRow } from "@/lib/email/console-data";

/**
 * Email — the campaign library (WS4-R3, list side). Month-grouped rows from
 * the mos_email_campaigns index with status chips; each row opens the
 * campaign detail. Planning happens in chat; sends gate through Slack
 * approvals — this page reads.
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

export default async function EmailPage() {
  const campaigns = await listCampaigns();

  const byMonth = new Map<string, EmailCampaignRow[]>();
  for (const c of campaigns) {
    const list = byMonth.get(c.calendarMonth) ?? [];
    list.push(c);
    byMonth.set(c.calendarMonth, list);
  }
  const months = [...byMonth.keys()].sort().reverse();

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
          sub="Every campaign with its subject, its audience, and its record — proposed in chat, approved by you, measured after."
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
                <Link
                  href={`/chat?prompt=${encodeURIComponent(PLAN_PROMPT)}`}
                  className="arrow-link text-[15px]"
                >
                  Plan a month
                </Link>
              }
            />
          </div>
        ) : (
          <div className="animate-enter-2 space-y-8">
            {months.map((month) => (
              <section key={month}>
                <div className="mb-3 flex items-baseline gap-4">
                  <h2 className="font-display text-[20px]">{monthLabel(month)}</h2>
                  <Link
                    href={`/calendar?month=${month}`}
                    className="arrow-link text-[13px]"
                  >
                    On the calendar
                  </Link>
                </div>
                <ul className="divide-y divide-hairline border border-hairline bg-raised">
                  {byMonth.get(month)!.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/email/campaigns/${encodeURIComponent(c.id)}`}
                        className="group flex items-baseline gap-4 px-5 py-3.5 transition-colors duration-[160ms] hover:bg-gold-quiet/60"
                      >
                        <span className="tnum w-20 shrink-0 text-xs text-ink-3">
                          {sendLabel(c)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-snug">
                            {c.subject ?? `Campaign ${c.id}`}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-ink-3">
                            {c.archetype}
                            {c.audienceRefs.length > 0 &&
                              ` · ${c.audienceRefs
                                .map((a) => a.name ?? a.key ?? a.id)
                                .filter(Boolean)
                                .join(", ")}`}
                          </span>
                        </span>
                        <Chip variant={statusVariant(c.status)}>{c.status}</Chip>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
