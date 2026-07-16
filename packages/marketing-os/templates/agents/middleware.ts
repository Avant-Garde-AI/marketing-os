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
  if (
    request.nextUrl.pathname.startsWith("/brand/") ||
    request.nextUrl.pathname.startsWith("/api/brand-image/") ||
    request.nextUrl.pathname.startsWith("/api/cron/") ||
    request.nextUrl.pathname.startsWith("/api/design-surfaces/export/")
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
