/**
 * Expiring, signed links into the social review surfaces (spec 26 §0.1).
 *
 * Same construction as the email pack's — HMAC over (scope, shop, id, expDay)
 * with the expiry INSIDE the signature so it cannot be edited without breaking
 * it — but with its own signing domain. A social token must never verify
 * against an email link and vice versa: sharing the prefix would let a token
 * minted for one surface open the other.
 *
 * WHAT A TOKEN PROVES, AND WHAT IT DOES NOT. It proves possession of a link.
 * It does not prove identity. There is therefore no honest way for a review
 * surface to produce an approver, and it must not try: the room shows approval
 * STATE and stops. Approval happens in Slack, where the interaction carries a
 * real user id that becomes the `actor` on mos_action_audit — a row you can
 * defend. The single write a review link may make is appending a note.
 *
 * Blast radius of a leaked link: read a post group, add rows to a notes table
 * a human reads. Bounded on purpose.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type LinkScope = "preview" | "review" | "sheet";

export const DEFAULT_TTL_DAYS = 30;

export interface MintedLink {
  url: string;
  /** YYYY-MM-DD the link stops working. */
  expiresAt: string;
}

function secret(): string | null {
  return process.env.ACTIONS_GATE_SECRET ?? process.env.CRON_SECRET ?? null;
}

function baseUrl(): string {
  return (
    process.env.MOS_AGENTS_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

/** Epoch-day. Links minted the same day are byte-identical, which keeps a
 * re-share from silently extending anyone's access. */
function today(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function dayToDate(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The signed string IS the contract. `social-link:v1` is the signing domain —
 * deliberately different from email's `email-link:v2`, so the two schemes can
 * never cross-verify.
 */
function sign(scope: LinkScope, shop: string, id: string, expDay: number): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key)
    .update(`social-link:v1:${scope}:${shop}:${id}:${expDay}`)
    .digest("base64url")
    .slice(0, 32);
}

function mint(scope: LinkScope, path: string, shop: string, id: string, ttlDays: number): MintedLink {
  const expDay = today() + Math.max(1, Math.floor(ttlDays));
  const qs = new URLSearchParams({ shop });
  // The sheet's id is a month and travels as its own parameter, because the
  // path has no id segment to carry it.
  if (scope === "sheet") qs.set("month", id);
  const token = sign(scope, shop, id, expDay);
  if (token) {
    qs.set("t", token);
    qs.set("e", String(expDay));
  }
  return { url: `${baseUrl()}${path}?${qs.toString()}`, expiresAt: dayToDate(expDay) };
}

/** The review room for one post GROUP (spec 26 D3 — the unit is the group). */
export function socialReviewLink(shop: string, groupKey: string, ttlDays = DEFAULT_TTL_DAYS): MintedLink {
  return mint("review", `/review/social/${encodeURIComponent(groupKey)}`, shop, groupKey, ttlDays);
}

/** The month sheet — every group planned for a month. */
export function socialSheetLink(shop: string, month: string, ttlDays = DEFAULT_TTL_DAYS): MintedLink {
  return mint("sheet", "/review/social", shop, month, ttlDays);
}

/**
 * Life left on an existing link, in days.
 *
 * A room opened on its LAST day must mint its embedded links with the
 * remaining life, not a fresh 30 days — otherwise the room becomes a
 * token-refresh oracle and an expiry never actually arrives.
 */
export function ttlRemaining(expDay: string | null): number {
  const e = Number(expDay);
  if (!expDay || !Number.isInteger(e)) return DEFAULT_TTL_DAYS;
  return Math.max(1, e - today());
}

export type VerifyResult = "ok" | "expired" | "invalid";

/**
 * Verify a link's token. Signature is checked BEFORE expiry on purpose: an
 * expired-but-valid link earns the honest "this expired, ask for a fresh one"
 * message, while a forged one only ever learns that it is invalid.
 */
export function verifyLink(
  scope: LinkScope,
  shop: string,
  id: string,
  token: string | null,
  expDay: string | null,
): VerifyResult {
  // No secret configured (local dev): the scheme is off entirely rather than
  // half-on. Mint emits no token, so verify must not demand one.
  if (!secret()) return "ok";
  if (!token || !expDay) return "invalid";
  const e = Number(expDay);
  if (!Number.isInteger(e)) return "invalid";
  const expected = sign(scope, shop, id, e);
  if (!expected) return "invalid";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";
  return e <= today() ? "expired" : "ok";
}
