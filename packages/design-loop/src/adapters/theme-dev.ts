// @ts-nocheck
/**
 * Real ThemeServer adapter — wraps `shopify theme dev` (same invocation as
 * scripts/dev/start.sh). Loaded only on a live run. Not typechecked or tested in
 * the core build; exercised in the bench/integration tier.
 */
import { spawn } from "node:child_process";

export async function createThemeServer(config) {
  const port = config.themePort ?? 9292;
  const themePath = process.env.SHOPIFY_THEME_PATH ?? ".";
  const child = spawn("shopify", ["theme", "dev", "--path", themePath, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(baseUrl, 60_000);

  return {
    baseUrl: () => baseUrl,
    stop: async () => {
      child.kill("SIGTERM");
    },
  };
}

async function waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, { method: "HEAD" });
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`shopify theme dev did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
