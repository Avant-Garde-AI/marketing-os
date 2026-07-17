/**
 * Channel → detail-route registry (WS4-R2 / 05 H4.2).
 *
 * THE ONE PLACE channel identity meets the console's routing. The calendar
 * component itself never switches on channel — it asks this registry for a
 * click-through and renders a plain (no-link) card when the answer is null.
 * A new channel ships by adding ONE entry here (or none: it still renders,
 * just without a detail link) — never by touching the calendar components.
 */

/** Owning pack's detail route per channel. Keys are the opaque channel
 * strings packs write into mos_calendar_items. */
export const channelDetailRoute: Record<string, (itemId: string) => string> = {
  // Social pack (spec 24): posts detail under /social/posts/{id}.
  social: (itemId) => `/social/posts/${encodeURIComponent(itemId)}`,
  // Email pack (this module): campaign detail under /email/campaigns/{id}.
  email: (itemId) => `/email/campaigns/${encodeURIComponent(itemId)}`,
};

/** Resolve a channel's detail route, or null for channels the console has
 * never heard of — those render as no-link cards (H4.2 acceptance). */
export function detailRouteFor(channel: string, itemId: string): string | null {
  const route = channelDetailRoute[channel];
  return route ? route(itemId) : null;
}
