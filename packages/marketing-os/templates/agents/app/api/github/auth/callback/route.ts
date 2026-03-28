/**
 * GET /api/github/auth/callback
 *
 * Handles GitHub OAuth callback:
 *   1. Validates state (nonce)
 *   2. Exchanges code for access token
 *   3. Fetches GitHub user info
 *   4. Stores the token in Supabase (associated with the shop)
 *   5. Redirects back to the mini admin to continue onboarding
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeGitHubCode } from "@/lib/github/oauth";
import { storeGitHubConnection } from "@/lib/github/connection";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state parameter" },
      { status: 400 }
    );
  }

  // Verify nonce
  const storedNonce = request.cookies.get("github_oauth_nonce")?.value;
  if (!storedNonce || storedNonce !== state) {
    return NextResponse.json(
      { error: "Invalid state — possible CSRF" },
      { status: 403 }
    );
  }

  const shop = request.cookies.get("shopify_shop")?.value;
  if (!shop) {
    return NextResponse.json(
      { error: "No Shopify shop context. Install the Shopify app first." },
      { status: 400 }
    );
  }

  try {
    const { accessToken, scope } = await exchangeGitHubCode(code);

    // Fetch GitHub user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = await userRes.json();

    // Store the connection
    await storeGitHubConnection({
      shop,
      githubToken: accessToken,
      githubUser: user.login,
      scope,
    });

    // Redirect back to mini admin — onboarding will continue
    const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
    const isEmbedded = process.env.SHOPIFY_EMBEDDED === "true";

    let redirectUrl: string;
    if (isEmbedded) {
      const storeName = shop.replace(".myshopify.com", "");
      redirectUrl = `https://admin.shopify.com/store/${storeName}/apps/${process.env.SHOPIFY_CLIENT_ID}`;
    } else {
      redirectUrl = `${appUrl}/shopify`;
    }

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete("github_oauth_nonce");
    return response;
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    return NextResponse.json(
      { error: "Failed to complete GitHub OAuth" },
      { status: 500 }
    );
  }
}
