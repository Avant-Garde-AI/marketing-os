// agents/src/mastra/semantics/query/time.ts
//
// Resolve named/explicit time ranges to concrete YYYY-MM-DD bounds in the
// store's timezone, and map grains to GA4 date dimensions.

import type { Grain } from "../types";

/** "now" as YYYY-MM-DD in the given IANA timezone. */
function todayInTz(tz: string): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function endOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return `${ymd.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function startOfWeekMonday(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(ymd, -back);
}

export interface ResolvedRange {
  start: string;
  end: string;
  label: string;
}

export type RangeResult = ResolvedRange | { error: string; supported: string[] };

const NAMED_RANGES = [
  "today",
  "yesterday",
  "last_7_days",
  "last_14_days",
  "last_28_days",
  "last_30_days",
  "last_90_days",
  "this_week",
  "this_month",
  "last_month",
  "this_year",
];

/** Resolve a range spec to concrete bounds. Accepts named ranges, {start,end},
 *  and GA4-style "NdaysAgo". */
export function resolveRange(
  range: string | { start: string; end: string } | undefined,
  tz: string,
  fallbackLabel = "last_30_days"
): RangeResult {
  const today = todayInTz(tz);

  if (range && typeof range === "object") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) {
      return { error: "Explicit ranges must be {start,end} in YYYY-MM-DD form.", supported: NAMED_RANGES };
    }
    return { start: range.start, end: range.end, label: `${range.start}..${range.end}` };
  }

  const spec = (range ?? fallbackLabel).toString();

  // GA4-style "NdaysAgo"
  const daysAgo = spec.match(/^(\d+)daysago$/i);
  if (daysAgo) {
    const n = parseInt(daysAgo[1], 10);
    return { start: addDays(today, -n), end: today, label: spec };
  }

  switch (spec) {
    case "today":
      return { start: today, end: today, label: spec };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y, label: spec };
    }
    case "last_7_days":
      return { start: addDays(today, -6), end: today, label: spec };
    case "last_14_days":
      return { start: addDays(today, -13), end: today, label: spec };
    case "last_28_days":
      return { start: addDays(today, -27), end: today, label: spec };
    case "last_30_days":
      return { start: addDays(today, -29), end: today, label: spec };
    case "last_90_days":
      return { start: addDays(today, -89), end: today, label: spec };
    case "this_week":
      return { start: startOfWeekMonday(today), end: today, label: spec };
    case "this_month":
      return { start: startOfMonth(today), end: today, label: spec };
    case "last_month": {
      const lastMonthDay = addDays(startOfMonth(today), -1);
      return { start: startOfMonth(lastMonthDay), end: endOfMonth(lastMonthDay), label: spec };
    }
    case "this_year":
      return { start: `${today.slice(0, 4)}-01-01`, end: today, label: spec };
    default:
      return {
        error: `Unrecognized time range '${spec}'.`,
        supported: NAMED_RANGES,
      };
  }
}

/** Map a grain to the GA4 date dimension that buckets by it. Null = unsupported. */
export function ga4GrainDimension(grain: Grain): string | null {
  switch (grain) {
    case "day":
      return "date";
    case "week":
      return "yearWeek";
    case "month":
      return "yearMonth";
    case "year":
      return "year";
    default:
      return null; // hour, quarter not supported via a single GA4 date dimension
  }
}

export const GA4_SUPPORTED_GRAINS: Grain[] = ["day", "week", "month", "year"];

/** Bucket a YYYY-MM-DD date into a grain key for client-side (Shopify) grouping. */
export function bucketDate(ymd: string, grain: Grain): string {
  switch (grain) {
    case "day":
      return ymd;
    case "week":
      return startOfWeekMonday(ymd);
    case "month":
      return ymd.slice(0, 7);
    case "quarter": {
      const m = Number(ymd.slice(5, 7));
      return `${ymd.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
    }
    case "year":
      return ymd.slice(0, 4);
    default:
      return ymd;
  }
}
