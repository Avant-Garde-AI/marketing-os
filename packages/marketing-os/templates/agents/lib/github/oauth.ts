/**
 * GitHub OAuth for connecting merchant's GitHub account.
 *
 * Flow:
 *   1. GET  /api/github/auth          → redirect to GitHub consent
 *   2. GET  /api/github/auth/callback  → exchange code, store token
 *
 * Requires a GitHub OAuth App registered with:
 *   - Homepage URL: your app URL
 *   - Callback URL: {app URL}/api/github/auth/callback
 *
 * Env vars: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 */

import crypto from "crypto";

export function buildGitHubAuthUrl(nonce: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("GITHUB_CLIENT_ID is required");

  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const redirectUri = `${appUrl}/api/github/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo workflow",
    state: nonce,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(
  code: string
): Promise<{ accessToken: string; scope: string }> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required");
  }

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);

  const data = await res.json();
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
  }

  return { accessToken: data.access_token, scope: data.scope };
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}
