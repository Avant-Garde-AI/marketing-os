/**
 * Keeping Instagram publish tokens alive.
 *
 * ## The failure this exists to end
 *
 * An Instagram long-lived token lives 60 days. Arthaus's was issued on 17
 * July, expired on 15 September at 08:55, and nobody found out until a publish
 * was attempted three days later. Nothing was broken — the system simply had
 * no way to renew a credential it kept in an environment variable, because
 * env vars cannot be written at runtime. The token was always going to die on
 * a timer; the only question was whether anyone would be watching.
 *
 * ## Why this can be automatic
 *
 * `ig_refresh_token` takes the CURRENT token and nothing else — no app id, no
 * app secret, no user interaction. So any process holding a live token can
 * mint its successor. The missing half was somewhere to put it, which is what
 * `storeChannelToken` (Vault, via the broker) now provides.
 *
 * ## The two hard constraints
 *
 * 1. **A token must be at least 24 hours old to refresh.** Refreshing on every
 *    cron tick would therefore fail constantly, and — worse — a system that
 *    treats a normal refusal as an error teaches operators to ignore its
 *    alarms.
 * 2. **An EXPIRED token cannot be refreshed at all.** There is no recovery
 *    path but a human re-authorising in the Meta dashboard. This is why the
 *    threshold is generous: renewing with ten days to spare costs nothing and
 *    leaves room for a fortnight of failed attempts before anyone must act.
 *
 * Refreshing does not invalidate the old token — it stays valid until its own
 * expiry — so a refresh that succeeds but fails to store is survivable rather
 * than an outage. That asymmetry is why the store happens after the mint and
 * a storage failure is reported loudly instead of retried silently.
 */

const GRAPH_BASE = () =>
  (process.env.SOCIAL_IG_GRAPH_BASE ?? "https://graph.instagram.com/v23.0").replace(/\/$/, "");

/** Renew when fewer than this many days remain. */
export const REFRESH_THRESHOLD_DAYS = 10;

/** Instagram's own floor: a token younger than this cannot be refreshed. */
export const MIN_TOKEN_AGE_HOURS = 24;

export interface RefreshedToken {
  token: string;
  /** Seconds the NEW token is good for, as Instagram reports it. */
  expiresIn: number;
  expiresAt: Date;
}

/**
 * Exchange a live long-lived token for a fresh 60-day one.
 *
 * Throws with Instagram's own message on failure — the distinction between
 * "too young to refresh", "already expired" and "scope revoked" matters to
 * whoever reads the log, and flattening them into "refresh failed" would
 * discard the only information that tells them what to do.
 */
export async function refreshInstagramToken(currentToken: string): Promise<RefreshedToken> {
  const url = new URL(`${GRAPH_BASE()}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentToken);

  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string; code?: number; error_subcode?: number };
  };

  if (!res.ok || body.error || !body.access_token) {
    const e = body.error;
    throw new Error(
      `Instagram token refresh failed (${res.status})` +
        (e ? `: ${e.message} [code=${e.code}${e.error_subcode ? ` sub=${e.error_subcode}` : ""}]` : ""),
    );
  }

  // Instagram has returned a token without expires_in in the past. Assume the
  // documented 60 days rather than recording "unknown": an assumed expiry is
  // re-checked every day by the sweep, whereas a null one would silently opt
  // this token out of refreshing forever.
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 60 * 86_400;
  return {
    token: body.access_token,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export type RefreshVerdict =
  | { action: "refreshed"; expiresAt: Date; daysRemaining: number }
  | { action: "skipped"; reason: string; daysRemaining: number | null }
  | { action: "failed"; reason: string; daysRemaining: number | null };

/**
 * Decide and act, given what the connection currently says.
 *
 * `daysRemaining` is null when nothing has ever recorded an expiry — the state
 * a store is in the moment before its first refresh, while the token still
 * lives in env. That case REFRESHES, deliberately: it is the migration. The
 * env token seeds Vault on the first sweep that sees it, and from then on the
 * credential lives somewhere that can be rotated, with no OAuth flow and no
 * operator involved.
 */
export async function maybeRefreshInstagram(deps: {
  currentToken: () => Promise<string>;
  daysRemaining: number | null;
  store: (t: RefreshedToken) => Promise<void>;
}): Promise<RefreshVerdict> {
  const { daysRemaining } = deps;

  if (daysRemaining !== null && daysRemaining > REFRESH_THRESHOLD_DAYS) {
    return {
      action: "skipped",
      reason: `${daysRemaining} days remaining — refreshes at ${REFRESH_THRESHOLD_DAYS}`,
      daysRemaining,
    };
  }

  if (daysRemaining !== null && daysRemaining < 0) {
    return {
      action: "failed",
      reason:
        "the token has already EXPIRED and cannot be refreshed — an expired Instagram token has no recovery path but re-authorising the account in the Meta app dashboard (Instagram → API setup with Instagram login → Generate token)",
      daysRemaining,
    };
  }

  let token: string;
  try {
    token = await deps.currentToken();
  } catch (e) {
    return {
      action: "failed",
      reason: `no current token to refresh: ${e instanceof Error ? e.message : String(e)}`,
      daysRemaining,
    };
  }

  let refreshed: RefreshedToken;
  try {
    refreshed = await refreshInstagramToken(token);
  } catch (e) {
    return { action: "failed", reason: e instanceof Error ? e.message : String(e), daysRemaining };
  }

  try {
    await deps.store(refreshed);
  } catch (e) {
    // The new token EXISTS and was not saved. The old one still works until
    // its own expiry, so this is recoverable — but only if someone is told,
    // because every later sweep will mint another token nobody keeps.
    return {
      action: "failed",
      reason:
        `refreshed successfully but could not STORE the new token — the old one still works until it expires, ` +
        `and this will keep happening until storage is fixed: ${e instanceof Error ? e.message : String(e)}`,
      daysRemaining,
    };
  }

  return {
    action: "refreshed",
    expiresAt: refreshed.expiresAt,
    daysRemaining: Math.floor(refreshed.expiresIn / 86_400),
  };
}

export interface TokenIdentity {
  userId: string;
  username: string;
  accountType?: string;
}

/**
 * Ask Instagram whether a token actually works, and whose it is.
 *
 * Stored state cannot answer this. A credential that was revoked, or
 * invalidated because someone changed a password, looks exactly like a healthy
 * one in the database — `status = 'active'`, expiry in the future, nothing
 * amiss. The only source of truth is the API that will refuse the publish.
 */
export async function validateInstagramToken(
  token: string,
): Promise<{ ok: true; identity: TokenIdentity } | { ok: false; reason: string }> {
  const url = new URL(`${GRAPH_BASE()}/me`);
  url.searchParams.set("fields", "user_id,username,account_type");
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as {
      user_id?: string | number;
      username?: string;
      account_type?: string;
      error?: { message?: string };
    };
    if (!res.ok || body.error || !body.username) {
      return { ok: false, reason: body.error?.message ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      identity: {
        userId: String(body.user_id ?? ""),
        username: body.username,
        ...(body.account_type ? { accountType: body.account_type } : {}),
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type RepairVerdict =
  | { action: "healthy"; identity: TokenIdentity }
  | { action: "repaired"; identity: TokenIdentity; note: string }
  | { action: "broken"; reason: string };

/**
 * Make sure the token the publish path will USE is one that works.
 *
 * `brokerTokenSource` prefers Vault and falls back to env only when the broker
 * ERRORS — not when it returns a token that is present, well-formed and dead.
 * So a stale Vault entry silently SHADOWS a freshly-set env token, and every
 * publish fails while the operator looks at a correct-looking env var and a
 * connection row marked active. That is precisely what Arthaus hit: a token
 * regenerated in the Meta dashboard had no effect, because nothing was reading
 * it.
 *
 * Repair, rather than merely report, because the fix is unambiguous: if the
 * stored credential is refused and the bootstrap one is accepted, the
 * bootstrap is right and Vault is stale. Anything else would require a human
 * to know that Vault shadows env, which is exactly the knowledge this seam
 * exists to remove.
 *
 * It never repairs in the other direction. A working stored token is left
 * alone even when env disagrees, because env is the bootstrap and Vault is
 * where the rotating credential lives.
 */
export async function ensureUsableInstagramToken(deps: {
  storedToken: () => Promise<string>;
  bootstrapToken: () => Promise<string>;
  store: (token: string, identity: TokenIdentity) => Promise<void>;
}): Promise<RepairVerdict> {
  let stored: string | null = null;
  let storedFailure = "no stored token";
  try {
    stored = await deps.storedToken();
  } catch (e) {
    storedFailure = e instanceof Error ? e.message : String(e);
  }

  if (stored) {
    const check = await validateInstagramToken(stored);
    if (check.ok) return { action: "healthy", identity: check.identity };
    storedFailure = check.reason;
  }

  let bootstrap: string;
  try {
    bootstrap = await deps.bootstrapToken();
  } catch (e) {
    return {
      action: "broken",
      reason: `stored token unusable (${storedFailure}); no bootstrap token either (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  // Same value, already known bad — say so plainly rather than "repairing" it
  // into the same failure and reporting success.
  if (bootstrap === stored) {
    return { action: "broken", reason: `the only token available is being refused: ${storedFailure}` };
  }

  const check = await validateInstagramToken(bootstrap);
  if (!check.ok) {
    return {
      action: "broken",
      reason: `stored token unusable (${storedFailure}); bootstrap token also refused (${check.reason})`,
    };
  }

  await deps.store(bootstrap, check.identity);
  return {
    action: "repaired",
    identity: check.identity,
    note: `the stored credential was being refused (${storedFailure}) and was shadowing a working one; the working token is now stored`,
  };
}
