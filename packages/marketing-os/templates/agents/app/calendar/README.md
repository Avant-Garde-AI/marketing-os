# The cross-channel calendar — channel-agnosticism acceptance (05 H4.2)

The template has no component-test harness (its `package.json.hbs` carries no
test runner; validation is scaffold + `tsc`/`next build` in the rendered
project), so the H4.2 acceptance is documented here and kept **grep-provable**.

## The acceptance

> A synthetic third channel appears on the calendar with **zero
> calendar-component changes**.

## Why it holds

The calendar surface is three files, and channel identity never branches in
any of them:

- `lib/calendar/console-data.ts` — reads `mos_calendar_items` verbatim.
  `channel` and `status` are carried as opaque strings; no mapping tables.
- `components/calendar/calendar-view.tsx` — everything channel-specific is
  **derived from the string**:
  - the chip label *is* the channel string (styled uppercase, not remapped);
  - the identity swatch is a deterministic hash → HSL hue (`channelHue`), so
    ANY string gets a stable, quiet color with no palette registry;
  - filter chips enumerate `new Set(items.map(i => i.channel))` — the data,
    not a hardcoded list;
  - status chips key on generic lifecycle *words* (`published`/`sent` filled,
    `approved`/`scheduled` gold, everything else quiet outline) — keyed on the
    status string alone, never on channel, and defaulting safely for unknown
    statuses.
- `lib/calendar/routes.ts` — the ONE place channel meets routing:
  `channelDetailRoute: Record<string, (itemId) => string>`. Unknown channels
  resolve to `null` and render as no-link cards.

## The manual test

Insert a synthetic row and load `/calendar`:

```sql
INSERT INTO mos_calendar_items
  (tenant_id, channel, item_id, pack_id, month, scheduled_at, status, title, intent)
VALUES
  ('<tenant>', 'carrier-pigeon', 'pigeon-001', 'pigeon-post', '2026-08',
   '2026-08-14T09:00:00Z', 'proposed', 'Pigeon drop #1', 'Test the abstraction');
```

Expected, with zero code changes: the item renders on Aug 14 with a
`CARRIER-PIGEON` chip (hash-derived swatch), a quiet `proposed` status chip,
appears in the channel filter row, and renders as a card without a detail
link. Adding `"carrier-pigeon"` to `channelDetailRoute` (one line, in the
registry — not the component) is all it takes to light up click-through.

## Grep-provable

No `switch` on channel and no channel string literals in the components:

```sh
grep -rn "switch" components/calendar lib/calendar        # → no matches
grep -rn '"social"\|"email"' components/calendar          # → no matches
grep -rn '"social"\|"email"' lib/calendar/console-data.ts # → no matches
```

The only channel literals on the calendar surface live in
`lib/calendar/routes.ts` — the registry that exists precisely to hold them.

## Relationship to /social

`/calendar` supersedes the `/social` month view as *the* calendar. `/social`
stays: it is the social pack's channel-specific surface (pillar framing,
plan-a-month prompt) and the detail pages under `/social/posts/*` are the
`social` channel's click-through target.
