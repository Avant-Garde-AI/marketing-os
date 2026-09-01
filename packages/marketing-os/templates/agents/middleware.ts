import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Hosted (pooled) mode: the console is served through the Shopify admin,
  // not this deployment's Supabase-auth pages. Exposed surfaces each carry
  // their own per-tenant auth: /api/mcp (connector tokens, excluded from the
  // matcher) and /api/chat (platform-signed chat handoff, verified in-route).
  // Everything else is refused so per-tenant surfaces can never be reached
  // with deployment-wide auth.
  // Public surfaces (spec 22): the Brand Portal (+ its llms.txt/raw files),
  // candidate images (unguessable UUIDs), and cron routes (CRON_SECRET
  // in-route) are deliberately public in BOTH modes.
  // Design-surface exports (spec 23 §6): renders addressed by unguessable
  // Penpot file/page UUIDs, same access model as brand-image — Slack blocks
  // and the console fetch them directly.
  // Action execute (spec 20 A1): ACTIONS_GATE_SECRET verified in-route —
  // only the platform gate holds it. Email preview + the /review/ room and
  // contact sheet (spec 25): HMAC-tokened per (scope, shop, id, expiry) since
  // campaign ids are guessable; verified in-route/in-page. These links EXPIRE —
  // /api/email/review-notes is the one WRITE among them, and it can only
  // append a note, never change campaign state.
  if (
    request.nextUrl.pathname.startsWith("/brand/") ||
    request.nextUrl.pathname.startsWith("/api/brand-image/") ||
    request.nextUrl.pathname.startsWith("/api/cron/") ||
    // Schema migrations. Carries its own shared-secret auth (fails closed) for
    // the same reason the cron routes do: it is called by a deploy step or an
    // operator, never by a browser session, so a session redirect here just
    // turns a legitimate call into a 307 nobody can debug.
    request.nextUrl.pathname.startsWith("/api/admin/migrate") ||
    request.nextUrl.pathname.startsWith("/api/design-surfaces/export/") ||
    request.nextUrl.pathname.startsWith("/api/actions/execute") ||
    request.nextUrl.pathname.startsWith("/api/email/preview/") ||
    request.nextUrl.pathname.startsWith("/api/email/review-notes") ||
    // Social's note write, same shape as email's: reachable without a console
    // session, and verified in-route by its own token (spec 26 ⟨BUILD⟩ 5).
    // `/review/` below already covers the social room + sheet pages.
    request.nextUrl.pathname.startsWith("/api/social/review-notes") ||
    request.nextUrl.pathname.startsWith("/review/")
  ) {
    return response;
  }

  if (process.env.MARKETING_OS_MODE === "hosted") {
    if (request.nextUrl.pathname.startsWith("/api/chat")) {
      return response;
    }
    return new NextResponse(
      "This is a pooled Marketing OS runtime. Use your store's MCP endpoint or the Shopify admin console.",
      { status: 403 }
    );
  }

  // Skip auth in local development
  if (process.env.NODE_ENV === "development") {
    return response;
  }

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Redirect unauthenticated users to login
  if (!session && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from login
  if (session && request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // api/mcp (connector tokens), api/surfaces (router-signed proxy handoff),
    // and api/cron (CRON_SECRET / Vercel cron) carry their own auth and must
    // not be redirected to login.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/mcp|api/surfaces|api/cron|auth/callback).*)",
  ],
};
