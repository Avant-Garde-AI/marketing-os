export type CalendarVisibility = "live" | "scheduled" | "all";
export const CALENDAR_VIEWS: { id: CalendarVisibility; label: string }[] = [
  { id: "live", label: "Scheduled + published" },
  { id: "scheduled", label: "Scheduled only" },
  { id: "all", label: "All work" },
];
export function calendarVisibility(value?: string): CalendarVisibility {
  return value === "all" || value === "scheduled" ? value : "live";
}
/** A planned date never turns a draft into an approved calendar entry. */
export function visibleOnCalendar(item: { status: string; scheduledAt: string | null }, view: CalendarVisibility): boolean {
  if (view === "all") return true;
  if (!item.scheduledAt || !Number.isFinite(Date.parse(item.scheduledAt))) return false;
  return item.status === "scheduled" || (view === "live" && ["published", "sent", "measured"].includes(item.status));
}
