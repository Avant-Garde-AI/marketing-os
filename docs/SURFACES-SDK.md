# Marketing OS — Storefront Surfaces SDK

**Audience:** developers and coding agents working in a store's **theme repo** who want to build theme-native offer UI on top of Marketing OS.
**Contract version:** `window.mos` v0.2 · Spec: [`spec/14-OFFER-SURFACES.md`](../spec/14-OFFER-SURFACES.md)

---

## 1. The mental model

Marketing OS separates an offer's **brains** from its **pixels**:

| The SDK owns (always) | Your renderer owns |
|---|---|
| Whether a visitor is eligible (audience, suppression, frequency caps) | Markup and layout |
| Which experiment arm they're in (sticky, weighted, control included) | Typography, motion, imagery |
| When to show (triggers: delay / scroll-depth / second-pageview) | Where in your design language it lives |
| Email capture → Shopify customer + marketing consent | The form's look — **not** its submission |
| Attribution, event pipeline, experiment optimization | Nothing measurable |

You never decide *whether* to show an offer, and you never post an email anywhere yourself. You build the surface's body; Marketing OS remains its nervous system. **Control-arm visitors never reach your renderer** — don't work around this; the control group is what makes the offer program measurable.

A built-in, brand-neutral card ships with the runtime (registered through this same API as the fallback). Registering your renderer for a surface type **overrides** the built-in for that type. If your renderer throws, the runtime swallows the error and shows nothing — *fails invisible* is the framework's storefront contract, and yours too.

## 2. Prerequisites

1. The **Marketing OS** Shopify app is installed on the store.
2. The **"Marketing OS Surfaces"** app embed is enabled (Theme editor → App embeds). This loads the runtime + SDK from Shopify's CDN — your theme never bundles or vendors the runtime.
3. An offer exists in the store's surface manifest (Marketing OS console → Chat, or hand-authored during development).

## 3. Registering a renderer

Put registration in a theme JS asset (loaded with `defer`). Because script order isn't guaranteed, use the **pre-init queue** pattern — safe whether your code runs before or after the runtime:

```js
// assets/mos-offer-renderer.js
(function () {
  function register() {
    window.mos.surfaces.register("offer", renderOffer);
  }
  // Pre-init-safe: queue if the runtime hasn't loaded yet.
  if (window.mos && window.mos.surfaces && window.mos.surfaces.register) register();
  else {
    (window.__mosQueue = window.__mosQueue || []).push(register);
    document.addEventListener("mos:ready", register, { once: true });
  }

  function renderOffer(ctl) {
    var c = ctl.variant.content;   // the arm's approved copy — render it verbatim
    var el = document.createElement("aside");
    el.className = "my-offer-drawer";
    el.setAttribute("role", "complementary");
    el.setAttribute("aria-label", c.headline);
    el.innerHTML = /* your markup, your design language */ `
      <p class="my-offer-headline">${c.headline}</p>
      <p class="my-offer-body">${c.body}</p>
      <form><input type="email" required autocomplete="email"
             placeholder="${c.placeholder}" aria-label="Email address">
        <button type="submit">${c.cta}</button></form>
      <button class="my-offer-x" aria-label="Dismiss">×</button>
      <small>${c.consent}</small>`;

    el.querySelector(".my-offer-x").addEventListener("click", function () {
      ctl.dismiss();               // suppression + event — never just .remove()
    });
    el.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      ctl.capture(el.querySelector("input").value).then(function (res) {
        if (res.ok) el.querySelector("form").replaceWith(
          Object.assign(document.createElement("p"), { textContent: c.success }));
        // on !res.ok: show a quiet inline retry state; never a broken surface
      });
    });

    document.body.appendChild(el);
    ctl.mount(el);                 // REQUIRED — records the impression
  }
})();
```

Trigger timing gives you slack: the earliest trigger fires ~10s after page load, so any normally-loaded theme script registers in time.

## 4. Controller reference

Your renderer receives one argument — the controller:

| Member | Type | Meaning |
|---|---|---|
| `ctl.surface` | object | The surface config (id, placement, trigger — informational) |
| `ctl.variant.content` | object | The arm's copy: `eyebrow?`, `headline`, `body`, `placeholder`, `cta`, `success`, `consent` — **render verbatim**; it's merchant-approved |
| `ctl.variant.style` / `ctl.tokens` | object | Brand style tokens (`bg`, `ink`, `ink2`, `accent`, `line`, `font`) — honor them or use your theme's own system deliberately |
| `ctl.arm` / `ctl.experimentId` | string | For your own diagnostics; already stamped on every event |
| `ctl.mount(el)` | fn | Call exactly once when your UI is in the DOM. Records the impression + frequency count. **Skipping this corrupts experiment data.** |
| `ctl.dismiss()` | fn | Removes the mounted element, sets suppression (per-manifest days), fires the dismiss event. The **only** correct way to close. |
| `ctl.capture(email)` | fn → Promise\<{ok}\> | The **only** correct way to submit: writes the Shopify customer with explicit marketing consent, tags for attribution, fires engage/capture events. Never post the email to any other endpoint. |
| `ctl.track(name, extra?)` | fn | Optional custom events (e.g. `"expand"`) into the same pipeline. |

## 5. Non-negotiable rules (gate-enforced)

Offer *content* is generated and approved upstream, and rendered surfaces are checked by Marketing OS's mechanical gates (spec 13/14). Your renderer must hold the same floor — violations will fail review:

- **No dark patterns.** No countdown timers, no fabricated stock/viewer counts, no confirmshaming dismiss copy ("No thanks, I hate saving money"). Dismiss is one tap, plainly labeled, and remembered.
- **No layout shift.** Overlay, corner, drawer, or a reserved slot — never push content (CLS ≈ 0).
- **WCAG AA.** Contrast, focus-visible states, `aria-label`s, Escape closes an overlay, focus returns on close, `prefers-reduced-motion` respected.
- **Copy is verbatim.** Render `variant.content` as given — don't rewrite, truncate, or embellish; it's what the merchant approved.
- **One surface at a time.** Frequency and suppression are SDK-managed; don't build your own show/hide state.

## 6. Developing & testing locally

The runtime exposes a test hook — build against a fixture without the proxy:

```html
<script>
  // Force an arm (assignment is sticky per experiment id):
  localStorage.setItem("mos-surfaces:arm:EXP_ID", JSON.stringify({ arm: "v1", alloc: 1 }));
  // Inline manifest short-circuits the network fetch:
  window.MOS_MANIFEST = { version: "1", surfaces: [ /* fixture: copy one from config/surfaces.json */ ] };
</script>
<script src="surface-runtime.js"></script>
<script src="assets/mos-offer-renderer.js"></script>
```

Reset state between runs: clear `localStorage` keys prefixed `mos-surfaces:`. To preview each arm, re-seed the sticky key. On a dev theme, the app embed + a draft manifest behave identically to production.

**Definition of done for a renderer PR:** screenshots at 390/768/1440, all three states (initial, success, dismissed), keyboard-only walkthrough, reduced-motion check, and no console errors with the runtime absent (pre-init queue working).

## 7. Event glossary (what the SDK emits about your surface)

`exposure` (arm assigned, incl. control) → `impression` (your `mount`) → `engage` (capture attempt) → `capture` (consent written) · `dismiss`. These feed the experiment posteriors and the console's offer analytics — which is why `mount`/`dismiss`/`capture` must go through the controller.

---

*Questions or gaps in this contract: open an issue on `Avant-Garde-AI/marketing-os`. The SDK is versioned (`window.mos.version`); breaking changes ride the app-version release train.*
