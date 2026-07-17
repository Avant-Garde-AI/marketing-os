import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { getTenant } from "@/lib/tenant-context";
import { listCalendarMonths, loadCalendar } from "@/lib/social/console-data";
import type { CalendarSlot } from "@/lib/social/types";

/**
 * Social — the calendar view (spec 24 §6, SM0 read-only; spec 13 style:
 * editorial at the edges, a dense month grid in the middle).
 *
 * NOTE (WS4-R2): /calendar — the cross-channel calendar over the
 * mos_calendar_items projection — supersedes this page as THE calendar. This
 * page stays as the social pack's channel-specific surface (pillar framing,
 * plan-a-month flow) and its post detail routes remain the "social" channel's
 * click-through target in lib/calendar/routes.ts.
 *
 * The month renders from social/calendar/{YYYY-MM}.md (?month=YYYY-MM,
 * defaulting to the latest calendar present). Slots land on their days as
 * cards with channel / pillar / status; a slot with a post links into the
 * post detail (copy, provenance, and its canvas). Planning happens in chat;
 * approval and publishing arrive with SM2 — this page only reads.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PLAN_PROMPT =
  "Plan next month's social calendar from our strategy and show me the proposal.";

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

/** Post lifecycle → chip register: shipped = filled, in motion = gold, else quiet. */
function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (status === "published" || status === "measured") return "filled";
  if (status === "approved" || status === "asset_ready" || status === "scheduled")
    return "attention";
  return "outline";
}

function SlotCard({ slot }: { slot: CalendarSlot }) {
  const body = (
    <div
      className={
        "mt-1.5 border border-hairline bg-raised p-2 transition-shadow duration-[160ms]" +
        (slot.postId ? " hover:bar-active hover:shadow-card" : "")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink">
          {slot.channel}
        </span>
        <span
          className={
            "text-[10px] " +
            (statusVariant(slot.status) === "filled"
              ? "bg-inverse px-1.5 py-px font-medium text-paper"
              : statusVariant(slot.status) === "attention"
                ? "border-b border-gold text-ink"
                : "text-ink-3")
          }
        >
          {slot.status.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11.5px] text-ink-2" title={slot.intent}>
        {slot.pillar}
      </div>
    </div>
  );
  return slot.postId ? (
    <Link href={`/social/posts/${encodeURIComponent(slot.postId)}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;

  const { shop } = getTenant();
  const months = await listCalendarMonths(shop);
  const month =
    requested && MONTH_RE.test(requested) ? requested : (months[0] ?? null);

  // ── Nothing planned anywhere: the editorial invitation ───────────────────
  if (!month) {
    return (
      <div className="px-8 py-10">
        <div className="mx-auto max-w-[1200px]">
          <PageHeader
            eyebrow="Social"
            title={
              <>
                The calendar, <span className="italic">derived.</span>
              </>
            }
            sub="Every planned post with its channel, its pillar, and its why — traced to the Brand Soul, approved by you."
          />
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  Nothing planned yet. Ask your marketing agent to plan{" "}
                  <span className="italic">a month of social.</span>
                </>
              }
              sub="The agent lays out slots from your social strategy — cadence per channel, pillars rotated by weight — and every slot carries its rationale."
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
        </div>
      </div>
    );
  }

  const calendar = await loadCalendar(shop, month);

  // Month geometry (Monday-start grid).
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const slotsByDate = new Map<string, CalendarSlot[]>();
  for (const slot of calendar?.slots ?? []) {
    const list = slotsByDate.get(slot.slot) ?? [];
    list.push(slot);
    slotsByDate.set(slot.slot, list);
  }

  const channels = [...new Set((calendar?.slots ?? []).map((s) => s.channel))];

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Social"
          title={
            <>
              The calendar, <span className="italic">derived.</span>
            </>
          }
          sub="Every planned post with its channel, its pillar, and its why — traced to the Brand Soul, approved by you."
        />

        {/* Month masthead */}
        <div className="animate-enter-2 mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <h2 className="font-display text-[22px]">{monthLabel(month)}</h2>
            {calendar && <Chip variant="outline">{calendar.status}</Chip>}
            {calendar && (
              <span className="tnum text-[13px] text-ink-3">
                {calendar.slots.length} slots
                {channels.length > 0 ? ` · ${channels.join(", ")}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-5 text-[14px]">
            <Link
              href={`/social?month=${shiftMonth(month, -1)}`}
              className="text-ink-2 transition-colors duration-[160ms] hover:text-gold"
            >
              ← {monthLabel(shiftMonth(month, -1))}
            </Link>
            <Link
              href={`/social?month=${shiftMonth(month, 1)}`}
              className="text-ink-2 transition-colors duration-[160ms] hover:text-gold"
            >
              {monthLabel(shiftMonth(month, 1))} →
            </Link>
          </div>
        </div>

        {calendar ? (
          <>
            {/* The grid */}
            <div className="animate-enter-2 border-l border-t border-hairline bg-raised">
              <div className="grid grid-cols-7">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="border-b border-r border-hairline px-2.5 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3"
                  >
                    {d}
                  </div>
                ))}
                {cells.map((day, i) => {
                  const date =
                    day === null
                      ? null
                      : `${month}-${String(day).padStart(2, "0")}`;
                  const slots = date ? (slotsByDate.get(date) ?? []) : [];
                  return (
                    <div
                      key={i}
                      className={
                        "min-h-[104px] border-b border-r border-hairline p-2 " +
                        (day === null ? "bg-page" : "")
                      }
                    >
                      {day !== null && (
                        <>
                          <div className="tnum text-[11px] text-ink-3">{day}</div>
                          {slots.map((slot, j) => (
                            <SlotCard key={`${slot.channel}-${j}`} slot={slot} />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {calendar.notes && (
              <p className="animate-enter-3 mt-5 max-w-2xl text-sm leading-relaxed text-ink-2">
                {calendar.notes}
              </p>
            )}
            <p className="animate-enter-3 mt-2 text-[11.5px] text-ink-3">
              Read-only for now — approving, scheduling, and publishing arrive with the
              action framework. Refine the plan in chat. Every channel together lives on{" "}
              <Link href="/calendar" className="arrow-link">
                the calendar
              </Link>
              .
            </p>
          </>
        ) : (
          /* Months exist elsewhere, just not here */
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  Nothing planned for {monthLabel(month)}
                  <span className="italic"> — yet.</span>
                </>
              }
              action={
                <Link
                  href={`/chat?prompt=${encodeURIComponent(
                    `Plan the ${monthLabel(month)} social calendar from our strategy and show me the proposal.`
                  )}`}
                  className="arrow-link text-[15px]"
                >
                  Plan {monthLabel(month)}
                </Link>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
