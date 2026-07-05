import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Hosted (pooled) mode: the console is served through the Shopify admin,
  // not this deployment's Supabase-auth pages. Only /api/mcp (own connector
  // auth, excluded from the matcher) is exposed; everything else is refused so
  // per-tenant surfaces can never be reached with deployment-wide auth.
  if (process.env.MARKETING_OS_MODE === "hosted") {
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
    // api/mcp has its own connector-token auth and must not be redirected to login.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/mcp|auth/callback).*)",
  ],
};
