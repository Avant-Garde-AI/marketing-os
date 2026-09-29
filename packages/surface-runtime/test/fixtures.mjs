// Surface manifests for the runtime harness. A fictional gallery
// ("Hollis & Vane") so no real store's copy or imagery is committed.

const CDN = "https://cdn.shopify.com/s/files/1/0000/fixture/";
export const img = (name) => CDN + name;

const DISPLAY = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif';
const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

export const STYLES = {
  // Warm paper, terracotta accent — the v1 Arthaus-like token set.
  paper: {
    bg: "#f6f2ea", ink: "#1d1a17", ink2: "#5c554c", accent: "#9a4a2b",
    line: "rgba(29,26,23,.16)", font: SANS, fontDisplay: DISPLAY, fontMono: MONO,
  },
  // Night gallery: the same compositions, inverted — proves nothing is hard-coded.
  night: {
    bg: "#16181d", ink: "#f3efe7", ink2: "#b9b2a6", accent: "#d9a35b",
    line: "rgba(243,239,231,.18)", font: SANS, fontDisplay: DISPLAY, fontMono: MONO,
  },
  // Cool white, a sans display — a different brand altogether.
  gallery: {
    bg: "#ffffff", ink: "#101820", ink2: "#4a5563", accent: "#2f55c9",
    line: "#e1e4e8", font: '"Helvetica Neue",Arial,sans-serif',
    fontDisplay: '"Didot","Bodoni 72",Georgia,serif', fontMono: MONO,
  },
};

const CONSENT =
  "By joining you agree to receive emails from Hollis & Vane. Unsubscribe anytime; see our privacy policy.";

const TRIGGER = { kind: "delay", seconds: 0.1, suppressAfterDismissDays: 14, maxPerSession: 5 };
const AUDIENCE = { newVisitorsOnly: false, excludeSubscribed: false, pages: ["home", "collection", "product", "cart"] };

function manifestV2(id, placement, variants, extra = {}) {
  return {
    version: "2",
    id,
    type: "offer",
    title: id,
    placement,
    trigger: TRIGGER,
    audience: AUDIENCE,
    experiment: {
      id: "exp-" + id,
      policy: "fixed",
      allocation: 1,
      arms: [{ key: "v1", weight: 1, kind: "variant" }],
    },
    variants,
    consent: { capturesEmail: true },
    ...extra,
  };
}

// The single-step welcome used across the composition × placement matrix.
function welcome(composition, placement, style, imageName = "interior.jpg") {
  const blocks = [
    { kind: "image", src: img(imageName), alt: "A framed colour-field painting above a gallery bench", caption: "Mara Lind — Tidewater, 2026", focus: "50% 40%" },
    { kind: "eyebrow", text: "Letters from the studio" },
    { kind: "headline", text: "Original work,", accent: "before it’s shown." },
    { kind: "body", text: "One letter a month: new pieces from our artists, a week before the public release." },
  ];
  if (placement === "takeover") {
    blocks.push({ kind: "points", items: ["A first look at every release", "Notes from the artists’ studios", "No sales blasts. Leave anytime."] });
  }
  blocks.push(
    { kind: "email", placeholder: "Email address", cta: "Join the list" },
    { kind: "consent", text: CONSENT },
    { kind: "decline", text: "Not now" },
  );
  return { composition, style: STYLES[style], steps: [{ id: "join", kind: "ask", blocks }], incentive: { type: "early-access" } };
}

const COMPOSITIONS = ["split-image", "full-bleed-image", "editorial-type", "card"];
const PLACEMENTS = ["corner-card", "overlay", "takeover"];
const STYLE_FOR = { "split-image": "paper", "full-bleed-image": "night", "editorial-type": "paper", card: "gallery" };

const PICKS = {
  living: [
    { title: "Tidewater — Mara Lind", url: "/products/tidewater", imageSrc: img("print-1.jpg") },
    { title: "Low Field — Ines Carvalho", url: "/products/low-field", imageSrc: img("print-2.jpg") },
    { title: "Ochre Hours — Sam Ota", url: "/products/ochre-hours", imageSrc: img("print-3.jpg") },
  ],
  bedroom: [
    { title: "Nocturne II — Ada Brenner", url: "/products/nocturne-ii", imageSrc: img("print-4.jpg") },
    { title: "Salt Light — Mara Lind", url: "/products/salt-light", imageSrc: img("print-6.jpg") },
    { title: "Low Field — Ines Carvalho", url: "/products/low-field", imageSrc: img("print-2.jpg") },
  ],
  workspace: [
    { title: "Three Rooms — Theo Wren", url: "/products/three-rooms", imageSrc: img("print-5.jpg") },
    { title: "Ochre Hours — Sam Ota", url: "/products/ochre-hours", imageSrc: img("print-3.jpg") },
    { title: "Tidewater — Mara Lind", url: "/products/tidewater", imageSrc: img("print-1.jpg") },
  ],
};

// hook (choice) → email + consent → reward picks for the chosen room.
function quiz(composition, style) {
  return {
    composition,
    style: STYLES[style],
    archetype: "zero-party-quiz",
    incentive: { type: "percent", value: 10, codeMode: "unique" },
    steps: [
      {
        id: "room",
        kind: "hook",
        blocks: [
          { kind: "image", src: img("interior.jpg"), alt: "A framed colour-field painting above a gallery bench", mobile: "keep" },
          { kind: "progress" },
          { kind: "eyebrow", text: "Find your first piece" },
          { kind: "headline", text: "Where will it hang?" },
          { kind: "body", text: "Tell us the room and we’ll send a shortlist chosen for its light and scale." },
          { kind: "choice", question: "Choose a room", answerKey: "room", options: [
            { value: "living", label: "Living room" },
            { value: "bedroom", label: "Bedroom" },
            { value: "workspace", label: "Workspace" },
          ] },
          { kind: "decline", text: "Not now" },
        ],
      },
      {
        id: "ask",
        kind: "ask",
        blocks: [
          { kind: "progress" },
          { kind: "eyebrow", text: "Your shortlist" },
          { kind: "headline", text: "Three pieces,", accent: "chosen for your room." },
          { kind: "body", text: "We’ll email the shortlist, plus 10% off your first original." },
          { kind: "email", placeholder: "Email address", cta: "Send my shortlist" },
          { kind: "consent", text: CONSENT },
          { kind: "decline", text: "Not now" },
        ],
      },
      {
        id: "reward",
        kind: "reward",
        blocks: [
          { kind: "reward", mode: "picks", headline: "A start for your walls.", body: "Your shortlist is on its way. Three to begin with:", picks: PICKS, link: { label: "See the full collection", href: "/collections/all" } },
        ],
      },
    ],
  };
}

// hook (cta) → email → reward code (the server returns the unique code).
function codeFlow(composition, style) {
  return {
    composition,
    style: STYLES[style],
    archetype: "threshold",
    incentive: { type: "percent", value: 10, codeMode: "unique" },
    steps: [
      {
        id: "hook",
        kind: "hook",
        blocks: [
          { kind: "image", src: img("study.jpg"), alt: "Detail of a painted canvas in rust, ochre and blue", caption: "Detail — Ochre Hours", mobile: "keep" },
          { kind: "progress" },
          { kind: "eyebrow", text: "First original" },
          { kind: "headline", text: "10% off", accent: "your first original." },
          { kind: "body", text: "Every piece is one of one, signed, and ships ready to hang." },
          { kind: "cta", label: "Continue" },
          { kind: "decline", text: "No thanks" },
        ],
      },
      {
        id: "ask",
        kind: "ask",
        blocks: [
          { kind: "progress" },
          { kind: "headline", text: "Where should we send it?" },
          { kind: "email", placeholder: "Email address", cta: "Get my code" },
          { kind: "consent", text: CONSENT },
          { kind: "decline", text: "No thanks" },
        ],
      },
      {
        id: "reward",
        kind: "reward",
        blocks: [
          { kind: "reward", mode: "code", headline: "Your code is ready.", body: "It works once, on your first order. We’ve emailed it too.", link: { label: "Browse new work", href: "/collections/new" } },
        ],
      },
    ],
  };
}

export const FIXTURES = {};

for (const c of COMPOSITIONS) {
  for (const p of PLACEMENTS) {
    const id = `m-${c}-${p}`;
    FIXTURES[id] = manifestV2(id, p, { v1: welcome(c, p, STYLE_FOR[c], c === "full-bleed-image" ? "study.jpg" : "interior.jpg") });
  }
}

FIXTURES.quiz = manifestV2("quiz", "takeover", { v1: quiz("split-image", "paper") });
FIXTURES["quiz-corner"] = manifestV2("quiz-corner", "corner-card", { v1: quiz("card", "gallery") });
FIXTURES["quiz-overlay-editorial"] = manifestV2("quiz-overlay-editorial", "overlay", { v1: quiz("editorial-type", "paper") });
FIXTURES.code = manifestV2("code", "overlay", { v1: codeFlow("full-bleed-image", "night") });

// Images dropped on phones: split-image falls back to type-only.
FIXTURES["drop-mobile"] = manifestV2("drop-mobile", "overlay", {
  v1: (() => {
    const v = welcome("split-image", "overlay", "paper");
    v.steps[0].blocks[0].mobile = "drop";
    return v;
  })(),
});

// Search-arrival teaser (mobile default for overlay/takeover).
FIXTURES.search = manifestV2("search", "takeover", { v1: welcome("split-image", "takeover", "paper") }, {
  teaser: { enabled: true, label: "A letter from the studio" },
});
FIXTURES["search-as-desktop"] = manifestV2("search-as-desktop", "takeover", { v1: welcome("split-image", "takeover", "paper") }, {
  mobile: { searchArrival: "as-desktop" },
});

// Head-to-head: control / variant / incumbent (Klaviyo).
FIXTURES.incumbent = manifestV2("incumbent", "corner-card", { v1: welcome("card", "corner-card", "gallery") }, {
  experiment: {
    id: "exp-incumbent",
    policy: "thompson",
    allocation: 1,
    arms: [
      { key: "control", weight: 0.2, kind: "control" },
      { key: "v1", weight: 0.4, kind: "variant" },
      { key: "incumbent", weight: 0.4, kind: "incumbent", vendor: "klaviyo" },
    ],
  },
});

// OH6 cells: desktop direct visitors are all sent to v2.
FIXTURES.cells = manifestV2("cells", "corner-card", {
  v1: welcome("card", "corner-card", "gallery"),
  v2: welcome("editorial-type", "corner-card", "paper"),
}, {
  experiment: {
    id: "exp-cells",
    policy: "thompson",
    allocation: 1,
    arms: [{ key: "v1", weight: 0.5 }, { key: "v2", weight: 0.5 }],
    cells: { "desktop.new.direct": [{ key: "v2", weight: 1 }], "mobile.new.direct": [{ key: "v1", weight: 1 }] },
  },
});

// Two offers live at once (a challenger approved while the current one runs):
// each visitor must get exactly one of them.
const soloArm = { experiment: { policy: "fixed", allocation: 1, arms: [{ key: "v1", weight: 1 }] } };
FIXTURES.pair = [
  manifestV2("pair-a", "corner-card", { v1: welcome("card", "corner-card", "gallery") }, { experiment: { id: "exp-pair-a", ...soloArm.experiment } }),
  manifestV2("pair-b", "corner-card", { v1: welcome("editorial-type", "corner-card", "paper") }, { experiment: { id: "exp-pair-b", ...soloArm.experiment } }),
];

// OH6 trigger arms (per-variant override of the surface trigger).
FIXTURES["trig-product-views"] = manifestV2("trig-product-views", "corner-card", {
  v1: { ...welcome("card", "corner-card", "gallery"), trigger: { kind: "product-views", views: 2, seconds: 0.1 } },
});
FIXTURES["trig-scroll-dwell"] = manifestV2("trig-scroll-dwell", "corner-card", {
  v1: { ...welcome("card", "corner-card", "gallery"), trigger: { kind: "scroll-dwell", percent: 30, dwellSeconds: 1.5 } },
});

// v1: the Arthaus-shaped welcome takeover (flat content fields, no version).
FIXTURES.v1 = {
  id: "v1-welcome",
  type: "offer",
  placement: "takeover",
  trigger: TRIGGER,
  audience: AUDIENCE,
  teaser: { enabled: true },
  experiment: { id: "exp-v1", policy: "thompson", allocation: 1, arms: [{ key: "v1", weight: 1 }] },
  variants: {
    v1: {
      content: {
        eyebrow: "Letters from the studio",
        headline: "Original work,",
        headlineAccent: "before it’s shown.",
        body: "One letter a month: new pieces from our artists, a week before the public release.",
        points: "A first look at every release|Notes from the artists’ studios|No sales blasts. Leave anytime.",
        imageSrc: img("interior.jpg"),
        imageAlt: "A framed colour-field painting above a gallery bench",
        imageFocus: "50% 40%",
        imageCaption: "Mara Lind — Tidewater, 2026",
        placeholder: "Email address",
        cta: "Join the list",
        consent: CONSENT,
        decline: "Not now",
        success: "You’re on the list.",
      },
      style: STYLES.paper,
    },
  },
};

// Malformed v2 (the platform validator should refuse it; the runtime must
// still fail invisible): no surface, no error, no scroll lock.
FIXTURES.broken = manifestV2("broken", "takeover", { v1: { composition: "split-image", style: STYLES.paper, steps: "not-an-array" } });

// Previews: the proxy marks a surface `preview` for a valid signed token.
export function asPreview(m) {
  return { ...m, preview: true };
}

export const MATRIX = COMPOSITIONS.flatMap((c) => PLACEMENTS.map((p) => `m-${c}-${p}`));
export const FLOWS = ["quiz", "quiz-corner", "quiz-overlay-editorial", "code"];
