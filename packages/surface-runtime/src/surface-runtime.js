/**
 * Marketing OS — Storefront Surface Runtime (spec 14, O0; extended OF3)
 * =======================================================
 * Zero dependencies. Server-driven. Fails invisible.
 *
 * Contract (spec 14 §1.1):
 *  - no external requests beyond the app proxy
 *  - zero CLS: overlay / corner-card / takeover only, never layout-shifting
 *  - WCAG AA, focus-managed, reduced-motion honored
 *  - any error → no surface, never a broken one
 *  - all decisions server-side; this file renders and reports
 *
 * Experiments (D2): bandit-native weighted-arm assignment, sticky per visitor.
 * Test hook: window.MOS_MANIFEST short-circuits the fetch (used by previews/tests).
 *
 * OF3 additions (spec 32 §5):
 *  - placement: "takeover" — full-screen, focus-trapped, scroll-locked
 *  - trigger.kind: "exit-intent" — desktop mouseout-toward-chrome; mobile has
 *    no mouseout, so a scroll-velocity heuristic stands in. NEITHER listens
 *    to popstate or pushes history — a history/back-button trap is the
 *    abusive version of this trigger and this runtime does not implement it.
 *  - teaser — a small re-open tab after a corner-card dismiss, strictly less
 *    aggressive than re-showing the modal; bypasses eligibility (the person
 *    already saw the offer this view) but never persists across page loads.
 *  - audience.targeting — device (viewport width), referrer, utm_source, and
 *    country (from a Liquid-rendered data attribute — Shopify has already
 *    resolved it server-side, so this costs no extra request), evaluated
 *    with data the runtime already has.
 *  - schedule — an ISO {from,to} campaign window, checked client-side.
 *
 * 0.6.0 (spec 34): manifest v2 steps/blocks in four compositions; context
 * cells; mobile search-arrival teaser; trigger arms; Klaviyo incumbent arm;
 * preview diagnostics (surface-diag.js). v1 manifests render unchanged.
 */
/**
 * CLIENT SDK (window.mos) — spec 14 §1.4:
 *   mos.ready(cb)                               // SDK booted, manifest evaluated
 *   mos.surfaces.register(type, renderer)       // theme claims rendering for a surface type
 *   renderer(controller) receives:
 *     controller.surface / .variant / .arm / .experimentId / .tokens
 *     controller.mount(el)      // theme-built element: SDK records the impression
 *     controller.dismiss()      // suppression + dismiss event, centrally managed
 *     controller.capture(email) // Promise<{ok}> — consent write + attribution + events
 *     controller.track(name)    // custom events into the same pipeline
 *   The SDK owns whether/what/when (eligibility, experiment, triggers,
 *   suppression); a renderer owns pixels only. Control-arm visitors never
 *   reach a renderer. The built-in card registers through this same API as
 *   the fallback — theme renderers (registered before the trigger fires)
 *   take precedence per surface type.
 */
(function () {
  "use strict";

  var NS = "mos-surfaces";
  var script = document.currentScript;
  var SRC = (script && script.src) || "";
  var PROXY = (script && script.dataset.mosProxy) || "/apps/mcp";
  var COUNTRY = (script && script.dataset.mosCountry) || "";
  var START = Date.now();

  /* ── tiny safe storage ─────────────────────────────────────────── */
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(NS + ":" + key));
      localStorage.setItem(NS + ":" + key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  /* ── identity & session ────────────────────────────────────────── */
  function visitorId() {
    var id = store("vid");
    if (!id) {
      id = "v" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      store("vid", id);
    }
    return id;
  }
  function bumpVisit() {
    var s = store("visits") || { count: 0, last: 0 };
    var now = Date.now();
    if (now - s.last > 30 * 60 * 1000) s.count += 1; // new session after 30m idle
    s.last = now;
    store("visits", s);
    return s.count;
  }

  /* ── weighted sticky assignment (bandit-native, D2) ────────────── */
  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }
  function find(list, pred) {
    for (var i = 0; list && i < list.length; i++) if (pred(list[i])) return list[i];
    return null;
  }
  function armDef(exp, key) {
    return find(exp && exp.arms, function (a) { return a.key === key; });
  }
  // Cell weights (OH6) apply to NEW assignments only; sticky always wins.
  function assign(exp, vid, cell) {
    var sticky = store("arm:" + exp.id);
    if (sticky && armDef(exp, sticky.arm)) return sticky;
    var w = ((exp.cells && exp.cells[cell]) || []).filter(function (a) { return armDef(exp, a.key) && a.weight > 0; });
    if (!w.length) w = exp.arms;
    var tot = 0;
    w.forEach(function (a) { tot += a.weight > 0 ? a.weight : 0; });
    var r = hash01(vid + ":" + exp.id) * (tot || 1);
    var acc = 0, arm = w[w.length - 1].key;
    for (var i = 0; i < w.length; i++) {
      acc += w[i].weight > 0 ? w[i].weight : 0;
      if (r < acc) { arm = w[i].key; break; }
    }
    var rec = { arm: arm, alloc: exp.allocation || 1 };
    store("arm:" + exp.id, rec);
    return rec;
  }

  /* ── events beacon ─────────────────────────────────────────────── */
  function send(path, payload, useBeacon) {
    try {
      var url = PROXY + path;
      var body = JSON.stringify(payload);
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return Promise.resolve({ ok: true });
      }
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      });
    } catch (e) { return Promise.resolve({ ok: false }); }
  }
  /* ── analytics mirror (GA4 / GTM / Shopify customer events) ────────
   * Every offer event also goes to the store's own analytics, so any store
   * can report on an offer test in GA4 without setup. GA4's promotion events
   * where they fit (view_promotion, select_promotion, generate_lead), custom
   * mos_offer_* events otherwise, and the visitor's arm as a user property —
   * set for control and incumbent visitors too, which is what makes the
   * holdback comparable in GA4. Uses the page's own gtag, else dataLayer (GTM),
   * and always Shopify.analytics.publish for custom pixels. Never sends an
   * email address or any free text; answers are the manifest's option values.
   * A manifest can opt out with `analytics: false`. */
  var GA_EVENTS = {
    exposure: "mos_offer_exposure",
    impression: "view_promotion",
    engage: "select_promotion",
    capture: "generate_lead",
    answer: "mos_offer_answer",
    step: "mos_offer_step",
    dismiss: "mos_offer_dismiss",
    teaser: "mos_offer_teaser",
  };
  var gaEngaged = {};
  function gaFire(name, p, userArm) {
    try {
      if (typeof window.gtag === "function") {
        if (userArm) window.gtag("set", "user_properties", { mos_offer_arm: userArm });
        window.gtag("event", name, p);
      } else if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push(Object.assign({ event: name }, p, userArm ? { mos_offer_arm: userArm } : {}));
      }
    } catch (e) { /* never break the storefront */ }
  }
  function mirror(surface, assignment, event, extra) {
    if (surface.analytics === false || !GA_EVENTS[event]) return;
    var arm = assignment && assignment.arm;
    var key = surface.id + ":" + arm;
    var p = {
      mos_offer_id: surface.id,
      mos_experiment_id: (surface.experiment && surface.experiment.id) || "",
      mos_arm: arm || "",
      mos_cell: CELL,
      promotion_id: surface.id,
      promotion_name: surface.title || surface.id,
      creative_name: arm || "",
      creative_slot: surface.placement || "corner-card",
    };
    if (extra) {
      if (extra.step != null) p.mos_step = extra.step;
      if (extra.answerKey) { p.mos_answer_key = extra.answerKey; p.mos_answer_value = extra.answerValue; }
      if (extra.vendor) p.mos_vendor = extra.vendor;
    }
    // select_promotion = the visitor's first interaction with the offer: a
    // quiz answer, a step, or the email submit — once per offer arm per page.
    if ((event === "engage" || event === "answer" || event === "step") && !gaEngaged[key]) {
      gaEngaged[key] = 1;
      gaFire("select_promotion", p);
    }
    if (event !== "engage") {
      var q = Object.assign({}, p);
      if (event === "capture") q.lead_source = "mos_offer";
      if (event === "exposure") q.non_interaction = true;
      gaFire(GA_EVENTS[event], q, event === "exposure" ? key : null);
    }
    try {
      if (window.Shopify && window.Shopify.analytics && typeof window.Shopify.analytics.publish === "function") {
        window.Shopify.analytics.publish("mos_offer_" + event, p);
      }
    } catch (e) { /* never break the storefront */ }
  }

  function track(surface, assignment, event, extra) {
    if (assignment && assignment.preview) return; // previews never touch the experiment's numbers
    mirror(surface, assignment, event, extra);
    send("/surfaces/events", Object.assign({
      surfaceId: surface.id,
      experimentId: surface.experiment && surface.experiment.id,
      arm: assignment && assignment.arm,
      allocation: assignment && assignment.alloc,
      event: event,
      visitorId: visitorId(),
      page: location.pathname,
      ts: Date.now(),
      cell: CELL,
    }, extra || {}), true);
  }

  /* ── page context ──────────────────────────────────────────────── */
  function pageType() {
    var p = location.pathname;
    if (p.indexOf("/products/") !== -1) return "product";
    if (p.indexOf("/collections/") !== -1) return "collection";
    if (p === "/" || p === "") return "home";
    if (p.indexOf("/cart") !== -1) return "cart";
    return "other";
  }
  function deviceType() { return innerWidth < 768 ? "mobile" : "desktop"; }
  function qparam(name) {
    var m = location.search.match(new RegExp("[?&]" + name + "=([^&]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* ── context cell (OH6): device.visit.source ───────────────────── */
  var CELL = "", SOURCE = "", PVIEWS = 0;
  function sourceClass() {
    var med = qparam("utm_medium").toLowerCase(), src = qparam("utm_source").toLowerCase(), host = "";
    try { host = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { host = "?"; }
    // Internal navigation keeps the source the visit arrived with.
    if (host && host === location.hostname) return store("src") || "direct";
    var s = med === "email" || src === "klaviyo" || src === "email" ? "email"
      : /^(cpc|paid|ppc)$/.test(med) ? "paid"
      : med === "social" ? "social"
      : med === "organic" ? "search"
      : qparam("gclid") ? "paid"
      : /(^|\.)(google|bing|duckduckgo|yahoo|ecosia)\./.test(host) ? "search"
      : /(^|\.)(facebook|instagram|twitter|pinterest|tiktok|reddit|linkedin)\.|^t\.co$|(^|\.)x\.com$/.test(host) ? "social"
      : qparam("fbclid") ? "paid"
      : host ? "other" : "direct";
    store("src", s);
    return s;
  }
  function productViews() {
    var seen = store("pviews") || [];
    var m = location.pathname.match(/\/products\/([^/?#]+)/);
    if (m && seen.indexOf(m[1]) === -1) { seen.push(m[1]); store("pviews", seen.slice(-50)); }
    return seen.length;
  }

  /* ── audience, targeting, schedule & suppression ───────────────── */
  function eligible(surface, visits) {
    var aud = surface.audience || {};
    if (aud.pages && aud.pages.length && aud.pages.indexOf(pageType()) === -1) return false;
    if (aud.newVisitorsOnly && visits > 3) return false;      // generous "new": first 3 sessions
    if (aud.excludeSubscribed && store("captured:" + surface.id)) return false;
    var sup = store("suppress:" + surface.id);
    if (sup && Date.now() < sup) return false;
    var shown = store("shown-session:" + surface.id);
    var max = (surface.trigger && surface.trigger.maxPerSession) || 1;
    if (shown && shown.session === sessionKey() && shown.count >= max) return false;
    if (!inWindow(surface)) return false;
    var t = aud.targeting;
    if (t) {
      if (t.devices && t.devices.length && t.devices.indexOf(deviceType()) === -1) return false;
      if (t.referrerContains && t.referrerContains.length &&
          !t.referrerContains.some(function (s) { return document.referrer.indexOf(s) !== -1; })) return false;
      if (t.utmSources && t.utmSources.length && t.utmSources.indexOf(qparam("utm_source")) === -1) return false;
      if (t.countries && t.countries.length && COUNTRY && t.countries.indexOf(COUNTRY) === -1) return false;
      if (t.returningOnly && visits < 2) return false;
    }
    return true;
  }
  function inWindow(surface) {
    var s = surface.schedule, now = Date.now();
    return !s || !((s.from && now < Date.parse(s.from)) || (s.to && now > Date.parse(s.to)));
  }
  function sessionKey() {
    var s = store("visits") || { count: 0 };
    return "s" + s.count;
  }
  function markShown(surface) {
    var k = sessionKey();
    var shown = store("shown-session:" + surface.id);
    if (!shown || shown.session !== k) shown = { session: k, count: 0 };
    shown.count += 1;
    store("shown-session:" + surface.id, shown);
  }
  function suppress(surface) {
    var days = (surface.trigger && surface.trigger.suppressAfterDismissDays) || 14;
    store("suppress:" + surface.id, Date.now() + days * 864e5);
  }

  /* ── client SDK: renderer registry + controller ────────────────── */
  var registry = {};   // type -> renderer (last registration wins; builtin is fallback)
  var builtin = {};
  var readyQ = [];
  var booted = false;

  var mos = (window.mos = window.mos || {});
  mos.version = "0.6.0";
  mos.ready = function (cb) { booted ? setTimeout(cb, 0) : readyQ.push(cb); };
  mos.surfaces = mos.surfaces || {};
  mos.surfaces.register = function (type, renderer, opts) {
    if (typeof renderer !== "function") return;
    if (opts && opts.builtin) builtin[type] = renderer;
    else registry[type] = { fn: renderer, placements: opts && opts.placements, versions: opts && opts.versions };
  };

  // Placements a theme renderer is assumed to handle when it declares none —
  // the set that existed before "takeover" (OF3). A renderer written against
  // SDK 0.2 cannot know about a placement added later, and silently rendering
  // a full-screen takeover as its corner card is worse than using the
  // built-in. Themes opt in: register("offer", fn, { placements: [...] }).
  var LEGACY_PLACEMENTS = ["corner-card", "overlay"];
  // Likewise manifest versions: a v1-era renderer would draw a v2 manifest
  // empty. Themes opt in: register("offer", fn, { versions: ["1", "2"] }).
  function pickRenderer(surface) {
    var r = registry[surface.type];
    if (r && (r.placements || LEGACY_PLACEMENTS).indexOf(surface.placement || "corner-card") !== -1 &&
        (r.versions || ["1"]).indexOf(surface.version || "1") !== -1) return r.fn;
    return builtin[surface.type];
  }

  function makeController(surface, assignment, variant) {
    var mounted = null;
    var ctl = {
      surface: surface,
      variant: variant,
      arm: assignment.arm,
      experimentId: surface.experiment && surface.experiment.id,
      tokens: (variant && variant.style) || {},
      cell: CELL,
      preview: !!assignment.preview,
      startStep: 0,
      track: function (name, extra) { track(surface, assignment, name, extra); },
      mount: function (el) {
        mounted = el || mounted;
        ctl.el = mounted;
        if (!assignment.preview) markShown(surface);
        track(surface, assignment, "impression");
      },
      dismiss: function (extra) {
        try { if (mounted && mounted.remove) mounted.remove(); } catch (e) { /* never break the storefront */ }
        if (!assignment.preview) suppress(surface);
        track(surface, assignment, "dismiss", extra);
      },
      // extra (v2): { answers, consentText }. Resolves { ok, reward }.
      capture: function (email, extra) {
        // A merchant previewing their own offer is not a subscriber: show the
        // success state, write nothing.
        if (assignment.preview) return Promise.resolve({ ok: true, reward: null });
        extra = extra || {};
        track(surface, assignment, "engage");
        return send("/surfaces/capture", {
          surfaceId: surface.id,
          experimentId: ctl.experimentId,
          arm: assignment.arm,
          cell: CELL,
          email: email,
          consentText: extra.consentText != null ? extra.consentText : (variant.content && variant.content.consent) || "",
          visitorId: visitorId(),
          page: location.pathname,
          answers: extra.answers || {},
        }).then(function (res) {
          if (!res || !res.ok) return { ok: false };
          return (res.json ? res.json() : Promise.resolve({})).catch(function () { return {}; }).then(function (b) {
            if (b && b.ok === false) return { ok: false };
            store("captured:" + surface.id, Date.now());
            track(surface, assignment, "capture");
            return { ok: true, reward: (b && b.reward) || null };
          });
        }).catch(function () { return { ok: false }; });
      },
    };
    return ctl;
  }

  /* ── built-in renderer (a client of the SDK, like any theme renderer) ── */
  var BASE_CSS =
    // all:initial resets font-family too, so without re-inheriting it every
    // card rendered in the browser default serif, not the theme's face.
    ":host{all:initial;font-family:inherit}" +
    "*{box-sizing:border-box;margin:0;padding:0;border-radius:0}" +
    ".card{font-family:var(--f,inherit);background:var(--bg,#fff);color:var(--ink,#1a1a1a);" +
    "border:1px solid var(--line,rgba(0,0,0,.14));box-shadow:0 12px 32px -8px rgba(0,0,0,.16);" +
    "padding:22px;max-width:340px;pointer-events:auto}" +
    ".eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent,#6b6b6b);margin-bottom:10px}" +
    ".h{font-size:19px;line-height:1.25;font-weight:500;margin-bottom:8px}" +
    ".b{font-size:13.5px;line-height:1.5;color:var(--ink2,rgba(26,26,26,.72));margin-bottom:14px}" +
    ".row{display:flex;gap:8px}" +
    "input[type=email]{flex:1;font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--line,rgba(0,0,0,.2));" +
    "background:transparent;color:inherit;min-width:0}" +
    "input[type=email]:focus{outline:1px solid var(--accent,#1a1a1a);outline-offset:1px}" +
    "button.cta{font:inherit;font-size:13.5px;font-weight:500;padding:10px 16px;cursor:pointer;border:0;" +
    "background:var(--ink,#1a1a1a);color:var(--bg,#fff)}" +
    "button.cta:disabled{opacity:.5}" +
    "button.x{position:absolute;top:8px;right:8px;width:32px;height:32px;font-size:16px;line-height:1;" +
    "cursor:pointer;border:0;background:transparent;color:var(--ink2,rgba(26,26,26,.6))}" +
    "button.x:focus-visible,button.cta:focus-visible{outline:1px solid var(--accent,#1a1a1a);outline-offset:2px}" +
    ".consent{font-size:10.5px;line-height:1.45;color:var(--ink2,rgba(26,26,26,.55));margin-top:10px}" +
    ".ok{font-size:14px;line-height:1.5;padding:6px 0}" +
    ".wrap{position:fixed;z-index:2147483000;pointer-events:none}" +
    ".wrap.corner{right:20px;bottom:20px}" +
    ".wrap.overlay,.wrap.takeover{inset:0;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(15,15,15,.45);pointer-events:auto}" +
    ".wrap.takeover{background:rgba(15,15,15,.6)}" +
    ".wrap.overlay .card{max-width:400px;position:relative}" +
    ".wrap.takeover .card{max-width:480px;width:calc(100% - 32px);position:relative;" +
    "max-height:calc(100vh - 48px);overflow:auto}" +
    ".wrap.corner .card{position:relative}" +
    "@media(max-width:480px){.wrap.corner{left:16px;right:16px;bottom:16px}.card{max-width:none}}" +
    // Takeover (OF3.1): an editorial split — image panel + copy column —
    // over a dimmed, softened page. Every value reads a brand token.
    ".wrap.takeover{padding:24px;background:rgba(20,18,26,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}" +
    ".wrap.takeover .card{padding:0;border:0;max-width:1040px;width:100%;max-height:calc(100vh - 48px);" +
    "display:grid;grid-template-columns:1.08fr 1fr;overflow:hidden;box-shadow:0 40px 90px -24px rgba(0,0,0,.5)}" +
    ".wrap.takeover .card:focus{outline:none}" +
    ".wrap.takeover .card.noimg{grid-template-columns:1fr;max-width:560px}" +
    ".media{position:relative;min-height:580px;background:var(--line,#ddd)}" +
    ".media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}" +
    ".media:after{content:'';position:absolute;left:0;right:0;bottom:0;height:34%;" +
    "background:linear-gradient(to top,rgba(0,0,0,.42),rgba(0,0,0,0));pointer-events:none}" +
    ".cap{position:absolute;z-index:1;left:22px;bottom:20px;right:22px;font-family:var(--fm,ui-monospace,monospace);font-size:10.5px;" +
    "letter-spacing:.16em;text-transform:uppercase;color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.5)}" +
    ".copy{padding:58px 54px 42px;display:flex;flex-direction:column;justify-content:center;overflow:auto;position:relative}" +
    ".wrap.takeover .eyebrow{font-family:var(--fm,ui-monospace,monospace);font-size:11px;letter-spacing:.2em;margin-bottom:20px}" +
    ".wrap.takeover .h{font-family:var(--fd,var(--f,Georgia,serif));font-size:42px;line-height:1.06;font-weight:500;letter-spacing:-.012em;margin-bottom:20px}" +
    ".h .acc{display:block;font-style:italic;font-weight:400}" +
    ".wrap.takeover .b{font-size:15.5px;line-height:1.62;margin-bottom:22px;max-width:40ch}" +
    ".pts{list-style:none;margin:0 0 28px;padding:0}" +
    ".pts li{font-size:14px;line-height:1.45;padding:10px 0;border-top:1px solid var(--line,rgba(0,0,0,.14));display:flex;gap:14px;align-items:center}" +
    ".pts li:last-child{border-bottom:1px solid var(--line,rgba(0,0,0,.14))}" +
    ".pts li:before{content:'';width:16px;height:1px;background:var(--accent,#1a1a1a);flex:none}" +
    ".wrap.takeover input[type=email]{border:0;border-bottom:1px solid var(--ink,#1a1a1a);padding:12px 2px;font-size:15px}" +
    ".wrap.takeover input[type=email]:focus{outline:none;border-bottom-color:var(--accent,#1a1a1a);box-shadow:0 1px 0 var(--accent,#1a1a1a)}" +
    ".wrap.takeover button.cta{padding:13px 24px;font-size:14px;letter-spacing:.02em}" +
    ".wrap.takeover .consent{margin-top:14px}" +
    ".dec{margin-top:18px;align-self:flex-start;background:none;border:0;padding:4px 0;font:inherit;font-size:12.5px;" +
    "color:var(--ink2,rgba(26,26,26,.6));text-decoration:underline;text-underline-offset:3px;cursor:pointer}" +
    ".dec:focus-visible{outline:1px solid var(--accent,#1a1a1a);outline-offset:2px}" +
    ".wrap.takeover button.x{top:12px;right:12px;width:40px;height:40px;font-size:22px;z-index:2}" +
    ".wrap.takeover .ok{font-family:var(--fd,Georgia,serif);font-size:26px;line-height:1.3;padding:8px 0}" +
    "@media(max-width:760px){.wrap.takeover{padding:0;align-items:stretch}" +
    ".wrap.takeover .card{grid-template-columns:1fr;max-height:none;height:100%;max-width:none;overflow:auto;display:block}" +
    // Phone: the CTA has to clear the fold on a 390x844 screen, so the image
    // gives up height and the list tightens rather than the type shrinking.
    ".media{min-height:0;height:28vh}.copy{padding:22px 24px 30px}" +
    ".wrap.takeover .eyebrow{margin-bottom:12px}.wrap.takeover .h{font-size:29px;margin-bottom:12px}" +
    ".wrap.takeover .b{font-size:15px;line-height:1.55;margin-bottom:14px}" +
    ".pts{margin-bottom:18px}.pts li{padding:7px 0;font-size:13.5px}" +
    ".wrap.takeover button.x{background:rgba(255,255,255,.85)}}" +
    // Motion, only for those who have not asked for less: the room settles
    // into place slowly; the copy arrives a line at a time.
    "@media(prefers-reduced-motion:no-preference){.wrap.takeover{animation:mosfade .3s ease both}" +
    ".media img{animation:mosdrift 9s cubic-bezier(.16,1,.3,1) both}" +
    ".copy>*{animation:mosrise .55s cubic-bezier(.16,1,.3,1) both}" +
    ".copy>:nth-child(2){animation-delay:.06s}.copy>:nth-child(3){animation-delay:.12s}" +
    ".copy>:nth-child(4){animation-delay:.18s}.copy>:nth-child(5){animation-delay:.24s}" +
    ".copy>:nth-child(n+6){animation-delay:.3s}" +
    "@keyframes mosfade{from{opacity:0}to{opacity:1}}" +
    "@keyframes mosdrift{from{transform:scale(1.06)}to{transform:scale(1)}}" +
    "@keyframes mosrise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}" +
    "@media(prefers-reduced-motion:no-preference){.card{animation:mosin .28s cubic-bezier(.16,1,.3,1) both}" +
    "@keyframes mosin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}}";

  var TEASER_CSS =
    ":host{all:initial}*{box-sizing:border-box;margin:0;padding:0}" +
    ".teaser{position:fixed;z-index:2147483000;right:20px;bottom:20px;font:inherit;font-size:12.5px;" +
    "font-weight:500;padding:10px 16px;border:1px solid rgba(0,0,0,.14);background:#fff;color:#1a1a1a;" +
    "cursor:pointer;box-shadow:0 8px 20px -6px rgba(0,0,0,.18)}" +
    ".teaser:focus-visible{outline:1px solid #1a1a1a;outline-offset:2px}" +
    "@media(max-width:480px){.teaser{right:16px;bottom:16px}}" +
    "@media(prefers-reduced-motion:no-preference){.teaser{animation:mosin .22s cubic-bezier(.16,1,.3,1) both}" +
    "@keyframes mosin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Brand tokens → CSS custom properties; never free CSS from the manifest.
  var TOKENS = { bg: "bg", ink: "ink", ink2: "ink2", accent: "accent", line: "line", font: "f", fontDisplay: "fd", fontMono: "fm" };
  function tokenVars(st) {
    var out = "";
    st = st || {};
    for (var k in TOKENS) if (st[k]) out += "--" + TOKENS[k] + ":" + st[k] + ";";
    return out;
  }

  var DIAG = false, DIAG_ERR = [];
  var NOANIM = "*,:after,:before{animation:none!important;transition:none!important}";
  function oops(e) { if (DIAG) DIAG_ERR.push(String((e && e.message) || e)); }
  function coarse() { return !!(window.matchMedia && matchMedia("(pointer: coarse)").matches); }

  /** Trap Tab/Shift-Tab within a modal's focusable elements (takeover +
   * overlay). Returns a cleanup fn. */
  function trapFocus(card) {
    function handler(ev) {
      if (ev.key !== "Tab") return;
      var focusables = card.querySelectorAll("input,button,a[href]");
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    card.addEventListener("keydown", handler);
    return function () { card.removeEventListener("keydown", handler); };
  }

  /** The store's own Shopify CDN is the only image origin a surface may
   * use — the runtime makes no third-party requests (spec 14 §1.1). The
   * manifest compiler and the platform validator refuse others too; this is
   * the last of three checks, in the browser. */
  var IMAGE_ORIGIN = "https://cdn.shopify.com/";
  function safeImage(src) {
    return typeof src === "string" && src.indexOf(IMAGE_ORIGIN) === 0 ? src : null;
  }

  function renderCard(ctl) {
    var surface = ctl.surface, variant = ctl.variant;
    var isModal = surface.placement === "overlay" || surface.placement === "takeover";
    var host = el("div");
    host.setAttribute("data-mos-surface", surface.id);
    var root = host.attachShadow({ mode: "open" });

    var styleVars = tokenVars(variant.style);

    var styleEl = el("style");
    styleEl.textContent = BASE_CSS;
    root.appendChild(styleEl);

    var placementClass = surface.placement === "overlay" ? "overlay" : surface.placement === "takeover" ? "takeover" : "corner";
    var wrap = el("div", "wrap " + placementClass);
    wrap.setAttribute("style", styleVars);
    var card = el("div", "card");
    card.setAttribute("role", isModal ? "dialog" : "complementary");
    card.setAttribute("aria-label", (variant.content && variant.content.headline) || "Offer");
    if (isModal) card.setAttribute("aria-modal", "true");

    var c = variant.content || {};
    var x = el("button", "x", "×");
    x.setAttribute("aria-label", "Dismiss");
    card.appendChild(x);

    // Takeover: image panel + copy column. Everything else keeps the flat card.
    var isTakeover = surface.placement === "takeover";
    var body = card;
    if (isTakeover) {
      var src = safeImage(c.imageSrc);
      if (src) {
        var media = el("div", "media");
        var img = el("img");
        img.alt = c.imageAlt || "";
        img.decoding = "async";
        if (c.imageFocus) img.style.objectPosition = c.imageFocus;
        img.onerror = function () { try { media.remove(); card.classList.add("noimg"); } catch (e) { /* never break the storefront */ } };
        img.src = src;
        media.appendChild(img);
        if (c.imageCaption) media.appendChild(el("div", "cap", c.imageCaption));
        card.appendChild(media);
      } else {
        card.classList.add("noimg");
      }
      body = el("div", "copy");
      card.appendChild(body);
    }
    if (c.eyebrow) body.appendChild(el("div", "eyebrow", c.eyebrow));
    if (c.headline) {
      var h = el("div", "h", c.headline);
      if (c.headlineAccent) h.appendChild(el("span", "acc", c.headlineAccent));
      body.appendChild(h);
    }
    if (c.body) body.appendChild(el("div", "b", c.body));
    if (c.points) {
      var pts = el("ul", "pts");
      String(c.points).split("|").slice(0, 3).forEach(function (t) {
        if (t.trim()) pts.appendChild(el("li", null, t.trim()));
      });
      body.appendChild(pts);
    }

    var form = el("form");
    var row = el("div", "row");
    var input = el("input");
    input.type = "email";
    input.required = true;
    input.autocomplete = "email";
    input.placeholder = c.placeholder || "Email address";
    input.setAttribute("aria-label", "Email address");
    var cta = el("button", "cta", c.cta || "Join");
    cta.type = "submit";
    row.appendChild(input);
    row.appendChild(cta);
    form.appendChild(row);
    body.appendChild(form);
    if (c.consent) body.appendChild(el("div", "consent", c.consent));
    var dec = null;
    if (c.decline) {
      dec = el("button", "dec", c.decline);
      dec.type = "button";
      body.appendChild(dec);
    }

    wrap.appendChild(card);
    root.appendChild(wrap);

    // Scroll lock: takeover only (a corner-card / overlay never covers
    // enough of the page to need it, and locking on overlay would fight a
    // theme's own scroll-based UI more than it helps).
    var prevOverflow = null;
    if (surface.placement === "takeover") {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    var untrap = isModal ? trapFocus(card) : null;

    function restore() {
      if (prevOverflow !== null) document.body.style.overflow = prevOverflow;
      if (untrap) untrap();
    }

    function close(reason) {
      restore();
      document.removeEventListener("keydown", onKeydown);
      if (reason === "dismiss") {
        ctl.dismiss(); // removes `host` itself (mounted === host)
        if (surface.teaser && surface.teaser.enabled && surface.placement === "corner-card") {
          renderTeaser(ctl);
        }
      } else {
        try { host.remove(); } catch (e) { /* never break the storefront */ }
      }
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* never break the storefront */ } }
    }

    x.addEventListener("click", function () { close("dismiss"); });
    if (dec) dec.addEventListener("click", function () { close("dismiss"); });
    if (isModal) {
      wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close("dismiss"); });
    }
    // Bound once per render and always removed in close() (whichever path
    // gets there) — the original keydown-removes-itself-on-Escape-only
    // pattern leaked a listener per render whenever a card was dismissed by
    // the X or a backdrop click instead, which OF3's teaser reopen loop
    // would otherwise compound.
    function onKeydown(ev) { if (ev.key === "Escape") close("dismiss"); }
    document.addEventListener("keydown", onKeydown);

    var busy = false;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      busy = true;
      cta.disabled = true;
      cta.textContent = "…";
      ctl.capture(input.value).then(function (res) {
        if (res && res.ok) {
          form.replaceWith(el("div", "ok", c.success || "You’re on the list."));
          setTimeout(function () { close("done"); }, 3200);
        } else {
          busy = false;
          cta.disabled = false;
          cta.textContent = c.cta || "Join";
          input.setAttribute("aria-invalid", "true");
          input.placeholder = "That didn’t go through — try again";
          input.value = "";
        }
      });
    });

    var prevFocus = document.activeElement;
    document.body.appendChild(host);
    ctl.mount(host);
    if (isModal) {
      // Focus belongs inside the dialog, but on a touch device focusing the
      // email field opens the keyboard before anyone has read a word, and
      // scrolls the image away. Focus the dialog there; keyboards get the field.
      try {
        if (window.matchMedia && matchMedia("(pointer: coarse)").matches) {
          card.setAttribute("tabindex", "-1");
          card.focus({ preventScroll: true });
        } else {
          input.focus({ preventScroll: true });
        }
      } catch (e) { /* never break the storefront */ }
    }
    return host;
  }

  /** The re-open tab after a corner-card dismiss (OF3). Bypasses
   * eligibility on purpose — the visitor already saw the offer this page
   * view and is asking to see it again; it does not persist across page
   * loads, so it never becomes a second suppression loophole. */
  function renderTeaser(ctl) {
    var surface = ctl.surface;
    var host = el("div");
    host.setAttribute("data-mos-surface", surface.id + "-teaser");
    var root = host.attachShadow({ mode: "open" });
    var styleEl = el("style");
    styleEl.textContent = TEASER_CSS;
    root.appendChild(styleEl);
    var c = ctl.variant.content || {};
    var tab = el("button", "teaser", c.eyebrow || c.cta || "Offer");
    tab.type = "button";
    tab.setAttribute("aria-label", "Reopen: " + (c.headline || "offer"));
    tab.addEventListener("click", function () {
      try { host.remove(); } catch (e) { /* never break the storefront */ }
      renderCard(ctl);
    });
    root.appendChild(tab);
    document.body.appendChild(host);
  }

  /* ── manifest v2: compositions (spec 34 §2.3) ──────────────────── */
  // Phone first (corner ≤85vw, overlay = bottom sheet, takeover = full
  // screen); desktop in the min-width block. Colors and faces are tokens.
  var V2_CSS =
    ":host{all:initial;font-family:inherit}" +
    "*{box-sizing:border-box;margin:0;padding:0;border-radius:0}" +
    ".wrap{--bg:#fff;--ink:#1a1a1a;--ink2:rgba(26,26,26,.72);--accent:#1a1a1a;--line:rgba(0,0,0,.14);position:fixed;z-index:2147483000;font-family:var(--f,inherit);color:var(--ink);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}" +
    ".corner{left:0;right:0;bottom:12px;display:flex;justify-content:center;pointer-events:none}" +
    ".overlay,.takeover{inset:0;display:flex;align-items:flex-end;background:rgba(20,18,26,.42)}" +
    ".takeover{align-items:stretch;background:rgba(20,18,26,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}" +
    ".card{position:relative;display:flex;flex-direction:column;width:100%;max-height:92vh;overflow:auto;pointer-events:auto;" +
    "background:var(--bg);color:var(--ink);box-shadow:0 30px 70px -24px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.06)}" +
    ".corner .card{width:85vw;max-height:80vh}.takeover .card{max-height:none}.card:focus{outline:none}" +
    ".media{position:relative;flex:none;height:22vh;overflow:hidden;background:var(--line)}" +
    ".takeover .media{height:auto;flex:1 0 26vh}.takeover .copy{flex:0 0 auto}.noimg .copy{flex:1 0 auto}.corner .media{height:96px}" +
    ".media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.noimg .media{display:none}" +
    ".cap{position:absolute;z-index:1;left:18px;right:64px;bottom:16px;font-family:var(--fm,ui-monospace,monospace);font-size:10px;" +
    "letter-spacing:.16em;text-transform:uppercase;color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.5)}" +
    ".hc:after{content:'';position:absolute;left:0;right:0;bottom:0;height:45%;background:linear-gradient(to top,rgba(0,0,0,.42),transparent)}" +
    ".corner .cap,.corner .hc:after{display:none}" +
    ".copy{position:relative;flex:1 0 auto;display:flex;flex-direction:column;justify-content:center;min-width:0;padding:26px 22px 22px}" +
    ".corner .copy{padding:20px 18px 14px}.corner .opts{gap:6px}.corner .opt{min-height:46px;padding:10px 16px;font-size:14.5px}.corner .prog{margin-bottom:14px}.copy>:first-child{padding-right:40px}" +
    ".eyebrow{font-family:var(--fm,ui-monospace,monospace);font-size:10.5px;line-height:1.4;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:12px}" +
    ".h{font-family:var(--fd,var(--f,Georgia,serif));font-size:27px;line-height:1.08;font-weight:500;letter-spacing:-.01em;margin-bottom:12px;text-wrap:balance}" +
    ".corner .h{font-size:21px;line-height:1.15;margin-bottom:8px}.takeover .h{font-size:31px}" +
    ".h .acc{display:block;font-style:italic;font-weight:400}" +
    ".b{font-size:15px;line-height:1.55;color:var(--ink2);margin-bottom:18px;max-width:44ch;text-wrap:pretty}" +
    ".corner .b{font-size:13.5px;line-height:1.5;margin-bottom:14px}" +
    ".pts{list-style:none;margin:-2px 0 20px}" +
    ".pts li{display:flex;gap:14px;align-items:center;padding:8px 0;font-size:13.5px;line-height:1.4;border-top:1px solid var(--line)}" +
    ".pts li:last-child{border-bottom:1px solid var(--line)}" +
    ".pts li:before{content:'';flex:none;width:14px;height:1px;background:var(--accent)}" +
    ".prog{display:flex;align-items:center;gap:14px;margin-bottom:20px;font-family:var(--fm,ui-monospace,monospace);font-size:10px;" +
    "letter-spacing:.18em;text-transform:uppercase;color:var(--ink2)}" +
    ".bar{position:relative;flex:0 1 96px;height:2px;background:var(--line)}" +
    ".bar i{position:absolute;left:0;top:0;bottom:0;background:var(--accent);transition:width .6s cubic-bezier(.16,1,.3,1)}" +
    ".q{font-size:14.5px;line-height:1.4;font-weight:500;margin-bottom:12px}" +
    ".opts{display:grid;gap:8px;margin-bottom:14px}" +
    ".opt{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:12px 18px;font:inherit;" +
    "font-size:15px;line-height:1.3;text-align:left;color:inherit;background:transparent;border:1px solid var(--line);cursor:pointer;" +
    "transition:border-color .2s,background-color .2s,color .2s}" +
    ".opt:after{content:'→';color:var(--accent);transition:transform .25s}" +
    ".opt:hover{border-color:var(--ink)}.opt:hover:after{transform:translateX(3px)}" +
    ".opt.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}.opt.on:after{color:inherit}" +
    ".row{display:flex;flex-direction:column;gap:10px}.corner .row{flex-flow:row wrap}.corner input{flex:1 1 150px}.corner .cta{flex:1 0 auto}" +
    "input{flex:1 1 auto;min-width:0;height:48px;padding:0 2px;font:inherit;font-size:16px;color:inherit;background:transparent;border:0;" +
    "border-bottom:1px solid var(--ink);-webkit-appearance:none;appearance:none}" +
    "input::placeholder{color:var(--ink2);opacity:1}" +
    "input:focus{outline:none;border-bottom-color:var(--accent);box-shadow:0 1px 0 var(--accent)}" +
    ".cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;font:inherit;font-size:14.5px;" +
    "font-weight:500;letter-spacing:.02em;line-height:1.2;text-align:center;text-decoration:none;white-space:nowrap;cursor:pointer;border:0;" +
    "background:var(--ink);color:var(--bg);transition:opacity .2s}" +
    ".cta:hover{opacity:.86}.cta:disabled{opacity:.5;cursor:default}.copy>.cta{margin-top:4px}" +
    ".consent{margin-top:12px;font-size:11.5px;line-height:1.5;color:var(--ink2);max-width:56ch}" +
    // Decline: small text, full 44px hit area. Neutral by contract.
    ".dec{align-self:flex-start;min-height:44px;min-width:44px;margin:4px 0 -10px;padding:0;font:inherit;font-size:13px;" +
    "color:var(--ink2);background:none;border:0;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer}" +
    // Close: present and reachable from the first frame — never delayed.
    ".x{position:absolute;z-index:3;top:6px;right:6px;width:44px;height:44px;border:0;cursor:pointer;color:var(--ink);background:var(--bg)}" +
    ".x:before,.x:after{content:'';position:absolute;left:13px;top:21px;width:18px;height:1.5px;background:currentColor;transform:rotate(45deg)}" +
    ".x:after{transform:rotate(-45deg)}" +
    "button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".code{display:flex;margin:2px 0 14px;border:1px dashed var(--ink)}" +
    ".code b{flex:1;display:flex;align-items:center;min-width:0;padding:10px 16px;font-family:var(--fm,ui-monospace,monospace);font-size:20px;" +
    "font-weight:500;letter-spacing:.12em;overflow-wrap:anywhere}" +
    ".cp{flex:none;min-width:80px;min-height:52px;padding:0 16px;font:inherit;font-size:13px;font-weight:500;color:inherit;background:none;" +
    "border:0;border-left:1px dashed var(--ink);cursor:pointer}" +
    ".lnk{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;font-size:13.5px;color:inherit;text-decoration:underline;text-underline-offset:3px}" +
    ".picks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:4px 0 18px}" +
    ".pick{display:block;min-height:44px;font-size:12.5px;line-height:1.35;color:inherit;text-decoration:none}" +
    ".pick img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;margin-bottom:8px;background:var(--line)}" +
    ".c-full .media{height:26vh}.corner.c-full .media{height:150px}" +
    ".c-full .copy{margin:-40px 12px 0;background:var(--bg)}" +
    ".c-full .cap{top:18px;bottom:auto}.c-full .hc:after{top:0;bottom:auto;background:linear-gradient(to bottom,rgba(0,0,0,.36),transparent)}" +
    ".c-editorial .card:before{content:'';position:absolute;inset:8px;border:1px solid var(--line);pointer-events:none}" +
    ".c-editorial .x{top:12px;right:12px}.c-editorial .copy{padding:40px 30px 30px}" +
    ".c-editorial .h{font-size:34px;line-height:1.02}.corner.c-editorial .h{font-size:25px}.takeover.c-editorial .h{font-size:40px}" +
    ".c-editorial .eyebrow{display:flex;align-items:center;gap:14px}" +
    ".c-editorial .eyebrow:after{content:'';flex:1;height:1px;background:var(--line)}" +
    ".noimg .copy{margin:0}" +
    "@media(min-width:768px){" +
    ".corner{left:auto;right:24px;bottom:24px;display:block}" +
    ".overlay,.takeover{align-items:center;justify-content:center;padding:24px}" +
    ".card{max-height:calc(100vh - 48px);overflow:hidden}" +
    ".corner .card{width:380px}.overlay .card{width:480px}.takeover .card{width:600px;max-height:calc(100vh - 48px)}" +
    ".copy{flex:1 1 auto;overflow:auto;padding:40px 40px 34px}" +
    ".corner .copy{padding:26px 24px 20px}.takeover .copy{padding:56px 56px 46px}" +
    ".media,.takeover .media{height:220px;flex:none}.corner .media{height:150px}.takeover .copy{flex:1 1 auto}.takeover.c-card .card{width:640px}.takeover.c-card .media{height:240px}" +
    ".row{flex-direction:row}.copy>.cta{align-self:flex-start}" +
    ".eyebrow{font-size:11px;margin-bottom:16px}.corner .eyebrow{font-size:10.5px;margin-bottom:12px}" +
    ".h{font-size:34px;line-height:1.06;margin-bottom:14px}.corner .h{font-size:23px;line-height:1.14;margin-bottom:10px}" +
    ".takeover .h{font-size:44px;line-height:1.04;letter-spacing:-.015em;margin-bottom:18px}" +
    ".b{font-size:15.5px;line-height:1.6;margin-bottom:22px}.corner .b{font-size:14px;line-height:1.52;margin-bottom:16px}" +
    ".takeover .b{font-size:16px;line-height:1.62;margin-bottom:26px}" +
    ".pts li{padding:10px 0;font-size:14px}.takeover .x{top:12px;right:12px}" +
    ".c-split .card{flex-direction:row}" +
    ".c-split .media{height:auto;flex:0 0 44%}.takeover.c-split .media{flex-basis:50%}.corner.c-split .media{flex-basis:36%}" +
    ".corner.c-split .card{width:540px}.overlay.c-split .card{width:840px;min-height:500px}" +
    ".takeover.c-split .card,.takeover.c-full .card{width:1040px;min-height:620px}" +
    ".overlay.c-full .card{width:780px;min-height:540px}" +
    ".overlay.c-full .card,.takeover.c-full .card{flex-direction:row;align-items:flex-end}" +
    ".overlay.c-full .media,.takeover.c-full .media{position:absolute;inset:0;height:auto}" +
    ".overlay.c-full .copy{flex:none;width:420px;max-height:calc(100% - 64px);margin:32px}" +
    ".takeover.c-full .copy{flex:none;width:480px;max-height:calc(100% - 96px);margin:48px;padding:48px 46px 38px}" +
    ".corner.noimg .card{width:380px}.overlay.noimg .card{width:480px}.takeover.noimg .card{width:600px}.wrap.noimg .card{min-height:0}" +
    ".noimg.c-full .copy{flex:1 1 auto;width:auto;max-height:none;margin:0}" +
    ".overlay.c-full .cap,.takeover.c-full .cap{top:auto;bottom:18px;left:auto;right:22px}" +
    ".overlay.c-full .hc:after,.takeover.c-full .hc:after{top:auto;bottom:0;background:linear-gradient(to top,rgba(0,0,0,.36),transparent)}" +
    ".overlay.c-editorial .card{width:600px}.takeover.c-editorial .card{width:780px}" +
    ".c-editorial .card:before{inset:10px}.c-editorial .x{top:16px;right:16px}" +
    ".c-editorial .copy{padding:52px 56px 42px}.corner.c-editorial .copy{padding:34px 32px 26px}.takeover.c-editorial .copy{padding:84px 88px 64px}" +
    ".c-editorial .h{font-size:48px;line-height:1}.corner.c-editorial .h{font-size:28px;line-height:1.06}" +
    ".takeover.c-editorial .h{font-size:68px;line-height:.98;letter-spacing:-.02em}}" +
    // Desktop takeover = the whole screen (the premium popup format: Alia,
    // Pupford, FringeSport). The offer IS the page for a moment — no card
    // floating over a dimmed store. Image-led compositions split the screen;
    // type-led ones set one column of large type on the brand ground.
    "@media(min-width:768px){" +
    ".wrap.takeover{padding:0;background:var(--bg);-webkit-backdrop-filter:none;backdrop-filter:none}" +
    ".wrap.takeover .card{width:100vw;max-width:none;height:100vh;max-height:none;min-height:0;box-shadow:none;border:0}" +
    ".wrap.takeover .x{position:fixed;top:22px;right:24px;z-index:3}" +
    ".wrap.takeover .copy{display:flex;flex-direction:column;justify-content:center;padding:9vh 6vw;overflow:auto}" +
    ".wrap.takeover .copy>*{width:100%;max-width:540px}" +
    ".wrap.takeover .copy>.dec{text-align:left}" +
    ".wrap.takeover .h{font-size:clamp(46px,4.3vw,76px);line-height:1;letter-spacing:-.02em;margin-bottom:22px}" +
    ".wrap.takeover .b{font-size:17px;line-height:1.62;max-width:46ch;margin-bottom:28px}" +
    ".wrap.takeover.c-split .card,.wrap.takeover.c-card .card{flex-direction:row}" +
    ".wrap.takeover.c-split .media,.wrap.takeover.c-card .media{flex:0 0 52%;height:auto}" +
    ".wrap.takeover.c-full .copy{flex:none;width:min(560px,44vw);max-height:calc(100vh - 12vh);margin:6vh 6vw;padding:56px 52px 44px;justify-content:flex-start}" +
    ".wrap.takeover.c-full .copy>*{max-width:none}" +
    ".wrap.takeover.c-editorial .card:before{inset:18px}" +
    ".wrap.takeover.c-editorial .copy{align-items:center;padding:12vh 8vw}" +
    ".wrap.takeover.c-editorial .copy>*{max-width:720px}" +
    ".wrap.takeover.c-editorial .h{font-size:clamp(56px,5.6vw,104px);line-height:.96}" +
    ".wrap.takeover.noimg .card{width:100vw}}" +
    "@media(prefers-reduced-motion:no-preference){" +
    ".overlay,.takeover{animation:mf .3s ease both}.card{animation:mi .5s cubic-bezier(.16,1,.3,1) both}" +
    ".media img{animation:md 9s cubic-bezier(.16,1,.3,1) both}.copy>*{animation:mr .55s cubic-bezier(.16,1,.3,1) both}" +
    ".copy>:nth-child(2){animation-delay:.05s}.copy>:nth-child(3){animation-delay:.1s}.copy>:nth-child(4){animation-delay:.15s}" +
    ".copy>:nth-child(5){animation-delay:.2s}.copy>:nth-child(n+6){animation-delay:.25s}" +
    "@keyframes mf{from{opacity:0}}@keyframes mi{from{opacity:0;transform:translateY(16px)}}" +
    "@keyframes md{from{transform:scale(1.06)}}@keyframes mr{from{opacity:0;transform:translateY(8px)}}}";

  var PILL_CSS =
    ":host{all:initial}" +
    ".pill{--bg:#fff;--ink:#1a1a1a;--accent:#fff;position:fixed;z-index:2147483000;right:16px;bottom:16px;display:flex;align-items:center;gap:12px;min-height:48px;" +
    "max-width:calc(100vw - 32px);padding:0 20px;border:0;cursor:pointer;font-family:var(--f,inherit);font-size:14px;font-weight:500;" +
    "letter-spacing:.01em;white-space:nowrap;background:var(--ink);color:var(--bg);box-shadow:0 14px 34px -10px rgba(0,0,0,.4)}" +
    ".pill:before{content:'';flex:none;width:7px;height:7px;border-radius:50%;background:var(--accent)}" +
    ".pill:after{content:'';flex:none;width:7px;height:7px;margin-left:2px;border-top:1.5px solid;border-left:1.5px solid;transform:translateY(2px) rotate(45deg)}" +
    ".pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    "@media(min-width:768px){.pill{right:24px;bottom:24px}}" +
    "@media(prefers-reduced-motion:no-preference){.pill{animation:mi .4s cubic-bezier(.16,1,.3,1) both}" +
    "@keyframes mi{from{opacity:0;transform:translateY(10px)}}}";

  var COMPS = { "split-image": "split", "full-bleed-image": "full", "editorial-type": "editorial", card: "card" };
  function ofKind(step, kind) {
    return find((step && step.blocks) || [], function (b) { return b.kind === kind; });
  }
  // A reward/pick link may only point back into this store.
  function safeHref(h) { return typeof h === "string" && /^\/(?![/\\])/.test(h) ? h : null; }

  function renderV2(ctl) {
    var surface = ctl.surface, variant = ctl.variant, steps = variant.steps;
    if (!Array.isArray(steps) || !steps.length) return null;
    var place = surface.placement === "overlay" || surface.placement === "takeover" ? surface.placement : "corner";
    var isModal = place !== "corner";
    var comp = COMPS[variant.composition] || "card";
    var answers = {}, reward = null, captured = false, idx = 0, busy = false, curSrc;
    var start = Math.min(Math.max(ctl.startStep | 0, 0), steps.length - 1);
    // mos_step previews: earlier choices take their first option.
    for (var i = 0; i < start; i++) {
      var pc = ofKind(steps[i], "choice");
      if (pc && pc.options && pc.options[0]) answers[pc.answerKey] = pc.options[0].value;
      if (ofKind(steps[i], "email")) captured = true;
    }

    var host = el("div");
    host.setAttribute("data-mos-surface", surface.id);
    var root = host.attachShadow({ mode: "open" });
    var css = el("style");
    css.textContent = V2_CSS + (DIAG ? NOANIM : "");
    root.appendChild(css);
    var wrap = el("div", "wrap " + place + " c-" + comp);
    wrap.setAttribute("style", tokenVars(variant.style));
    var card = el("div", "card");
    card.setAttribute("role", isModal ? "dialog" : "complementary");
    if (isModal) card.setAttribute("aria-modal", "true");
    var x = el("button", "x");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    var media = el("div", "media"), copy = el("div", "copy");
    card.appendChild(x);
    card.appendChild(media);
    card.appendChild(copy);
    wrap.appendChild(card);
    root.appendChild(wrap);

    // The step's image, else the last one shown, so the layout holds still.
    function imageFor(n) {
      if (comp === "editorial") return null;
      for (var j = n; j >= 0; j--) {
        var b = ofKind(steps[j], "image");
        if (b) return b.mobile === "drop" && deviceType() === "mobile" ? null : b;
      }
      return null;
    }
    function setMedia(b) {
      var src = b && safeImage(b.src);
      if (b && !src) oops("image refused (not cdn.shopify.com): " + b.src);
      wrap.classList.toggle("noimg", !src);
      if (src === curSrc) return;
      curSrc = src;
      media.textContent = "";
      media.className = "media" + (src && b.caption ? " hc" : "");
      if (!src) return;
      var img = el("img");
      img.alt = b.alt || "";
      img.decoding = "async";
      if (b.focus) img.style.objectPosition = b.focus;
      img.onerror = function () { oops("image failed: " + src); curSrc = null; media.textContent = ""; wrap.classList.add("noimg"); };
      img.src = src;
      media.appendChild(img);
      if (b.caption) media.appendChild(el("div", "cap", b.caption));
    }

    function progress(n) {
      var p = el("div", "prog"), bar = el("span", "bar"), fill = el("i");
      p.appendChild(el("span", null, "Step " + (n + 1) + " of " + steps.length));
      fill.style.width = (n / steps.length * 100) + "%";
      setTimeout(function () { fill.style.width = ((n + 1) / steps.length * 100) + "%"; }, DIAG ? 0 : 60);
      bar.appendChild(fill);
      p.appendChild(bar);
      return p;
    }

    function choice(b) {
      var g = el("div", "ch"), opts = el("div", "opts");
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", b.question || "");
      if (b.question) g.appendChild(el("p", "q", b.question));
      var list = (b.options || []).slice(0, 4);
      if (list.length === 4 && deviceType() === "desktop") opts.style.gridTemplateColumns = "1fr 1fr";
      list.forEach(function (o) {
        var btn = el("button", "opt", o.label);
        btn.type = "button";
        btn.addEventListener("click", function () {
          if (busy) return;
          busy = true;
          answers[b.answerKey] = o.value;
          btn.classList.add("on");
          ctl.track("answer", { answerKey: b.answerKey, answerValue: o.value, step: idx });
          setTimeout(function () { busy = false; next(); }, DIAG ? 0 : 220);
        });
        opts.appendChild(btn);
      });
      g.appendChild(opts);
      return g;
    }

    function emailForm(b, consent) {
      var f = el("form", "row"), input = el("input"), btn = el("button", "cta", b.cta || "Join");
      input.type = "email";
      input.name = "email";
      input.required = true;
      input.autocomplete = "email";
      input.placeholder = b.placeholder || "Email address";
      input.setAttribute("aria-label", "Email address");
      btn.type = "submit";
      f.appendChild(input);
      f.appendChild(btn);
      f.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (busy) return;
        busy = true;
        btn.disabled = true;
        btn.textContent = "…";
        ctl.capture(input.value, { answers: answers, consentText: consent ? consent.text : "" }).then(function (res) {
          busy = false;
          if (res && res.ok) {
            captured = true;
            reward = res.reward || null;
            next();
          } else {
            btn.disabled = false;
            btn.textContent = b.cta || "Join";
            input.setAttribute("aria-invalid", "true");
            input.placeholder = "That didn’t go through — try again";
            input.value = "";
          }
        });
      });
      return f;
    }

    function rewardNodes(b) {
      var frag = document.createDocumentFragment(), a;
      if (b.headline) frag.appendChild(el("h2", "h", b.headline));
      if (b.body) frag.appendChild(el("p", "b", b.body));
      var code = (reward && reward.code) || (ctl.preview && b.mode === "code" ? "PREVIEW" : "");
      var coded = b.mode === "code" && code;
      if (coded) {
        code = String(code);
        var box = el("div", "code"), txt = el("b", null, code), cp = el("button", "cp", "Copy");
        cp.type = "button";
        cp.setAttribute("aria-label", "Copy code " + code);
        cp.addEventListener("click", function () {
          try {
            navigator.clipboard.writeText(code).then(function () { cp.textContent = "Copied"; }, function () { /* selection stays available */ });
          } catch (e) { oops(e); }
        });
        box.appendChild(txt);
        box.appendChild(cp);
        frag.appendChild(box);
        // Shopify applies the code and redirects back to this page.
        a = el("a", "cta", "Apply code");
        a.href = "/discount/" + encodeURIComponent(code) + "?redirect=" + encodeURIComponent(location.pathname);
        frag.appendChild(a);
      }
      if (b.mode === "picks" && b.picks) {
        var list = null;
        Object.keys(answers).forEach(function (k) { if (b.picks[answers[k]]) list = b.picks[answers[k]]; });
        var grid = el("div", "picks");
        (list || []).slice(0, 3).forEach(function (p) {
          var href = safeHref(p.url);
          if (!href) return;
          var t = el("a", "pick"), src = safeImage(p.imageSrc);
          t.href = href;
          if (src) { var im = el("img"); im.alt = ""; im.src = src; t.appendChild(im); }
          t.appendChild(el("span", null, p.title));
          grid.appendChild(t);
        });
        if (grid.firstChild) frag.appendChild(grid);
      }
      var lh = b.link && safeHref(b.link.href);
      if (lh) {
        a = el("a", coded ? "lnk" : "cta", b.link.label);
        a.href = lh;
        frag.appendChild(a);
      }
      return frag;
    }

    function block(b, consent) {
      var k = b.kind, n;
      if (k === "eyebrow") return el("div", "eyebrow", b.text);
      if (k === "headline") {
        n = el("h2", "h", b.text);
        if (b.accent) n.appendChild(el("span", "acc", b.accent));
        return n;
      }
      if (k === "body") return el("p", "b", b.text);
      if (k === "points") {
        n = el("ul", "pts");
        (b.items || []).slice(0, 3).forEach(function (t) { n.appendChild(el("li", null, t)); });
        return n;
      }
      if (k === "choice") return choice(b);
      if (k === "email") return emailForm(b, consent);
      if (k === "consent") return el("p", "consent", b.text);
      if (k === "cta") {
        n = el("button", "cta", b.label);
        n.type = "button";
        n.addEventListener("click", function () { next(); });
        return n;
      }
      if (k === "reward") return rewardNodes(b);
      if (k === "decline") {
        n = el("button", "dec", b.text);
        n.type = "button";
        n.addEventListener("click", function () { close("dismiss"); });
        return n;
      }
      return null; // image + progress are placed by the composition; unknown kinds render nothing
    }

    function fill(blocks, n) {
      copy.textContent = "";
      var step = steps[n];
      if (steps.length > 1 && ofKind(step, "progress")) copy.appendChild(progress(n));
      var consent = find(blocks, function (b) { return b.kind === "consent"; });
      blocks.forEach(function (b) {
        try {
          var node = block(b, consent);
          if (node) copy.appendChild(node);
        } catch (e) { oops(e); }
      });
      var h = copy.querySelector(".h");
      card.setAttribute("aria-label", h ? h.textContent : "Offer");
      card.scrollTop = 0;
      copy.scrollTop = 0;
    }
    function show(n) {
      idx = n;
      setMedia(imageFor(n));
      fill((steps[n] && steps[n].blocks) || [], n);
    }
    function focusStep() {
      try {
        var t = coarse() ? null : copy.querySelector("input");
        if (!t) { card.setAttribute("tabindex", "-1"); t = card; }
        t.focus({ preventScroll: true });
      } catch (e) { oops(e); }
    }
    function next() {
      if (idx + 1 < steps.length) {
        show(idx + 1);
        ctl.track("step", { step: idx });
        focusStep();
      } else if (captured) {
        // Email on the last step: the success reward is implicit.
        fill([{ kind: "reward", mode: reward && reward.code ? "code" : "message", headline: "You’re on the list." }], idx);
        focusStep();
      } else {
        close("done");
      }
    }

    // Render before any side effect: if this throws, nothing is locked,
    // bound, or counted (fails invisible).
    show(start);
    var prevOverflow = null, prevFocus = document.activeElement;
    if (place === "takeover") {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    var untrap = isModal ? trapFocus(card) : null;
    function onKey(ev) { if (ev.key === "Escape") close("dismiss"); }
    function close(reason) {
      if (prevOverflow !== null) document.body.style.overflow = prevOverflow;
      if (untrap) untrap();
      document.removeEventListener("keydown", onKey);
      // Closing after a capture is not a dismissal: no suppression, no event.
      if (reason === "dismiss" && !captured) {
        ctl.dismiss({ step: idx });
        if (surface.teaser && surface.teaser.enabled && place === "corner") {
          renderPill(ctl, function () { renderV2(ctl); });
        }
      } else {
        try { host.remove(); } catch (e) { oops(e); }
      }
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) { oops(e); }
    }
    x.addEventListener("click", function () { close("dismiss"); });
    if (isModal) wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close("dismiss"); });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(host);
    ctl.mount(host);
    if (isModal) focusStep();
    return host;
  }

  function teaserLabel(surface, variant) {
    var s0 = (variant.steps || [])[0];
    var eb = ofKind(s0, "eyebrow"), cta = ofKind(s0, "cta") || ofKind(s0, "email");
    return (surface.teaser && surface.teaser.label) || (eb && eb.text) || (cta && (cta.label || cta.cta)) || "Offer";
  }

  // v2 teaser pill: search-arrival first step and corner re-open tab. Opens
  // on tap, or on exit intent when exitOpens (never on back/popstate).
  function renderPill(ctl, open, exitOpens) {
    var host = el("div");
    host.setAttribute("data-mos-surface", ctl.surface.id + "-teaser");
    var root = host.attachShadow({ mode: "open" });
    var css = el("style");
    css.textContent = PILL_CSS + (DIAG ? NOANIM : "");
    root.appendChild(css);
    var b = el("button", "pill", teaserLabel(ctl.surface, ctl.variant));
    b.type = "button";
    b.setAttribute("style", tokenVars(ctl.variant.style));
    var opened = false;
    function go() {
      if (opened) return;
      opened = true;
      try { host.remove(); } catch (e) { oops(e); }
      open();
    }
    b.addEventListener("click", go);
    root.appendChild(b);
    document.body.appendChild(host);
    if (exitOpens) onExitIntent(go);
    ctl.track("teaser");
    return host;
  }

  // Search arrivals on phones get the pill first (spec 34 §2.4): an arrival
  // interstitial is a page-experience negative; tap/exit intent are not.
  function teaserFirst(surface, trig) {
    return surface.version === "2" && (surface.placement === "overlay" || surface.placement === "takeover") &&
      deviceType() === "mobile" && SOURCE === "search" && !(trig && trig.kind === "exit-intent") &&
      ((surface.mobile && surface.mobile.searchArrival) || "teaser-first") === "teaser-first";
  }
  function present(ctl, trig) {
    var renderer = pickRenderer(ctl.surface);
    if (!renderer) return;
    if (teaserFirst(ctl.surface, trig)) {
      if (!ctl.preview) markShown(ctl.surface);
      renderPill(ctl, function () { renderer(ctl); }, true);
    } else {
      renderer(ctl);
    }
  }

  function defaultOfferRenderer(ctl) {
    return ctl.surface.version === "2" ? renderV2(ctl) : renderCard(ctl);
  }
  mos.surfaces.register("offer", defaultOfferRenderer, { builtin: true });

  /* ── incumbent: Klaviyo forms (spec 34 §4.2, OH3) ──────────────── */
  // Popups/flyouts only: embedded forms are page content, never touched.
  var KL_SEL = '[aria-label="POPUP Form"],[data-testid="POPUP"],[data-testid="FLYOUT"],[data-testid="animated-teaser"]';
  var klSuppress = false, klOpened = {};
  function klPopup(d) {
    var m = d.metaData || {}, t = String(d.formType || m.formType || m.$source || "").toLowerCase();
    if (d.type === "embedOpen" || /embed/.test(t)) return false;
    if (d.type === "open") klOpened[d.formId] = 1;
    return /popup|flyout/.test(t) || klOpened[d.formId] === 1;
  }
  function onKlaviyo(fn) {
    addEventListener("klaviyoForms", function (e) {
      try {
        var d = (e && e.detail) || {};
        if (d.type && klPopup(d)) fn(d);
      } catch (x) { oops(x); }
    });
  }
  function klHide() {
    try {
      [].forEach.call(document.querySelectorAll(KL_SEL), function (n) { n.style.setProperty("display", "none", "important"); });
    } catch (e) { oops(e); }
  }
  function suppressKlaviyo(on) {
    klSuppress = on;
    var s = document.getElementById("mos-suppress-klaviyo");
    if (!on) { if (s) s.remove(); return; }
    if (s) return;
    s = el("style");
    s.id = "mos-suppress-klaviyo";
    s.textContent = KL_SEL + "{display:none!important}";
    (document.head || document.documentElement).appendChild(s);
  }
  function observeIncumbent(surface, assignment) {
    var seen = {}, map = { open: "impression", submit: "capture", close: "dismiss" };
    onKlaviyo(function (d) {
      var ev = map[d.type];
      if (!ev || seen[ev + ":" + d.formId]) return;
      seen[ev + ":" + d.formId] = 1;
      track(surface, assignment, ev, { vendor: "klaviyo" });
    });
  }
  // Suppress before the manifest round-trip if we did last page view;
  // boot() re-decides.
  try {
    if ((store("supk") || 0) > Date.now()) suppressKlaviyo(true);
    onKlaviyo(function (d) {
      if (d.type !== "open" || !klSuppress) return;
      klHide();
      setTimeout(klHide, 60);
      setTimeout(klHide, 400);
    });
  } catch (e) { /* never break the storefront */ }

  /* ── exit-intent (OF3) ─────────────────────────────────────────── */
  // Its own function so the handlers below are declared at a function-body
  // root (ESLint no-inner-declarations) rather than inside an if-block.
  function onExitIntent(fn) {
    var fired = false;
    var lastY = scrollY, lastT = Date.now();
    function fire() {
      if (fired) return;
      fired = true;
      removeEventListener("mouseout", onMouseOut);
      removeEventListener("scroll", onScroll);
      fn();
    }
    // Desktop: the mouse leaves toward the browser chrome (clientY <= 0,
    // no relatedTarget) — the standard, non-abusive exit-intent signal.
    function onMouseOut(ev) {
      if (ev.clientY <= 0 && !ev.relatedTarget) fire();
    }
    // Mobile has no mouseout. Heuristic instead: a fast upward scroll back
    // toward the top of the page, a few seconds in. Deliberately NOT a
    // popstate/history listener — that is the trap version of this
    // trigger and this runtime does not implement it.
    function onScroll() {
      var y = scrollY, now = Date.now();
      var v = (lastY - y) / (now - lastT || 1); // px/ms, positive = up
      if (y < 120 && v > 0.9 && now - START > 4000) fire();
      lastY = y; lastT = now;
    }
    addEventListener("mouseout", onMouseOut);
    addEventListener("scroll", onScroll, { passive: true });
  }

  /* ── triggers ──────────────────────────────────────────────────── */
  // scroll-dwell (OH6) = scroll-depth + time on page ≥ dwellMs.
  function onScrollDepth(pct, dwellMs, fn) {
    var done = false;
    function h() {
      var d = document.documentElement;
      if (done || (d.scrollTop + d.clientHeight) / d.scrollHeight * 100 < pct) return;
      done = true;
      removeEventListener("scroll", h);
      setTimeout(fn, Math.max(0, dwellMs - (Date.now() - START)));
    }
    addEventListener("scroll", h, { passive: true });
  }
  function onTrigger(t, fn) {
    t = t || { kind: "delay", seconds: 10 };
    if (t.kind === "exit-intent") {
      onExitIntent(fn);
    } else if (t.kind === "scroll-depth" || t.kind === "scroll-dwell") {
      onScrollDepth(t.percent || (t.kind === "scroll-dwell" ? 50 : 40), (t.dwellSeconds || 0) * 1000, fn);
    } else if (t.kind === "second-pageview") {
      if ((store("pv") || 0) >= 1) setTimeout(fn, (t.seconds || 2) * 1000);
    } else if (t.kind === "product-views") {
      if (PVIEWS >= (t.views || 2)) setTimeout(fn, (t.seconds || 2) * 1000);
    } else {
      setTimeout(fn, (t.seconds || 10) * 1000);
    }
  }

  /* ── preview (signed link from an approval card) ───────────────── */
  // The proxy only serves a surface flagged `preview` to a valid signed token,
  // so reaching here means someone opened that link. Show the chosen variant
  // at once, skip eligibility, record nothing, and say plainly it isn't live.
  // Harness params (spec 34 §3.3): mos_step, mos_teaser, mos_diag (no badge,
  // so it cannot sit in the measured frame).
  function bootPreview(surface) {
    var keys = Object.keys(surface.variants || {}).sort();
    var want = qparam("mos_arm");
    var arm = keys.indexOf(want) !== -1 ? want : keys[0];
    var variant = arm && surface.variants[arm];
    if (!variant) return;
    DIAG = qparam("mos_diag") === "1";
    if (!DIAG) previewBadge(keys, arm);
    function render() {
      var ctl = null, host = null;
      try {
        var renderer = pickRenderer(surface);
        if (renderer) {
          ctl = makeController(surface, { arm: arm, alloc: 0, preview: true }, variant);
          ctl.startStep = parseInt(qparam("mos_step"), 10) || 0;
          if (qparam("mos_teaser") === "1") host = renderPill(ctl, function () { renderer(ctl); });
          else { renderer(ctl); host = ctl.el; }
        }
      } catch (e) { oops(e); }
      if (!DIAG) return;
      var meta = { surface: surface, arm: arm, variant: variant, step: ctl ? ctl.startStep : 0, host: host, errors: DIAG_ERR, noanim: NOANIM };
      if (mos.diagnose) return mos.diagnose(meta);
      DIAG_ERR.push("diagnostics module did not load");
      window.__mosDiag = { surfaceId: surface.id, arm: arm, step: meta.step, rects: { choices: [] }, contrast: [], errors: DIAG_ERR };
      document.documentElement.dataset.mosReady = "1";
    }
    if (!DIAG) { setTimeout(render, 700); return; }
    // Harness-only code: a sibling asset on the same extension CDN path.
    var d = el("script");
    d.src = SRC.replace(/surface-runtime\.js/, "surface-diag.js");
    d.onload = d.onerror = render;
    document.head.appendChild(d);
  }
  function previewBadge(keys, current) {
    try {
      var host = el("div");
      var root = host.attachShadow({ mode: "open" });
      var st = el("style");
      st.textContent = ":host{all:initial}.b{position:fixed;z-index:2147483001;left:16px;bottom:16px;display:flex;" +
        "gap:6px;align-items:center;padding:8px 10px;background:#1a1a1a;color:#fff;font:500 12px/1 system-ui,sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.3)}a{color:#fff;padding:5px 8px;border:1px solid rgba(255,255,255,.3);text-decoration:none}" +
        "a.on{background:#fff;color:#1a1a1a}";
      root.appendChild(st);
      var b = el("div", "b", "Preview — not live");
      keys.forEach(function (k) {
        var a = el("a", k === current ? "on" : null, k);
        var u = new URL(location.href);
        u.searchParams.set("mos_arm", k);
        a.href = u.toString();
        b.appendChild(a);
      });
      root.appendChild(b);
      document.body.appendChild(host);
    } catch (e) { /* never break the storefront */ }
  }

  /* ── boot ──────────────────────────────────────────────────────── */
  /** One offer per visitor. With two offers live (a challenger approved
   * while the current one still runs) every visitor would otherwise get both
   * popups. Each visitor is stickily assigned ONE of the live offers — which
   * also makes the two a fair head-to-head. Chosen over the whole live set,
   * not per page or per eligibility, so a visitor never sees offer A on one
   * page and offer B on the next, or a second offer after dismissing one. */
  function pickOffer(surfaces, vid) {
    var ids = [];
    surfaces.forEach(function (s) { if (s && s.type === "offer" && !s.preview && s.id) ids.push(String(s.id)); });
    if (ids.length < 2) return null;
    ids.sort();
    var key = "offer-pick:" + Math.floor(hash01(ids.join("|")) * 1e9);
    var sticky = store(key);
    if (sticky && ids.indexOf(sticky) !== -1) return sticky;
    var pick = ids[Math.min(ids.length - 1, Math.floor(hash01(vid + ":" + key) * ids.length))];
    store(key, pick);
    return pick;
  }

  function boot(manifest) {
    booted = true;
    // Drain the documented pre-init queue + announce readiness (SURFACES-SDK.md §3).
    try {
      (window.__mosQueue || []).splice(0).forEach(function (cb) { try { cb(); } catch (e) { /* never break the storefront */ } });
      document.dispatchEvent(new CustomEvent("mos:ready"));
    } catch (e) { /* never break the storefront */ }
    readyQ.splice(0).forEach(function (cb) { try { cb(); } catch (e) { /* never break the storefront */ } });
    if (!manifest || !manifest.surfaces) { suppressKlaviyo(false); return; }
    var visits = bumpVisit();
    store("pv", (store("pv") || 0) + 1);
    var vid = visitorId();
    SOURCE = sourceClass();
    CELL = deviceType() + "." + (visits <= 1 ? "new" : "returning") + "." + SOURCE;
    PVIEWS = productViews();
    var wantSup = false;
    var picked = null;
    try { picked = pickOffer(manifest.surfaces, vid); } catch (e) { /* never break the storefront */ }

    manifest.surfaces.forEach(function (surface) {
      try {
        if (surface.type !== "offer") return;
        if (picked && !surface.preview && String(surface.id) !== picked) return;
        var exp = surface.experiment;
        var inc = find(exp && exp.arms, function (a) { return a.kind === "incumbent"; });
        var klv = !!inc && inc.vendor === "klaviyo";
        if (surface.preview) { if (klv) wantSup = true; bootPreview(surface); return; }
        var ok = eligible(surface, visits);

        var assignment = { arm: "v1", alloc: 0 };
        if (ok && exp && exp.arms && exp.arms.length) assignment = assign(exp, vid, CELL);
        // H2: suppress Klaviyo for anyone already in a non-incumbent arm, even
        // where our offer is ineligible (dismissed/capped) — else closing our
        // card would just surface theirs.
        if (klv && inWindow(surface)) {
          var armKey = ok ? assignment.arm : (store("arm:" + exp.id) || {}).arm;
          if (armDef(exp, armKey) && armKey !== inc.key) wantSup = true;
        }
        if (!ok) return;
        if (inc && assignment.arm === inc.key) {
          // Incumbent arm: we render nothing and count the vendor's popup.
          track(surface, assignment, "exposure", { vendor: inc.vendor });
          if (klv) observeIncumbent(surface, assignment);
          return;
        }
        var def = armDef(exp, assignment.arm);
        if (assignment.arm === "control" || (def && def.kind === "control")) {
          // Control sees nothing but is still an exposure — the denominator matters.
          track(surface, assignment, "exposure");
          return;
        }
        var variant = (surface.variants || {})[assignment.arm];
        if (!variant) return;
        track(surface, assignment, "exposure");
        // Warm the lead image during the trigger delay so it paints with
        // the card. Same origin the theme already loads from.
        var ib = ofKind((variant.steps || [])[0], "image");
        var pre = safeImage(variant.content ? variant.content.imageSrc
          : ib && !(ib.mobile === "drop" && deviceType() === "mobile") && ib.src);
        if (pre) { try { new Image().src = pre; } catch (e) { /* never break the storefront */ } }
        var trig = variant.trigger || surface.trigger;
        onTrigger(trig, function () {
          try {
            // Renderer chosen at trigger time: a theme registration wins for the
            // placements it handles; the built-in covers the rest.
            present(makeController(surface, assignment, variant), trig);
          } catch (e) { /* never break the storefront */ }
        });
      } catch (e) { /* fails invisible, per contract */ }
    });
    try {
      suppressKlaviyo(wantSup);
      store("supk", wantSup ? Date.now() + 864e5 : 0);
    } catch (e) { /* never break the storefront */ }
  }

  try {
    if (window.MOS_MANIFEST) { boot(window.MOS_MANIFEST); return; }
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 3500);
    var pv = qparam("mos_preview");
    fetch(PROXY + "/surfaces" + (pv ? "?preview=" + encodeURIComponent(pv) : ""), { signal: ctl.signal, credentials: "omit" })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; })
      .then(boot)
      .catch(function () { /* invisible */ });
  } catch (e) { /* invisible */ }
})();
