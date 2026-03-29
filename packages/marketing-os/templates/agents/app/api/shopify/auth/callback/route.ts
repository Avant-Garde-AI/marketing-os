/**
 * GET /api/shopify/auth/callback
 *
 * Handles the Shopify OAuth callback:
 *   1. Verifies HMAC signature from Shopify
 *   2. Validates the nonce (state) against the stored cookie
 *   3. Exchanges the authorization code for an access token
 *   4. Stores the session in Supabase
 *   5. Redirects to the app (either embedded in Shopify Admin or standalone)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyHmac, exchangeCodeForToken, isValidShopDomain } from "@/lib/shopify/oauth";
import { storeShopifySession } from "@/lib/shopify/session";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const { shop, code, state, hmac } = params;

  // --- Validate required params ---
  if (!shop || !code || !state || !hmac) {
    return NextResponse.json(
      { error: "Missing required OAuth parameters" },
      { status: 400 }
    );
  }

  if (!isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Invalid shop domain" },
      { status: 400 }
    );
  }

  // --- Verify HMAC ---
  if (!verifyHmac(params)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 403 }
    );
  }

  // --- Verify nonce (CSRF protection) ---
  const storedNonce = request.cookies.get("shopify_oauth_nonce")?.value;
  if (!storedNonce || storedNonce !== state) {
    return NextResponse.json(
      { error: "Invalid OAuth state — possible CSRF attack" },
      { status: 403 }
    );
  }

  // --- Exchange code for token ---
  try {
    const { accessToken, scope } = await exchangeCodeForToken(shop, code);

    // --- Store session ---
    await storeShopifySession({
      shop,
      accessToken,
      scope,
      installedAt: new Date().toISOString(),
    });

    // --- Redirect into the app ---
    // If running embedded in Shopify Admin, redirect back into the admin iframe.
    // Otherwise redirect to the standalone app root.
    const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
    const isEmbedded = process.env.SHOPIFY_EMBEDDED === "true";

    let redirectUrl: string;
    if (isEmbedded) {
      // Redirect to Shopify Admin which will re-embed our app
      const storeName = shop.replace(".myshopify.com", "");
      redirectUrl = `https://admin.shopify.com/store/${storeName}/apps/${process.env.SHOPIFY_CLIENT_ID}`;
    } else {
      redirectUrl = `${appUrl}/?shop=${shop}`;
    }

    const response = NextResponse.redirect(redirectUrl);

    // Clean up OAuth cookies
    response.cookies.delete("shopify_oauth_nonce");
    response.cookies.delete("shopify_oauth_shop");

    // Set a session cookie so middleware knows this shop is authenticated
    response.cookies.set("shopify_shop", shop, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Shopify OAuth callback error:", error);
    return NextResponse.json(
      { error: "Failed to complete OAuth handshake" },
      { status: 500 }
    );
  }
}
