/**
 * The render worker (src/harness/offer-render-worker.mjs) against local
 * fixture pages with a local Playwright Chromium — the same script a host
 * runs in its sandbox, minus the sandbox:
 *
 *   - preview mode waits for the runtime's diag handshake and returns
 *     window.__mosDiag (and reports not-ready when it never comes);
 *   - audit mode finds a Klaviyo-shaped popup, measures it, and ignores our
 *     own [data-mos-surface];
 *   - NEITHER mode lets a request reach /apps/mcp/surfaces/events|capture.
 *
 * Needs a Chromium for playwright-core (`pnpm exec playwright-core install
 * chromium`); skips cleanly when none is available. Ported from the hosted
 * app's scripts/test-offer-render-worker.mts.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDOR_FINGERPRINTS } from "../src/harness/index";

const WORKER = fileURLToPath(new URL("../src/harness/offer-render-worker.mjs", import.meta.url));
const blocked: string[] = [];

const PREVIEW = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Store</h1><script>
  // Stand-in for the v2 runtime's diag contract (CONTRACT §3).
  setTimeout(() => {
    const host = document.createElement("div");
    host.setAttribute("data-mos-surface", "ofr_x__c1");
    host.style.cssText = "position:fixed;left:20px;top:100px;width:300px;height:400px;background:#F5F2ED";
    document.body.appendChild(host);
    navigator.sendBeacon("/apps/mcp/surfaces/events", JSON.stringify({ event: "exposure" }));
    fetch("/apps/mcp/surfaces/capture", { method: "POST", body: "{}" }).catch(() => {});
    window.__mosDiag = { surfaceId: "ofr_x__c1", arm: new URLSearchParams(location.search).get("mos_arm"),
      step: Number(new URLSearchParams(location.search).get("mos_step")), steps: 2,
      viewport: { w: innerWidth, h: innerHeight }, composition: "split-image",
      rects: { card: { x: 20, y: 100, w: 300, h: 400 }, choices: [] }, overflow: false, contrast: [], imageLoaded: null, errors: [] };
    document.documentElement.dataset.mosReady = "1";
  }, 400);
</script></body></html>`;

const NEVER_READY = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>No runtime here.</p></body></html>`;

const KLAVIYO = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Store</h1>
<script src="/static.klaviyo.com/onsite/js/klaviyo.js"></script>
<div data-mos-surface="ours" style="position:fixed;right:0;bottom:0;width:10px;height:10px"></div>
<script>
  navigator.sendBeacon("/apps/mcp/surfaces/events", "{}");
  setTimeout(() => {
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", "POPUP Form");
    d.style.cssText = "position:fixed;inset:10% 10%;background:#fff;padding:20px";
    d.innerHTML = '<button aria-label="Close dialog" style="width:20px;height:20px;padding:0">×</button>' +
      '<p>Get 15% off your first order</p><input type="email" placeholder="Email">' +
      '<button type="submit" style="color:#fff;background:#000;height:40px;width:200px">Claim offer</button>';
    document.body.appendChild(d);
  }, 1500);
</script></body></html>`;

function serve(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (path.startsWith("/apps/mcp/surfaces/")) {
      blocked.push(path);
      res.end("{}");
      return;
    }
    if (path.endsWith(".js")) {
      res.setHeader("content-type", "text/javascript");
      res.end("window._klOnsite = window._klOnsite || [];");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(path === "/klaviyo" ? KLAVIYO : path === "/never" ? NEVER_READY : PREVIEW);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    }),
  );
}

function runWorker(taskFile: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [WORKER, taskFile],
      { env: { ...process.env, MOS_PLAYWRIGHT_MODULE: "playwright-core" }, timeout: 120_000 },
      (err, _stdout, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stderr }),
    );
  });
}

test("render worker: preview diag, audit measurement, and no event/capture requests", { timeout: 150_000 }, async (ctx) => {
  const { url, close } = await serve();
  const dir = mkdtempSync(join(tmpdir(), "mos-render-test-"));
  const outDir = join(dir, "out");
  const q = "?mos_preview=tok&mos_arm=v1&mos_step=1&mos_diag=1";
  writeFileSync(
    join(dir, "task.json"),
    JSON.stringify({
      outDir,
      concurrency: 2,
      fingerprints: VENDOR_FINGERPRINTS,
      tasks: [
        { id: "p_mobile", url: `${url}/${q}`, viewport: "mobile", mode: "preview" },
        { id: "p_desktop", url: `${url}/${q}`, viewport: "desktop", mode: "preview" },
        { id: "never", url: `${url}/never${q}`, viewport: "desktop", mode: "preview", waitMs: 1500 },
        { id: "audit_desktop", url: `${url}/klaviyo`, viewport: "desktop", mode: "audit", waitMs: 6000 },
      ],
    }),
  );
  try {
    const run = await runWorker(join(dir, "task.json"));
    if (run.code !== 0 && /Executable doesn't exist|browserType\.launch/i.test(run.stderr)) {
      console.warn("render worker test SKIPPED — no local Chromium for playwright-core");
      ctx.skip();
      return;
    }
    assert.equal(run.code, 0, run.stderr);
    const results = JSON.parse(readFileSync(join(outDir, "results.json"), "utf8")) as {
      id: string;
      ok: boolean;
      facts: Record<string, unknown> | null;
      extra: Record<string, unknown>;
    }[];
    const by = Object.fromEntries(results.map((r) => [r.id, r]));

    for (const id of ["p_mobile", "p_desktop"]) {
      assert.equal(by[id]!.ok, true);
      assert.equal(by[id]!.extra.ready, true);
      assert.equal((by[id]!.facts as { step: number }).step, 1);
      assert.ok(existsSync(join(outDir, `${id}.jpg`)));
    }
    assert.deepEqual((by.p_mobile!.facts as { viewport: unknown }).viewport, { w: 390, h: 844 });
    assert.deepEqual((by.p_desktop!.facts as { viewport: unknown }).viewport, { w: 1440, h: 900 });
    assert.equal(by.never!.extra.ready, false);
    assert.equal(by.never!.facts, null);

    const audit = by.audit_desktop!.facts as Record<string, unknown>;
    assert.equal(audit.vendor, "klaviyo");
    assert.equal(audit.appeared, true);
    assert.ok((audit.timeToShowMs as number) >= 1400);
    assert.deepEqual(audit.closeTarget, { w: 20, h: 20 });
    assert.deepEqual(audit.ctaTarget, { w: 200, h: 40 });
    assert.ok((audit.ctaContrast as number) > 15);
    assert.equal(audit.incentiveText, "15% off");
    assert.equal(audit.closeVisibleAtFirstPaint, true);
    assert.equal(by.audit_desktop!.extra.oursPresent, true, "our own surface is noticed, not graded");

    // The whole point: nothing reached the event or capture endpoints.
    assert.deepEqual(blocked, []);
    const blockedInPage = results.reduce((n, r) => n + Number(r.extra.blockedBeacons ?? 0) + Number(r.extra.blockedRequests ?? 0), 0);
    assert.ok(blockedInPage >= 3, `worker intercepted the runtime's calls (${blockedInPage})`);
  } finally {
    close();
  }
});
