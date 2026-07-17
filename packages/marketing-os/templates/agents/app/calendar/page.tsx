import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { CalendarView } from "@/components/calendar/calendar-view";
import { listCalendarItems, listCalendarMonths } from "@/lib/calendar/console-data";

/**
 * Calendar — THE cross-channel calendar (WS4-R2 / 02 §6 / 05 H4.2).
 *
 * Reads only the mos_calendar_items projection: every channel's planned work
 * — email campaigns, social posts, whatever ships next — on one month grid,
 * with a backlog lane for planned-but-unscheduled items. This page knows
 * nothing about channels beyond rendering chips; click-through resolves via
 * the lib/calendar/routes.ts registry. Supersedes the per-channel /social
 * calendar view (which stays for its channel-specific framing).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const PLAN_PROMPT =
  "Plan next month across our channels — email and social — and show me the proposal.";

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;

  const months = await listCalendarMonths();
  const month =
    requested && MONTH_RE.test(requested)
      ? requested
      : months.includes(currentMonth())
        ? currentMonth()
        : (months[0] ?? currentMonth());

  const items = await listCalendarItems(month);
  const channels = [...new Set(items.map((i) => i.channel))].sort();

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Calendar"
          title={
            <>
              Everything going out, <span className="italic">on one page.</span>
            </>
          }
          sub="Every channel's planned work — each item with its status, its why, and a door into its detail."
        />

        {/* Month masthead */}
        <div className="animate-enter-2 mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <h2 className="font-display text-[22px]">{monthLabel(month)}</h2>
            {items.length > 0 && (
              <span className="tnum text-[13px] text-ink-3">
                {items.length} item{items.length === 1 ? "" : "s"}
                {channels.length > 0 ? ` · ${channels.join(", ")}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-5 text-[14px]">
            <Link
              href={`/calendar?month=${shiftMonth(month, -1)}`}
              className="text-ink-2 transition-colors duration-[160ms] hover:text-gold"
            >
              ← {monthLabel(shiftMonth(month, -1))}
            </Link>
            <Link
              href={`/calendar?month=${shiftMonth(month, 1)}`}
              className="text-ink-2 transition-colors duration-[160ms] hover:text-gold"
            >
              {monthLabel(shiftMonth(month, 1))} →
            </Link>
          </div>
        </div>

        {items.length > 0 ? (
          <>
            <CalendarView month={month} items={items} />
            <p className="animate-enter-3 mt-5 text-[11.5px] text-ink-3">
              Read + click-through for now — scheduling changes happen where each channel&apos;s
              approvals live. Refine any month in chat.
            </p>
          </>
        ) : (
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  Nothing planned for {monthLabel(month)}
                  <span className="italic"> — yet.</span>
                </>
              }
              sub="Your agents plan email campaigns and social posts from your strategy; every planned item lands here with its channel and its rationale."
              action={
                <span className="flex items-center justify-center gap-6">
                  <Link
                    href={`/chat?prompt=${encodeURIComponent(PLAN_PROMPT)}`}
                    className="arrow-link text-[15px]"
                  >
                    Plan a month
                  </Link>
                  {months.length > 0 && (
                    <Link href={`/calendar?month=${months[0]}`} className="arrow-link text-[15px]">
                      Latest planned month
                    </Link>
                  )}
                </span>
              }
            />
          </div>
        )}

        {months.length > 0 && (
          <div className="animate-enter-3 mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
              Planned months
            </span>
            {months.map((mo) => (
              <Link key={mo} href={`/calendar?month=${mo}`}>
                <Chip variant={mo === month ? "filled" : "outline"}>{mo}</Chip>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
