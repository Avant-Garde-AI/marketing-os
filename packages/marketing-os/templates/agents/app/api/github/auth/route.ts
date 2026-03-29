/**
 * GET /api/github/auth
 *
 * Starts GitHub OAuth — redirects merchant to GitHub consent screen.
 * After auth, GitHub redirects back to /api/github/auth/callback.
 */

import { NextResponse } from "next/server";
import { buildGitHubAuthUrl, generateNonce } from "@/lib/github/oauth";

export async function GET() {
  const nonce = generateNonce();
  const authUrl = buildGitHubAuthUrl(nonce);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("github_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
