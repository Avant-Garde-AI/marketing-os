/**
 * Shareable review links — one place, so the token scheme can't drift between
 * the tools that mint links, the pages that serve them, and the routes that
 * verify them.
 *
 * WHY TOKENS AT ALL: campaign ids are guessable (`2026-09-10-editorial-…`),
 * unlike the unguessable UUIDs that gate brand-image and design-surface
 * exports. So these surfaces carry an HMAC over the thing being addressed.
 *
 * WHY THEY EXPIRE: a review link is meant to travel — into Slack threads, into
 * a Claude Code session's output, onto someone's second monitor. Travelling
 * credentials get copied, and the old scheme (HMAC over shop+id, nothing else)
 * was valid until the secret rotated, i.e. forever. Links now carry an expiry
 * day that is INSIDE the signature, so it can't be edited without breaking it.
 *
 * The cut-over is deliberate and total: there is no acceptance path for a
 * legacy unexpiring token. Honouring old links "just for compatibility" would
 * mean anyone holding one keeps permanent access, which is the exact property
 * we set out to remove. A handful of links minted during UAT stop working; the
 * tools re-mint on demand.
 *
 * WHAT A TOKEN IS NOT: proof of identity. It proves possession of a link.
 * Anyone holding it is "someone with the URL" and nothing more — which is why
 * approval lives in Slack (real user id, real audit row) and these surfaces
 * only ever read, or accept a self-declared note.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** What a link is allowed to address. Scope is signed, so a preview token
 *  cannot be replayed against the review room or the month sheet. */
export type LinkScope = "preview" | "review" | "sheet";

/** Default life of a shared link. Long enough to survive a planning cycle and
 *  a holiday; short enough that a leaked link dies before the campaign does. */
export const DEFAULT_TTL_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Epoch-day, not epoch-second: keeps URLs short and makes every link minted
 *  on the same day byte-identical, so re-running a build doesn't invalidate
 *  the link already pasted in a Slack thread. */
function today(): number {
  return Math.floor(Date.now() / MS_PER_DAY);
}

function secret(): string | null {
  return process.env.ACTIONS_GATE_SECRET ?? process.env.CRON_SECRET ?? null;
}

function sign(scope: LinkScope, shop: string, id: string, expDay: number): string | null {
  const key = secret();
  if (!key) return null; // dev without secrets; verify() is equally permissive
  return createHmac("sha256", key)
    .update(`email-link:v2:${scope}:${shop}:${id}:${expDay}`)
    .digest("base64url")
    .slice(0, 32);
}

export interface MintedLink {
  /** Absolute URL, token and expiry included. */
  url: string;
  /** ISO date the link stops working — surface it wherever the URL is shown. */
  expiresAt: string;
}

/** Public base of this deployment (same env pattern the brand-soul and
 *  design-surface tools use to mint hosted links). */
function publicBase(): string {
  return (
    process.env.MOS_AGENTS_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function mint(scope: LinkScope, shop: string, id: string, path: string, ttlDays: number): MintedLink {
  const expDay = today() + Math.max(1, Math.floor(ttlDays));
  const t = sign(scope, shop, id, expDay);
  const qs = new URLSearchParams({ shop });
  if (scope === "sheet") qs.set("month", id);
  if (t) {
    qs.set("t", t);
    qs.set("e", String(expDay));
  }
  return {
    url: `${publicBase()}${path}?${qs.toString()}`,
    expiresAt: new Date(expDay * MS_PER_DAY).toISOString().slice(0, 10),
  };
}

/** Raw assembled HTML — what Klaviyo will receive. Used by the console iframe
 *  and by "open full size". */
export function emailPreviewLink(shop: string, campaignId: string, ttlDays = DEFAULT_TTL_DAYS): MintedLink {
  return mint("preview", shop, campaignId, `/api/email/preview/${encodeURIComponent(campaignId)}`, ttlDays);
}

/** The review room — the email plus the context a reviewer needs to judge it.
 *  This is the link to hand a teammate. */
export function emailReviewLink(shop: string, campaignId: string, ttlDays = DEFAULT_TTL_DAYS): MintedLink {
  return mint("review", shop, campaignId, `/review/email/${encodeURIComponent(campaignId)}`, ttlDays);
}

/** A month of campaigns on one page — the link to hand a team after a planning
 *  session, instead of five separate ones. `month` is YYYY-MM. */
export function emailSheetLink(shop: string, month: string, ttlDays = DEFAULT_TTL_DAYS): MintedLink {
  return mint("sheet", shop, month, `/review/email`, ttlDays);
}

/**
 * Days left on a token the caller already holds.
 *
 * The review room uses this to mint its embedded raw-preview link with the
 * SAME remaining life: a link handed to a reviewer must not become a way to
 * mint a fresher, longer-lived one. Without this, opening a review room on its
 * last day would hand out a 30-day preview link and the expiry would leak.
 */
export function ttlRemaining(expDay: string | null): number {
  if (!expDay) return DEFAULT_TTL_DAYS;
  const e = Number(expDay);
  if (!Number.isInteger(e)) return DEFAULT_TTL_DAYS;
  return Math.max(1, e - today());
}

export type VerifyResult = "ok" | "expired" | "invalid";

/**
 * Verify a token from a request. Returns a reason rather than a boolean so
 * callers can tell a reviewer "this link expired, ask for a fresh one" instead
 * of the flat 403 that reads like a bug.
 *
 * Comparison is constant-time: these tokens are short and an attacker can
 * request as many as they like, so a byte-by-byte early exit is a real oracle.
 */
export function verifyLink(
  scope: LinkScope,
  shop: string,
  id: string,
  token: string | null,
  expDay: string | null,
): VerifyResult {
  // No secret configured (local dev): the whole scheme is off, matching sign().
  if (!secret()) return "ok";
  if (!token || !expDay) return "invalid";

  const exp = Number(expDay);
  if (!Number.isInteger(exp)) return "invalid";

  const expected = sign(scope, shop, id, exp);
  if (!expected) return "ok";

  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // Length check first — timingSafeEqual throws on a mismatch, and length is
  // not the secret here (it's a fixed 32 for every token we mint).
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";

  // Signature is good, so `exp` is ours and untampered. Check it last.
  if (today() > exp) return "expired";
  return "ok";
}
