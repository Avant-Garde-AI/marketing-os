/**
 * Instance bootstrap (spec 23 §7 / DS0) — creates the platform service
 * account on a fresh Penpot instance and mints its access token.
 *
 * Uses the registration RPC pair, which requires `enable-registration` +
 * `disable-email-verification` (the DS0/local flag set). Production bootstrap
 * happens once at instance provisioning, then registration is disabled —
 * see infra/penpot/docker-compose.yaml flag documentation.
 */

export interface BootstrapResult {
  profileId: string;
  accessToken: string;
  defaultTeamId: string;
}

export async function bootstrapServiceAccount(opts: {
  baseUrl: string;
  email: string;
  password: string;
  fullname?: string;
  tokenName?: string;
}): Promise<BootstrapResult> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const json = { "Content-Type": "application/json", Accept: "application/json" };

  // 1. prepare-register-profile → registration token (idempotent-ish: fails if
  //    the email exists; callers treat that as "already bootstrapped").
  const prep = await fetch(`${base}/api/rpc/command/prepare-register-profile`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: opts.email, password: opts.password, fullname: opts.fullname ?? "MOS Service Account" }),
  });
  if (!prep.ok) throw new Error(`prepare-register-profile failed: HTTP ${prep.status} ${await prep.text()}`);
  const { token } = (await prep.json()) as { token: string };

  // 2. register-profile → session cookie.
  const reg = await fetch(`${base}/api/rpc/command/register-profile`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token, fullname: opts.fullname ?? "MOS Service Account", acceptTermsAndPrivacy: true }),
  });
  if (!reg.ok) throw new Error(`register-profile failed: HTTP ${reg.status} ${await reg.text()}`);
  const profile = (await reg.json()) as { id: string; defaultTeamId?: string; "default-team-id"?: string };
  const cookie = reg.headers.get("set-cookie");
  if (!cookie) throw new Error("register-profile returned no session cookie");
  const authCookie = cookie.split(";")[0] ?? "";

  // 3. create-access-token with the session — the raw token is only shown once.
  const tok = await fetch(`${base}/api/rpc/command/create-access-token`, {
    method: "POST",
    headers: { ...json, Cookie: authCookie },
    body: JSON.stringify({ name: opts.tokenName ?? "mos-design-surfaces" }),
  });
  if (!tok.ok) throw new Error(`create-access-token failed: HTTP ${tok.status} ${await tok.text()}`);
  const tokenRow = (await tok.json()) as { token: string };

  return {
    profileId: profile.id,
    accessToken: tokenRow.token,
    defaultTeamId: profile.defaultTeamId ?? profile["default-team-id"] ?? "",
  };
}
