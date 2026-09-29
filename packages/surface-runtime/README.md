# @avant-garde/surface-runtime

The Marketing OS storefront surface runtime: one zero-dependency browser
script that renders email-capture offers from a server-driven manifest, runs
sticky weighted experiments, and reports what happened. It is the storefront
half of the offers skill pack (`@avant-garde/skill-offers`), which compiles and
gates the manifests this script renders.

It is written to three rules:

- **Fails invisible.** Any error means no surface, never a broken one. Every
  entry point is wrapped; a malformed manifest renders nothing.
- **Zero CLS, no third parties.** Surfaces are overlay, corner-card or
  takeover only, never layout-shifting. The only requests are to the host's
  app proxy and to images on `https://cdn.shopify.com/`. Any other image
  origin is refused.
- **All decisions server-side.** The manifest decides what can show. The
  runtime decides only who is eligible and which arm they get, then renders
  and reports.

| File | Size (min / gzip) | Loaded |
| --- | --- | --- |
| `dist/surface-runtime.js` | ~45 KB / ~14 KB | on every storefront page, `defer` |
| `dist/surface-diag.js` | ~3 KB | only for signed previews with `mos_diag=1` |

## Install

```html
<script
  src="https://your-cdn/surface-runtime.js"
  defer
  data-mos-proxy="/apps/mcp"
  data-mos-country="{{ localization.country.iso_code }}"
></script>
```

- `data-mos-proxy` is the app-proxy prefix that serves `GET /surfaces` (the
  manifest) and accepts `POST /surfaces/events` and `POST /surfaces/capture`.
  It defaults to `/apps/mcp`.
- `data-mos-country` is optional. Liquid resolves it server-side, so
  country targeting costs no request.
- `surface-diag.js` must sit next to `surface-runtime.js` at the same path,
  because the runtime loads it by swapping the file name in its own `src`.

On a Shopify theme app extension, ship both `dist/` files as extension assets
unchanged. The hosted Marketing OS app vendors `src/` and minifies it with the
same esbuild settings, so its assets match `dist/` apart from the banner line.

The fetch has a 3.5 s timeout and uses `credentials: "omit"`. Setting
`window.MOS_MANIFEST = { surfaces: [...] }` before the script runs skips the
fetch; previews and tests use this.

## Client SDK: `window.mos`

```js
mos.version                                  // "0.6.0"
mos.ready(cb)                                // SDK booted, manifest evaluated
mos.surfaces.register(type, renderer, opts)  // a theme claims rendering for a surface type
```

Before the script loads, a theme can queue callbacks on
`window.__mosQueue = [fn, ...]`. The queue drains at boot and
`document` then receives a `mos:ready` event.

`renderer(controller)` receives a controller:

| Member | Meaning |
| --- | --- |
| `surface`, `variant`, `arm`, `experimentId`, `tokens`, `cell` | What was assigned. `tokens` is `variant.style`. |
| `preview` | `true` for a signed preview. Nothing is recorded. |
| `startStep` | The v2 step to open on (previews use `mos_step`). |
| `mount(el)` | The theme built its element. Records the impression and the per-session cap. |
| `dismiss(extra)` | Removes the element, sets suppression for `trigger.suppressAfterDismissDays` (default 14), sends a `dismiss` event. |
| `capture(email, { answers, consentText })` | Returns `Promise<{ ok, reward }>`. Writes consent and attribution through the proxy and sends `engage` and `capture` events. In a preview it resolves `{ ok: true, reward: null }` and writes nothing. |
| `track(name, extra)` | Sends a custom event through the same pipeline. |

The SDK owns *whether, what and when*: eligibility, arm assignment, triggers
and suppression. A renderer owns pixels only, and control-arm visitors never
reach one. The built-in renderer registers through the same API as a
fallback. A theme renderer wins only for what it declares:

```js
mos.surfaces.register("offer", render, {
  placements: ["corner-card", "overlay", "takeover"], // default: corner-card, overlay
  versions: ["1", "2"],                               // default: ["1"]
});
```

A renderer written for an older SDK therefore never draws a takeover or a v2
manifest it does not understand. The built-in renderer covers those cases.

## Manifests

`GET {proxy}/surfaces` returns `{ surfaces: Surface[] }`. The canonical types
and zod schemas live in `@avant-garde/skill-offers` (`OfferManifest`,
`OfferManifestV2`, `offerManifestV2Schema`), and its compiler and gates are the
only supported way to produce one. The outline below covers what the runtime
reads.

### v1 (no `version` field): one flat card

```ts
{
  id, type: "offer", title?,
  placement: "corner-card" | "overlay" | "takeover",
  trigger: { kind: "delay" | "exit-intent", seconds, suppressAfterDismissDays, maxPerSession },
  teaser?: { enabled },                    // corner-card re-open tab after a dismiss
  audience: { newVisitorsOnly, excludeSubscribed, pages: ("home"|"collection"|"product"|"cart")[],
              targeting?: { devices?, referrerContains?, utmSources?, countries?, returningOnly? } },
  schedule?: { from, to },                 // ISO window, checked client-side
  experiment: { id, policy: "fixed" | "thompson", allocation, arms: [{ key, weight }] },
  variants: { [arm]: { content: { eyebrow?, headline, headlineAccent?, body, points?, placeholder?,
                                  cta, success, consent, decline?, imageSrc?, imageAlt?, imageFocus?, imageCaption? },
                       style: { bg, ink, ink2, accent, line, font, fontDisplay?, fontMono? } } },
  consent: { capturesEmail: true },
  analytics?: false                        // opt out of the analytics mirror
}
```

### v2 (`version: "2"`): steps of closed-set blocks on a composition

```ts
{
  version: "2", id, type: "offer", title?, placement,
  trigger: TriggerSpec & { suppressAfterDismissDays, maxPerSession },
  mobile?: { searchArrival: "teaser-first" | "as-desktop" },   // default teaser-first
  teaser?: { enabled, label? },
  audience, schedule?,
  experiment: { id, policy, allocation,
                arms: [{ key, weight, kind?: "control" | "variant" | "incumbent", vendor? }],
                cells?: { "<device>.<visit>.<source>": [{ key, weight }] } },
  variants: { [arm]: { composition: "split-image" | "full-bleed-image" | "editorial-type" | "card",
                       steps: [{ id, kind: "hook" | "ask" | "reward", blocks: Block[] }],   // 1–3
                       style, incentive?, trigger?, archetype? } },
  consent: { capturesEmail: true }
}
```

- **Blocks** come from a closed catalog: `eyebrow`, `headline`
  (`text` plus an italic `accent`), `body`, `points`, `image` (`src` on
  cdn.shopify.com, `mobile: "keep" | "drop"`), `choice` (one question, 2–4
  options, advances on pick; `answerKey` becomes a profile property),
  `email`, `consent` (plain text, so it can never be a pre-checked box),
  `progress`, `cta`, `reward` (`message`, `code` or `picks` keyed by choice
  value) and `decline`. There are no HTML or CSS escape hatches.
- **Triggers** are `delay` (`seconds`), `exit-intent`, `scroll-dwell`
  (`percent`, `dwellSeconds`), `product-views` (`views`), and the legacy
  `scroll-depth` and `second-pageview`. A variant's `trigger` overrides the
  surface's.
- **Context cells** are keyed `device.visit.source`, for example
  `mobile.new.search`. Sources are `search`, `social`, `email`, `paid`,
  `direct` and `other`. Cell weights apply to new assignments only; an
  existing sticky assignment always wins.

## Behavior

- **Sticky, weighted assignment.** A random visitor id is kept in
  `localStorage`. The arm is an FNV-1a hash of `visitor:experiment` over the
  arm (or cell) weights, and it is stored per experiment.
- **Control is a real arm.** A control visitor sees nothing but still
  counts as an `exposure`, because the denominator matters.
- **One offer per visitor.** When two or more offers are live at once (for
  example, a challenger approved while the current offer still runs), each
  visitor is stickily assigned exactly one of them, chosen over the whole
  live set. A visitor never sees offer A on one page and offer B on the next,
  and never gets a second popup after dismissing the first. This also makes
  the two offers a fair head-to-head.
- **Eligibility** checks pages, "new" (the first 3 sessions, where a session
  is 30 minutes idle), captured, dismissed-suppression, the per-session cap,
  the schedule window and targeting, all from data already on the page.
- **Mobile search arrivals** see a small teaser pill first when the offer is
  an overlay or takeover, because an arrival interstitial counts against
  page experience. Exit-intent triggers are exempt. Opt out per manifest with
  `mobile.searchArrival: "as-desktop"`.
- **Exit-intent** fires when the desktop pointer leaves toward the browser
  chrome, or on a fast upward scroll near the top on mobile. It never
  listens to `popstate` or pushes history, so there is no back-button trap.
- **Takeovers** are full-screen, focus-trapped and scroll-locked. They close
  on Escape, the close button or a backdrop click. They respect
  `prefers-reduced-motion` and render into a shadow root.

### Klaviyo incumbent adapter

A v2 experiment can include an `incumbent` arm (`kind: "incumbent"`,
`vendor: "klaviyo"`). This lets the merchant's current Klaviyo popup compete
as an arm:

- **Incumbent visitors.** The runtime renders nothing and counts an
  `exposure`. It then observes Klaviyo's `klaviyoForms` DOM events and maps
  `open`, `submit` and `close` to `impression`, `capture` and `dismiss`
  (`vendor: "klaviyo"`), once per form.
- **Every other arm (control and variants).** Klaviyo popups and flyouts are
  hidden with an injected stylesheet (`#mos-suppress-klaviyo`) and re-hidden
  on open. The same applies when our offer is ineligible for the visitor
  (dismissed or capped), because otherwise closing our card would surface
  theirs. The suppression decision is remembered for 24 h, so it applies
  before the manifest round-trip on the next page.
- **Embedded Klaviyo forms** are page content and are never touched.

### Events

`POST {proxy}/surfaces/events` (sent by beacon) carries
`{ surfaceId, experimentId, arm, allocation, event, visitorId, page, ts, cell, ...extra }`.
The events are `exposure`, `impression`, `engage`, `capture`, `answer`,
`step`, `dismiss`, `teaser` and any custom `track()` name. `capture` goes
through `POST {proxy}/surfaces/capture`, which carries the email, the consent
text shown, the choice answers and the same attribution fields.

### Analytics mirror (GA4 / GTM / Shopify customer events)

Every offer event is mirrored to the store's own analytics, so an offer test
can be reported in GA4 without any setup:

| Runtime event | GA4 event |
| --- | --- |
| `exposure` | `mos_offer_exposure` (`non_interaction`), plus user property `mos_offer_arm` |
| `impression` | `view_promotion` |
| first `answer`, `step` or `engage` per offer arm per page | `select_promotion` |
| `capture` | `generate_lead` (`lead_source: "mos_offer"`) |
| `answer`, `step`, `dismiss`, `teaser` | `mos_offer_answer`, `mos_offer_step`, `mos_offer_dismiss`, `mos_offer_teaser` |

- **Parameters:** `mos_offer_id`, `mos_experiment_id`, `mos_arm`, `mos_cell`,
  `promotion_id`, `promotion_name`, `creative_name`, `creative_slot`, and
  where relevant `mos_step`, `mos_answer_key`, `mos_answer_value` and
  `mos_vendor`.
- **Where events go:** the page's own `gtag` when present, else a
  `dataLayer.push` for GTM. Every event is also sent through
  `Shopify.analytics.publish("mos_offer_<event>", params)` for custom pixels.
- **Holdback comparability:** the arm user property is set for control and
  incumbent visitors too, which is what makes the holdback comparable in GA4.
- **Opt out** per manifest with `analytics: false`.

## Preview and harness URL parameters

A preview surface is only served by the proxy in response to a valid signed
token, so the runtime trusts `preview: true` on it.

| Param | Effect |
| --- | --- |
| `mos_preview=<token>` | Passed to the proxy as `?preview=`. The previewed surface shows at once, skips eligibility, records nothing (no events, no capture, no suppression) and shows a "Preview — not live" badge with arm links. |
| `mos_arm=v1` | The variant to preview. Defaults to the first. |
| `mos_step=N` | Open on step N. Earlier choices take their first option. |
| `mos_teaser=1` | Render the mobile teaser pill instead of the card. |
| `mos_diag=1` | Harness mode: no badge, animations off, and `surface-diag.js` loads. When it has measured, it sets `document.documentElement.dataset.mosReady = "1"` and `window.__mosDiag` (a `DiagReport`: card, close, cta, input and choice rects, overflow, per-role contrast from the composited backdrop, image load, runtime errors). |

The offers pack's design harness renders every concept through these
parameters and scores the `DiagReport` (`conformanceVerdict`).

## Privacy guarantees

- **No third-party requests.** The only requests are to the host's app proxy
  and to store images on cdn.shopify.com. The manifest fetch sends no
  cookies.
- **Minimal storage.** `localStorage` only, under the `mos-surfaces:` prefix:
  a random visitor id, visit and pageview counters, the traffic-source class,
  recently viewed product handles (at most 50), arm assignments, suppression
  and capture timestamps. There are no cookies and no fingerprinting.
- **The email address goes only to the proxy's capture endpoint.** It is
  never sent to analytics, and neither is any free text. Answers are the
  manifest's option values.
- **Consent is explicit.** The consent text is always displayed as text
  (never a checkbox) and is sent alongside the capture.
- **Previews and harness renders never count.** They record no events and
  write no subscribers.

## Develop

```sh
pnpm --filter @avant-garde/surface-runtime build   # src/ → dist/ (esbuild, es2017, minified)
pnpm --filter @avant-garde/surface-runtime check   # fail if dist/ is stale
pnpm --filter @avant-garde/surface-runtime lint
pnpm --filter @avant-garde/surface-runtime test    # build, then the Playwright harness
```

`test/run.mjs` serves `test/fixture.html` as a stand-in storefront with a fake
app proxy. It renders every fixture at 390×844 (touch) and 1440×900 and
asserts the contract:

- the v1 DOM is unchanged, checked against `__snapshots__/v1-dom.json`;
- the `DiagReport` is populated;
- touch targets are at least 44 px and text meets AA contrast;
- the cell and the answers reach the wire;
- Klaviyo is suppressed or observed as the arm requires;
- previews are silent;
- there are no console errors;
- nothing is requested beyond the store origin and cdn.shopify.com.

Screenshots go to `test/__screenshots__/`, which git ignores.

`MOS_RUNTIME=/path/to/surface-runtime.js` runs the harness against any built
copy, such as a host's shipped asset. When Chromium cannot launch, `test`
prints a skip and exits 0. Install a browser with
`pnpm --filter @avant-garde/surface-runtime exec playwright install chromium`,
or set `MOS_REQUIRE_BROWSER=1` to make a missing browser fail the run.

## License

MIT
