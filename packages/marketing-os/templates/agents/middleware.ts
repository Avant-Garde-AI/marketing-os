import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // Skip auth in local development
  if (process.env.NODE_ENV === "development") {
    return response;
  }

  // ----- Shopify embedded mode -----
  // When running as a Shopify embedded app, auth is handled by the
  // Shopify OAuth flow (shopify_shop cookie), not Supabase sessions.
  const isEmbedded = process.env.SHOPIFY_EMBEDDED === "true";

  if (isEmbedded) {
    const shopCookie = request.cookies.get("shopify_shop")?.value;

    // Allow OAuth and admin routes through unconditionally
    // (admin routes are protected by x-admin-secret header, not cookies)
    if (
      pathname.startsWith("/api/shopify/auth") ||
      pathname.startsWith("/api/github/auth") ||
      pathname.startsWith("/api/admin") ||
      pathname.startsWith("/admin")
    ) {
      return response;
    }

    // No shop session → kick off OAuth install flow
    if (!shopCookie) {
      const shop = request.nextUrl.searchParams.get("shop");
      if (shop) {
        // Shopify is loading us in the iframe with ?shop= — start OAuth
        return NextResponse.redirect(
          new URL(`/api/shopify/auth?shop=${shop}`, request.url)
        );
      }
      // No shop param at all — can't proceed
      return NextResponse.json(
        { error: "Missing shop parameter" },
        { status: 400 }
      );
    }

    // Has a valid shop cookie — route to mini admin if hitting root
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/shopify", request.url));
    }
    return response;
  }

  // ----- Standalone mode (Supabase auth) -----
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
  if (!session && !pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from login
  if (session && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|auth/callback).*)",
  ],
};
