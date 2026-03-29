/**
 * Admin API for cross-merchant management.
 *
 * GET  /api/admin/merchants         → list all merchants + stats
 * POST /api/admin/merchants/:action → manage individual merchants
 *
 * Protected by ADMIN_SECRET header — only accessible to platform operators.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listMerchants,
  getMerchant,
  getMerchantStats,
  updateMerchant,
} from "@/lib/merchants/store";
import { deprovisionMerchant } from "@/lib/anthropic/admin";
import { deleteShopifySession } from "@/lib/shopify/session";

// ---------------------------------------------------------------------------
// Auth — simple shared secret for admin endpoints
// ---------------------------------------------------------------------------
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("x-admin-secret");
  return provided === secret;
}

// ---------------------------------------------------------------------------
// GET /api/admin/merchants
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl;
  const status = url.searchParams.get("status") as any;
  const plan = url.searchParams.get("plan") as any;
  const limit = parseInt(url.searchParams.get("limit") ?? "50");
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  try {
    const [merchantData, stats] = await Promise.all([
      listMerchants({ status, plan, limit, offset }),
      getMerchantStats(),
    ]);

    return NextResponse.json({
      merchants: merchantData.merchants,
      total: merchantData.total,
      stats,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch merchants" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/merchants — actions on individual merchants
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, shop } = body;

  if (!action || !shop) {
    return NextResponse.json(
      { error: "action and shop are required" },
      { status: 400 }
    );
  }

  const merchant = await getMerchant(shop);
  if (!merchant) {
    return NextResponse.json(
      { error: "Merchant not found" },
      { status: 404 }
    );
  }

  try {
    switch (action) {
      case "pause":
        await updateMerchant(shop, { status: "paused" });
        return NextResponse.json({ success: true, message: `Paused ${shop}` });

      case "resume":
        await updateMerchant(shop, { status: "active" });
        return NextResponse.json({ success: true, message: `Resumed ${shop}` });

      case "upgrade":
        if (!body.plan) {
          return NextResponse.json({ error: "plan is required" }, { status: 400 });
        }
        await updateMerchant(shop, { plan: body.plan });
        return NextResponse.json({ success: true, message: `Upgraded ${shop} to ${body.plan}` });

      case "uninstall":
        // Deprovision Anthropic workspace
        if (merchant.anthropicWorkspaceId) {
          await deprovisionMerchant(merchant.anthropicWorkspaceId);
        }
        // Clean up sessions
        await deleteShopifySession(shop);
        // Mark as uninstalled (keep record for auditing)
        await updateMerchant(shop, { status: "uninstalled" });
        return NextResponse.json({ success: true, message: `Uninstalled ${shop}` });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Action failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
