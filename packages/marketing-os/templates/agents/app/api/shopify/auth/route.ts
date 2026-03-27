/**
 * GET /api/shopify/auth?shop=mystore.myshopify.com
 *
 * Starts the Shopify OAuth flow:
 *   1. Validates the shop parameter
 *   2. Generates a nonce and stores it in a cookie
 *   3. Redirects to Shopify's authorization screen
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthUrl, isValidShopDomain } from "@/lib/shopify/oauth";

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get("shop");

  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter. Expected format: mystore.myshopify.com" },
      { status: 400 }
    );
  }

  // Generate a nonce to prevent CSRF
  const nonce = crypto.randomBytes(16).toString("hex");

  // Build the Shopify authorization URL
  const authUrl = buildAuthUrl(shop, nonce);

  // Store the nonce in a secure cookie for verification on callback
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("shopify_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  // Also store the shop domain for callback verification
  response.cookies.set("shopify_oauth_shop", shop, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
