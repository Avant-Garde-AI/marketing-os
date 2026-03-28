/**
 * GET /api/shopify/status
 *
 * Returns agent fleet status, recent activity, and connection state
 * for the Shopify mini admin panel. Reads shop from the session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { getShopifySession } from "@/lib/shopify/session";
import { getGitHubConnection } from "@/lib/github/connection";

export async function GET(request: NextRequest) {
  const shop = request.cookies.get("shopify_shop")?.value
    ?? process.env.SHOPIFY_STORE_URL;

  if (!shop) {
    return NextResponse.json({ error: "No shop context" }, { status: 401 });
  }

  // Check if we have a valid Shopify session
  const session = await getShopifySession(shop);
  const shopifyConnected = !!session?.accessToken;

  // Fetch store info if connected
  let storeName = shop.replace(".myshopify.com", "");
  if (shopifyConnected) {
    try {
      const res = await fetch(
        `https://${shop}/admin/api/2024-10/shop.json`,
        { headers: { "X-Shopify-Access-Token": session!.accessToken } }
      );
      if (res.ok) {
        const data = await res.json();
        storeName = data.shop?.name ?? storeName;
      }
    } catch {
      // Non-critical — fall through with default name
    }
  }

  // Check GitHub connection — stored via OAuth in github_connections table,
  // or via env vars for self-hosted mode
  const ghConn = await getGitHubConnection(shop);
  const githubConnected = !!ghConn?.githubToken || !!process.env.GITHUB_TOKEN;
  const githubUser = ghConn?.githubUser;
  const repoUrl = ghConn?.repoFullName
    ? `https://github.com/${ghConn.repoFullName}`
    : process.env.GITHUB_REPO
      ? `https://github.com/${process.env.GITHUB_REPO}`
      : undefined;
  const onboarded = githubConnected && !!repoUrl;

  // TODO: Pull real agent status from Mastra runtime once wired up.
  // For now, return structure so the UI can render immediately.
  const status = {
    shop,
    storeName,
    onboarded,
    githubConnected,
    githubUser,
    repoUrl,
    connections: {
      shopify: shopifyConnected,
      slack: !!process.env.SLACK_BOT_TOKEN,
      github: githubConnected,
    },
    agents: [
      {
        id: "marketing-agent",
        name: "Marketing Agent",
        status: "idle" as const,
        lastRun: null as string | null,
      },
      {
        id: "creative-agent",
        name: "Creative Agent",
        status: "idle" as const,
        lastRun: null as string | null,
      },
    ],
    recentActivity: [] as Array<{
      id: string;
      type: string;
      summary: string;
      timestamp: string;
    }>,
    dashboardUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  };

  return NextResponse.json(status);
}
