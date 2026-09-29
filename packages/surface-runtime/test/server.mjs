// Tiny local stand-in for a storefront + the app proxy. Serves the fixture
// page, the runtime under test, the fixture manifest, generated images, and
// fake /apps/mcp/surfaces/{events,capture} endpoints that record every call.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, asPreview } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUNTIME = process.env.MOS_RUNTIME || join(HERE, "..", "dist", "surface-runtime.js");
export const IMG_DIR = join(HERE, ".cache", "img");
export const REWARD_CODE = "ARTH-7KQ2M";

export function startServer() {
  const log = []; // { kind: "event" | "capture", body, t }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };

    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { body = raw; }
        if (url.pathname === "/apps/mcp/surfaces/events") {
          log.push({ kind: "event", body, t: Date.now() });
          return send(204, "text/plain", "");
        }
        if (url.pathname === "/apps/mcp/surfaces/capture") {
          log.push({ kind: "capture", body, t: Date.now() });
          return send(200, "application/json", JSON.stringify({ ok: true, reward: { code: REWARD_CODE } }));
        }
        if (url.pathname === "/__reset") {
          log.length = 0;
          return send(204, "text/plain", "");
        }
        return send(404, "text/plain", "no");
      });
      return;
    }

    if (url.pathname === "/__log") return send(200, "application/json", JSON.stringify(log));
    if (url.pathname === "/surface-runtime.js") return send(200, "text/javascript", readFileSync(RUNTIME));
    if (url.pathname === "/surface-diag.js") return send(200, "text/javascript", readFileSync(join(dirname(RUNTIME), "surface-diag.js")));
    if (url.pathname === "/fixture.js") {
      const m = FIXTURES[url.searchParams.get("fx")];
      if (!m) return send(200, "text/javascript", "window.MOS_MANIFEST = { surfaces: [] };");
      // A fixture may be one surface or several live at once.
      const list = (Array.isArray(m) ? m : [m]).map((s) => (url.searchParams.has("mos_preview") ? asPreview(s) : s));
      return send(200, "text/javascript", `window.MOS_MANIFEST = ${JSON.stringify({ surfaces: list })};`);
    }
    if (url.pathname.startsWith("/img/")) {
      const f = join(IMG_DIR, url.pathname.slice(5).replace(/[^a-z0-9.-]/gi, ""));
      if (existsSync(f)) return send(200, "image/jpeg", readFileSync(f));
      return send(404, "text/plain", "no image");
    }
    if (url.pathname === "/favicon.ico") return send(204, "text/plain", "");
    // Any other path is "a storefront page" so /products/… exercises pageType.
    return send(200, "text/html; charset=utf-8", readFileSync(join(HERE, "fixture.html")));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        log,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
