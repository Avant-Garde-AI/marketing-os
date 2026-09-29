// Fixture imagery, painted with CSS and rasterised by Playwright at test
// start (see run.mjs). Nothing here is a real store's artwork; nothing is
// committed as a binary. Served to the runtime as https://cdn.shopify.com/…
// through a route, so the runtime's CDN allowlist is exercised for real.

const grain =
  "repeating-radial-gradient(circle at 17% 32%, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)," +
  "repeating-radial-gradient(circle at 71% 64%, rgba(0,0,0,.03) 0 1px, transparent 1px 4px)";

function page(w, h, body, css) {
  return {
    w,
    h,
    html: `<!doctype html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:${w}px;height:${h}px;overflow:hidden}
      ${css}
    </style></head><body>${body}</body></html>`,
  };
}

// A colour-field canvas: soft-edged blocks, the way oil feathers into a ground.
function field(ground, blocks) {
  return (
    `<div class="cv" style="background:${ground}">` +
    blocks
      .map(
        ([top, height, color, blur]) =>
          `<div style="position:absolute;left:7%;right:7%;top:${top}%;height:${height}%;background:${color};filter:blur(${blur || 6}px);opacity:.96"></div>`,
      )
      .join("") +
    `<div style="position:absolute;inset:0;background:${grain}"></div></div>`
  );
}

const CANVAS_CSS = ".cv{position:absolute;inset:0;overflow:hidden}";

// A gallery wall: warm plaster, raking light, a framed canvas, a bench.
export function interior() {
  return page(
    1600,
    1200,
    `<div class="wall"></div><div class="light"></div>
     <div class="frame"><div class="mat"><div class="art">${field("#d9c7a8", [
       [6, 40, "#b5482a", 10],
       [49, 6, "#e3b04b", 5],
       [58, 36, "#23385a", 12],
     ])}</div></div></div>
     <div class="floor"></div><div class="bench"></div><div class="benchshadow"></div>`,
    `${CANVAS_CSS}
     .wall{position:absolute;inset:0 0 22% 0;background:linear-gradient(180deg,#ece5d9,#e0d6c6)}
     .light{position:absolute;inset:0;background:radial-gradient(ellipse 60% 55% at 42% 30%,rgba(255,250,238,.75),rgba(255,250,238,0) 70%),radial-gradient(ellipse 50% 40% at 90% 90%,rgba(60,40,20,.18),transparent)}
     .frame{position:absolute;left:540px;top:150px;width:540px;height:660px;background:#221d19;padding:16px;box-shadow:0 40px 60px -26px rgba(50,30,10,.55),0 12px 18px -6px rgba(0,0,0,.2)}
     .mat{width:100%;height:100%;background:#f5f2ea;padding:40px}
     .art{position:relative;width:100%;height:100%;overflow:hidden}
     .floor{position:absolute;left:0;right:0;bottom:0;height:22%;background:linear-gradient(180deg,#a88461,#7f603f);box-shadow:inset 0 10px 18px -8px rgba(0,0,0,.35)}
     .bench{position:absolute;left:470px;top:1000px;width:680px;height:46px;background:linear-gradient(180deg,#3b2f26,#2a211a)}
     .benchshadow{position:absolute;left:450px;top:1050px;width:720px;height:40px;background:radial-gradient(ellipse at center,rgba(0,0,0,.35),transparent 70%)}`,
  );
}

// Close crop of a canvas — for full-bleed compositions.
export function study() {
  return page(
    1600,
    1200,
    field("#cdb99a", [
      [-4, 44, "#9c3b22", 18],
      [42, 8, "#e1a93f", 10],
      [52, 52, "#1d2f4c", 20],
    ]) + `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(255,240,220,.25),transparent 60%)"></div>`,
    CANVAS_CSS,
  );
}

// Product shots: a single framed piece on a pale wall.
const PALETTES = [
  ["#e9e2d4", [[8, 50, "#c4552f"], [62, 30, "#2c3f63"]]],
  ["#dfe3dc", [[10, 34, "#5f7f5a"], [48, 44, "#1f2a24"]]],
  ["#efe6d8", [[6, 28, "#d9a441"], [38, 56, "#8a3b2c"]]],
  ["#e6e2ea", [[12, 76, "#3d3a6b"]]],
  ["#ece4da", [[8, 24, "#b86b4b"], [36, 24, "#e4c07a"], [64, 28, "#51443a"]]],
  ["#dde5e8", [[10, 40, "#7aa0ad"], [54, 36, "#23434f"]]],
];
export function print(i) {
  const [ground, blocks] = PALETTES[i % PALETTES.length];
  return page(
    800,
    1000,
    `<div class="frame"><div class="art">${field(ground, blocks)}</div></div>`,
    `${CANVAS_CSS}
     body{background:linear-gradient(180deg,#f1ede6,#e7e1d7)}
     .frame{position:absolute;left:170px;top:160px;width:460px;height:600px;background:#fbfaf7;padding:26px;border:10px solid #1f1b18;box-shadow:0 30px 44px -22px rgba(40,25,10,.5)}
     .art{position:relative;width:100%;height:100%;overflow:hidden}`,
  );
}

export const IMAGES = {
  "interior.jpg": interior(),
  "study.jpg": study(),
  ...Object.fromEntries(PALETTES.map((_, i) => [`print-${i + 1}.jpg`, print(i)])),
};
