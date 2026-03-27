/**
 * Shopify OAuth 2.0 authorization code flow for Marketing OS.
 *
 * Starts a temporary local HTTP server, opens the Shopify consent screen in the
 * browser, and exchanges the authorization code for an offline access token.
 *
 * This is the recommended auth path — it removes the need for store owners to
 * manually create a custom app and paste tokens.
 */

import http from "node:http";
import crypto from "node:crypto";
import chalk from "chalk";
import open from "open";

import {
  REQUIRED_SCOPES,
  DEFAULT_APP_CLIENT_ID,
  DEFAULT_APP_CLIENT_SECRET,
} from "./shopify-auth.js";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthResult {
  accessToken: string;
  scope: string;
}

/**
 * Find an available port by binding to port 0 and reading back the assignment.
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine port")));
      }
    });
    srv.on("error", reject);
  });
}

/**
 * Build the Shopify OAuth authorization URL.
 */
export function buildAuthorizationUrl(
  shop: string,
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const scopes = REQUIRED_SCOPES.join(",");
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    // Request an offline (long-lived) access token
    "grant_options[]": "",
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an offline access token.
 */
async function exchangeCodeForToken(
  shop: string,
  code: string,
  clientId: string,
  clientSecret: string
): Promise<OAuthResult> {
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Token exchange failed (HTTP ${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    scope: data.scope,
  };
}

/**
 * Verify that the HMAC query parameter from Shopify is authentic.
 */
function verifyHmac(
  query: URLSearchParams,
  clientSecret: string
): boolean {
  const hmac = query.get("hmac");
  if (!hmac) return false;

  // Build the message from all query params except hmac, sorted alphabetically
  const params = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (key !== "hmac") {
      params.set(key, value);
    }
  }
  params.sort();

  const message = params.toString();
  const computed = crypto
    .createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hmac, "hex"),
    Buffer.from(computed, "hex")
  );
}

/**
 * Run the full Shopify OAuth flow:
 *
 * 1. Start a temporary local HTTP server on a random port
 * 2. Open the Shopify OAuth consent screen in the user's browser
 * 3. Wait for the callback with the authorization code
 * 4. Exchange the code for an offline access token
 * 5. Shut down the local server and return the token
 *
 * @param shop - The Shopify store domain (e.g. mystore.myshopify.com)
 * @param credentials - Optional client ID/secret override (defaults to the
 *   Marketing OS default app registered in the Partners Dashboard)
 * @param timeoutMs - How long to wait for the user to authorize (default 5 min)
 */
export async function runOAuthFlow(
  shop: string,
  credentials?: OAuthCredentials,
  timeoutMs = 300_000
): Promise<OAuthResult> {
  const clientId = credentials?.clientId ?? DEFAULT_APP_CLIENT_ID;
  const clientSecret = credentials?.clientSecret ?? DEFAULT_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Shopify OAuth requires SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET. " +
        "Set these environment variables or use the manual custom-app token flow instead."
    );
  }

  const port = await getAvailablePort();
  const redirectUri = `http://localhost:${port}/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  return new Promise<OAuthResult>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(
          new Error(
            "OAuth flow timed out — the authorization was not completed in time."
          )
        );
      }
    }, timeoutMs);

    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // Only handle the callback path
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const query = url.searchParams;
      const code = query.get("code");
      const returnedState = query.get("state");

      // Validate state to prevent CSRF
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorPage("State mismatch — possible CSRF attempt. Please try again."));
        return;
      }

      // Verify HMAC signature from Shopify
      if (!verifyHmac(query, clientSecret)) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorPage("Invalid HMAC signature. Please try again."));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorPage("No authorization code received from Shopify."));
        return;
      }

      try {
        const result = await exchangeCodeForToken(
          shop,
          code,
          clientId,
          clientSecret
        );

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successPage());

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.close();
          resolve(result);
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(
          errorPage(
            err instanceof Error ? err.message : "Token exchange failed."
          )
        );
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.close();
          reject(err);
        }
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const authUrl = buildAuthorizationUrl(shop, clientId, redirectUri, state);

      console.log(
        chalk.dim(
          `\n  Starting local OAuth server on http://localhost:${port}`
        )
      );
      console.log(
        chalk.dim("  Opening Shopify authorization page in your browser...\n")
      );

      open(authUrl).catch(() => {
        console.log(
          chalk.yellow(
            `  Could not open browser automatically. Please visit:\n  ${authUrl}\n`
          )
        );
      });
    });

    server.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function successPage(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Marketing OS — Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh;
         margin: 0; background: #f8f9fa; color: #1a1a2e; }
  .card { text-align: center; padding: 3rem; background: white; border-radius: 12px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08); max-width: 420px; }
  h1 { font-size: 1.5rem; margin: 0.5rem 0; }
  p { color: #666; line-height: 1.6; }
  .check { font-size: 3rem; }
</style></head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Shopify Connected</h1>
    <p>Your store is now connected to Marketing OS.<br>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Marketing OS — Error</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh;
         margin: 0; background: #f8f9fa; color: #1a1a2e; }
  .card { text-align: center; padding: 3rem; background: white; border-radius: 12px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08); max-width: 420px; }
  h1 { font-size: 1.5rem; margin: 0.5rem 0; color: #d32f2f; }
  p { color: #666; line-height: 1.6; }
  .icon { font-size: 3rem; }
</style></head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h1>Connection Failed</h1>
    <p>${message}</p>
    <p>Please return to the terminal and try again.</p>
  </div>
</body>
</html>`;
}
