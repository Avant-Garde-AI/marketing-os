import { NextResponse, type NextRequest } from "next/server";
import {
  isDesignSurfaceExportConfigured,
  penpotUrl,
} from "@/lib/design-surfaces/config";
import { sharedCookieDomain } from "@/lib/design-surfaces/cookie-domain";

/**
 * Studio session handoff (spec 23 DS4 — "the proxy + cookie flow").
 *
 * Spec 23 §3 says opening a canvas must never show a Penpot login. It never
 * did the second half of that: the session-minting seam exists (the export lane
 * needs it — the exporter authenticates by session, not access token) but the
 * minted session only ever lived server-side, so the embedded canvas showed a
 * Penpot login form.
 *
 * This mints one and hands it to the browser.
 *
 * WHY A COOKIE ON THE PARENT DOMAIN WORKS. The console and the Design Studio
 * alias are the same SITE — www.arthaus.cloud and design.arthaus.cloud share the
 * registrable domain — so a cookie scoped to ".arthaus.cloud" is sent to both,
 * including from inside the iframe. That is also the whole reason the tenant
 * alias exists (spec 23 §3 D2); a cross-site embed could not do this at all.
 *
 * THE HONEST LIMITATION, and it must not become permanent by accident: everyone
 * who opens the Studio is logged in as the ONE platform service account. Canvas
 * edits therefore carry no author, and anyone who can reach the console can act
 * as that account. That matches the as-built tenancy model (§2: a service
 * account owns all teams) and is acceptable for a single-store console. It does
 * NOT generalise to the hosted platform, where tenants must not share an
 * identity. OIDC (§3, deferred in REVISIT) is the real answer; this is the
 * bridge to it.
 *
 * Protected by the console's own auth: this route is NOT in the middleware's
 * public allow-list, so an unauthenticated caller is redirected to /login and
 * never reaches the mint. That is the only thing standing between a visitor and
 * a service credential, so it is deliberate rather than incidental.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cookie Penpot authenticates with. Named here so the coupling is visible. */
const PENPOT_COOKIE = "auth-token";

/** Only ever bounce back to a path on this origin. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/studio";
  return raw;
}

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  if (!isDesignSurfaceExportConfigured()) {
    // Nothing to mint with. Send the user on rather than erroring — they get
    // the Penpot login, which is exactly today's behaviour.
    return NextResponse.redirect(new URL(next, req.url));
  }

  const base = penpotUrl();
  const embed = (process.env.NEXT_PUBLIC_PENPOT_EMBED_URL ?? base).replace(/\/$/, "");

  let domain: string | null;
  try {
    domain = sharedCookieDomain(req.nextUrl.host, new URL(embed).host);
  } catch {
    domain = null;
  }
  if (!domain) {
    console.error(
      `[studio-session] console (${req.nextUrl.host}) and studio (${embed}) are not same-site — ` +
        `a handoff cookie cannot reach the canvas. Configure the tenant alias (spec 23 §3 D2).`,
    );
    return NextResponse.redirect(new URL(next, req.url));
  }

  let token: string;
  try {
    const res = await fetch(`${base}/api/rpc/command/login-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: process.env.PENPOT_SERVICE_EMAIL,
        password: process.env.PENPOT_SERVICE_PASSWORD,
      }),
    });
    if (!res.ok) throw new Error(`login-with-password returned ${res.status}`);
    const match = (res.headers.get("set-cookie") ?? "").match(/auth-token=([^;]+)/);
    if (!match) throw new Error("login-with-password returned no auth-token cookie");
    token = match[1]!;
  } catch (e) {
    // Never echo the response body — it can carry the credential back.
    console.error("[studio-session] mint failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.redirect(new URL(next, req.url));
  }

  const response = NextResponse.redirect(new URL(next, req.url));
  response.cookies.set({
    name: PENPOT_COOKIE,
    value: token,
    domain,
    path: "/",
    httpOnly: true,
    secure: true,
    // Lax, not Strict: the canvas loads in an iframe on a sibling subdomain.
    // Same-site either way, but Strict withholds on cross-origin navigations
    // and buys nothing here.
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
