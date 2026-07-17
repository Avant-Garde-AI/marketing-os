"use client";

/**
 * The cross-channel calendar (WS4-R2 / 05 H4.2) — month grid + backlog lane
 * + client-side channel/status filters, spec 13 style (dense instrument grid,
 * editorial at the edges).
 *
 * CHANNEL-AGNOSTIC BY CONSTRUCTION: everything channel-specific derives from
 * the item's opaque `channel` string —
 *   - the chip label IS the string (uppercased typographically, not mapped);
 *   - the identity swatch is a deterministic hash → hue (any string gets a
 *     stable, quiet color — no per-channel palette table);
 *   - click-through comes from the lib/calendar/routes.ts registry; unknown
 *     channels render as no-link cards.
 * There is no switch on channel anywhere in this file (grep-provable) — a
 * synthetic third channel renders with zero changes here.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/primitives";
import { detailRouteFor } from "@/lib/calendar/routes";
import type { CalendarItem } from "@/lib/calendar/console-data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Deterministic hue from any channel string — identity without a palette
 * table. Muted saturation/lightness keeps it in the instrument register. */
function channelHue(channel: string): number {
  let h = 0;
  for (let i = 0; i < channel.length; i++) h = (h * 31 + channel.charCodeAt(i)) >>> 0;
  return h % 360;
}

function channelSwatch(channel: string): string {
  return `hsl(${channelHue(channel)} 42% 40%)`;
}

/** Generic lifecycle → chip register (wording, not traffic lights): shipped
 * words = filled, in-motion words = gold, everything else quiet. Keyed on the
 * status STRING alone — never on channel. */
const FILLED_STATUSES = new Set(["published", "sent", "measured"]);
const ATTENTION_STATUSES = new Set(["approved", "scheduled", "asset_ready", "drafted"]);

function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (FILLED_STATUSES.has(status)) return "filled";
  if (ATTENTION_STATUSES.has(status)) return "attention";
  return "outline";
}

function ChannelChip({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: channelSwatch(channel) }}
      />
      {channel}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const v = statusVariant(status);
  return (
    <span
      className={
        "text-[10px] " +
        (v === "filled"
          ? "bg-inverse px-1.5 py-px font-medium text-paper"
          : v === "attention"
            ? "border-b border-gold text-ink"
            : "text-ink-3")
      }
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ItemCard({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  const href = detailRouteFor(item.channel, item.itemId);
  const body = (
    <div
      className={
        "mt-1.5 border border-hairline bg-raised p-2 transition-shadow duration-[160ms]" +
        (href ? " hover:bar-active hover:shadow-card" : "")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <ChannelChip channel={item.channel} />
        <StatusChip status={item.status} />
      </div>
      {item.thumbnailUrl && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl}
          alt={item.title}
          className="mt-1.5 max-h-16 w-full border border-hairline object-cover"
        />
      )}
      <div className="mt-0.5 truncate text-[11.5px] text-ink-2" title={item.intent || item.title}>
        {item.title}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Toggle chip for the filter rows. */
function FilterChip({
  label,
  active,
  onToggle,
  swatch,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  swatch?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium transition-colors duration-[160ms] " +
        (active
          ? "bar-active bg-gold-quiet text-ink"
          : "border border-hairline-strong text-ink-3 hover:text-ink")
      }
    >
      {swatch && (
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: swatch }} />
      )}
      {label.replace(/_/g, " ")}
    </button>
  );
}

export function CalendarView({ month, items }: { month: string; items: CalendarItem[] }) {
  // Filter dimensions derive from the DATA — never from a hardcoded list.
  const channels = useMemo(() => [...new Set(items.map((i) => i.channel))].sort(), [items]);
  const statuses = useMemo(() => [...new Set(items.map((i) => i.status))].sort(), [items]);

  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  function toggle(set: Set<string>, value: string, apply: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  const visible = items.filter(
    (i) =>
      (channelFilter.size === 0 || channelFilter.has(i.channel)) &&
      (statusFilter.size === 0 || statusFilter.has(i.status))
  );

  const scheduled = visible.filter((i) => i.scheduledAt !== null);
  const backlog = visible.filter((i) => i.scheduledAt === null);

  // Month geometry (Monday-start grid — the /social precedent).
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, CalendarItem[]>();
  for (const item of scheduled) {
    const date = item.scheduledAt!.slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push(item);
    byDate.set(date, list);
  }

  return (
    <div>
      {/* Filters — visible only when there is something to narrow. */}
      {(channels.length > 1 || statuses.length > 1) && (
        <div className="animate-enter-2 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {channels.length > 1 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                Channel
              </span>
              {channels.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  swatch={channelSwatch(c)}
                  active={channelFilter.has(c)}
                  onToggle={() => toggle(channelFilter, c, setChannelFilter)}
                />
              ))}
            </span>
          )}
          {statuses.length > 1 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                Status
              </span>
              {statuses.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={statusFilter.has(s)}
                  onToggle={() => toggle(statusFilter, s, setStatusFilter)}
                />
              ))}
            </span>
          )}
        </div>
      )}

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
            const date = day === null ? null : `${month}-${String(day).padStart(2, "0")}`;
            const dayItems = date ? (byDate.get(date) ?? []) : [];
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
                    {dayItems.map((item) => (
                      <ItemCard key={`${item.channel}-${item.itemId}`} item={item} />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Backlog lane — planned but unscheduled (scheduledAt = null). */}
      {backlog.length > 0 && (
        <div className="animate-enter-3 mt-4 border border-hairline bg-raised">
          <div className="border-b border-hairline px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
            Backlog — planned, not yet scheduled
          </div>
          <div className="grid grid-cols-1 gap-x-3 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-4">
            {backlog.map((item) => (
              <ItemCard key={`${item.channel}-${item.itemId}`} item={item} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
