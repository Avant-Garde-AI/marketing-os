/** First activation starts a fresh future window; later ticks keep the granted cadence. */
export function activationStart(timeZone: string, reviewHours: number, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  // Allow a day to build the batch as well as the full opt-out review period.
  const days = Math.ceil(reviewHours / 24) + 2;
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
