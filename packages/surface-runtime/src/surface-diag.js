/**
 * Marketing OS — surface preview diagnostics (spec 34 §3.3, OH2)
 * ==============================================================
 * Loaded by surface-runtime.js only for signed previews with mos_diag=1 —
 * the harness render worker, never a shopper. Measures what was painted and
 * publishes it:
 *   document.documentElement.dataset.mosReady = "1"
 *   window.__mosDiag = DiagReport  (CONTRACT §3)
 * Contrast is computed from computed styles against the composited solid
 * backdrop actually behind each text node, not from the manifest tokens.
 */
(function () {
  "use strict";
  var mos = (window.mos = window.mos || {});
  var cx = null;

  // Any CSS color (hex, rgb, oklch, named…) → [r, g, b, a] via a 1px canvas.
  function rgba(c) {
    cx = cx || document.createElement("canvas").getContext("2d");
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    var d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  function blend(top, under) {
    var a = top[3];
    return [0, 1, 2].map(function (i) { return Math.round(top[i] * a + under[i] * (1 - a)); }).concat(1);
  }
  // A node's own background and its ancestors' (across the shadow boundary),
  // composited down to the first opaque layer.
  function backdrop(n) {
    var layers = [], out = [255, 255, 255, 1];
    for (var e = n; e; e = e.parentNode || e.host) {
      if (e.nodeType !== 1) continue;
      var c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    for (var i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  }
  function lum(c) {
    var v = c.slice(0, 3).map(function (u) {
      u /= 255;
      return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function rect(n) {
    if (!n) return undefined;
    var r = n.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function measure(root, rep) {
    function q(s) { return root.querySelector(s); }
    var card = q(".card") || q(".pill");
    var cta = q(".cta") || q(".pill"), input = q("input[type=email]");
    rep.rects = {
      card: rect(card), close: rect(q(".x")), cta: rect(cta), input: rect(input),
      choices: [].map.call(root.querySelectorAll(".opt"), rect), decline: rect(q(".dec")),
    };
    // Overflow: anything scrolls, or the card / its CTA / its field is not
    // wholly inside the viewport.
    var over = false;
    [card, q(".copy")].forEach(function (n) { if (n && n.scrollHeight > n.clientHeight + 1) over = true; });
    [card, cta, input].forEach(function (n) {
      if (!n) return;
      var r = n.getBoundingClientRect();
      if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1) over = true;
    });
    rep.overflow = over;
    [["headline", ".h"], ["body", ".b"], ["cta", ".cta,.pill"], ["consent", ".consent"], ["decline", ".dec"]].forEach(function (p) {
      var n = q(p[1]);
      if (!n) return;
      var bg = backdrop(n), fg = blend(rgba(getComputedStyle(n).color), bg);
      var l1 = lum(fg), l2 = lum(bg);
      rep.contrast.push({
        role: p[0], fg: "rgb(" + fg.slice(0, 3) + ")", bg: "rgb(" + bg.slice(0, 3) + ")",
        ratio: Math.round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) * 100) / 100,
      });
    });
  }

  // m: { surface, arm, variant, step, host, errors, noanim }
  mos.diagnose = function (m) {
    var v2 = m.surface.version === "2";
    var root = m.host && (m.host.shadowRoot || m.host);
    var rep = {
      surfaceId: m.surface.id, arm: m.arm, step: m.step || 0, steps: v2 ? (m.variant.steps || []).length : 1,
      viewport: { w: innerWidth, h: innerHeight }, composition: v2 ? m.variant.composition : "v1",
      rects: { card: undefined, choices: [] }, overflow: false, contrast: [], imageLoaded: null, errors: m.errors,
    };
    function finish() {
      try {
        if (root) measure(root, rep);
        else m.errors.push("nothing rendered");
      } catch (e) { m.errors.push(String((e && e.message) || e)); }
      window.__mosDiag = rep;
      document.documentElement.dataset.mosReady = "1";
    }
    try {
      if (root) {
        var st = document.createElement("style");
        st.textContent = m.noanim;
        root.appendChild(st);
      }
      var main = root && root.querySelector(".media img");
      var waits = [].map.call(root ? root.querySelectorAll("img") : [], function (im) {
        return new Promise(function (res) {
          if (im.complete) return res();
          im.addEventListener("load", res);
          im.addEventListener("error", res);
          setTimeout(res, 5000);
        });
      });
      if (document.fonts && document.fonts.ready) {
        waits.push(Promise.race([document.fonts.ready, new Promise(function (res) { setTimeout(res, 3000); })]));
      }
      Promise.all(waits).then(function () {
        if (main) rep.imageLoaded = main.isConnected && main.complete && main.naturalWidth > 0;
        requestAnimationFrame(function () { requestAnimationFrame(finish); });
      });
    } catch (e) {
      m.errors.push(String((e && e.message) || e));
      finish();
    }
  };
})();
