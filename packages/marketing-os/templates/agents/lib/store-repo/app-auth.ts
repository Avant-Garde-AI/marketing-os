/**
 * GitHub App installation tokens — per-tenant repo credentials for the hosted
 * platform.
 *
 * WHY NOT A PAT: a self-hosted console serves exactly one store, so a single
 * GITHUB_TOKEN in its env is proportionate. The hosted platform serves many
 * tenants with many repos, and one shared PAT there would mean every tenant's
 * artifacts are writable with the same credential — a token leak or a bug in
 * repo selection is a cross-tenant write. A GitHub App issues a token scoped to
 * ONE installation, expiring in an hour, and the store owner can see and revoke
 * it. That difference is the whole reason this file exists.
 *
 * FLOW: sign a short JWT with the app's private key → exchange it for an
 * installation access token for the tenant's repo → cache until shortly before
 * it expires.
 *
 * Configure with GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (PKCS#8 PEM; escaped
 * "\n" is tolerated because env UIs mangle newlines). When they are absent this
 * module reports "not configured" and the caller falls back to GITHUB_TOKEN,
 * which keeps self-hosted working unchanged.
 */

import { createSign, createPrivateKey } from "node:crypto";

const API = "https://api.github.com";
/** Refresh this long before the hour is up, so an in-flight call can't age out. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
/** repo → installation id. Stable; worth not re-resolving per call. */
const installationCache = new Map<string, number>();

export function appAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

function privateKey(): ReturnType<typeof createPrivateKey> {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
  // Vercel/Secret-Manager UIs commonly store PEMs with literal backslash-n.
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  return createPrivateKey(pem);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * App JWT — RS256, signed with the app's private key. Short-lived by design;
 * GitHub rejects anything over 10 minutes.
 */
function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      // Backdate a little: GitHub rejects a JWT whose iat is in the future, and
      // small clock skew between a serverless host and GitHub is routine.
      iat: now - 60,
      exp: now + 9 * 60,
      iss: process.env.GITHUB_APP_ID,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey()).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function resolveInstallationId(repo: string, jwt: string): Promise<number> {
  const cached = installationCache.get(repo);
  if (cached) return cached;

  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`malformed repo "${repo}" — expected "owner/name"`);

  const res = await fetch(`${API}/repos/${owner}/${name}/installation`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) {
    // The actionable failure: the owner has to install the app on that repo.
    throw new Error(
      `The Marketing OS GitHub App is not installed on ${repo}. ` +
        `Install it (or grant it access to this repository) and retry.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Could not resolve a GitHub App installation for ${repo} (${res.status})`);
  }
  const json = (await res.json()) as { id?: number };
  if (typeof json.id !== "number") throw new Error(`GitHub returned no installation id for ${repo}`);
  installationCache.set(repo, json.id);
  return json.id;
}

/**
 * An installation access token for `repo`, scoped to that repo's contents.
 *
 * The permissions/repositories narrowing is requested explicitly rather than
 * inheriting the installation's full grant: if the owner installed the app
 * org-wide, an un-narrowed token would be writable across every repo they own.
 * Ask for the least this needs.
 */
export async function installationTokenFor(repo: string): Promise<string> {
  const hit = tokenCache.get(repo);
  if (hit && Date.now() < hit.expiresAt - EXPIRY_SKEW_MS) return hit.token;

  const jwt = appJwt();
  const installationId = await resolveInstallationId(repo, jwt);
  const [, name] = repo.split("/");

  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repositories: [name],
      permissions: { contents: "write" },
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub App token exchange failed for ${repo} (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { token?: string; expires_at?: string };
  if (!json.token) throw new Error(`GitHub App returned no token for ${repo}`);

  tokenCache.set(repo, {
    token: json.token,
    expiresAt: json.expires_at ? Date.parse(json.expires_at) : Date.now() + 55 * 60 * 1000,
  });
  return json.token;
}

/** Drop cached credentials for a repo — used when a write fails on auth. */
export function forgetInstallation(repo: string): void {
  tokenCache.delete(repo);
  installationCache.delete(repo);
}
