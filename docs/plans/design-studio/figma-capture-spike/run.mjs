import { chromium } from "playwright-core";
import fs from "fs";
const F = "/usr/share/fonts/truetype/dejavu/";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const asked = [];
await p.exposeFunction("__loadFont", (family, weight, italic) => {
  asked.push(`${family}/${weight}/${italic}`);
  const serif = /serif/i.test(family) && !/sans/i.test(family);
  const bold = Number(weight) >= 600;
  const file = (serif ? "DejaVuSerif" : "DejaVuSans") + (bold ? "-Bold" : "") + ".ttf";
  return fs.readFileSync(F + file).toString("base64");
});
await p.goto("file://" + process.cwd() + "/page.html");
await p.addScriptTag({ content: fs.readFileSync("bundle.js","utf8") });
const t0 = Date.now();
const r = await p.evaluate(() => window.__toFigma("body", 1440));
console.log(JSON.stringify(r, null, 1));
console.log("fonts asked:", [...new Set(asked)].join(", "));


await b.close();
