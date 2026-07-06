import { NextResponse } from "next/server";
import { verifyProxyHandoff } from "@/lib/proxy-auth";
import { createShopifyClient } from "@/lib/shopify";

/**
 * Offer email capture (spec 14, O0/D1).
 *
 * Writes the email as a Shopify customer with EXPLICIT marketing consent —
 * compliance rides Shopify's native rails; ESP sync (Klaviyo etc.) happens
 * downstream of Shopify, not here. Tagged with the surface id for attribution.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!verifyProxyHandoff(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { email?: string; surfaceId?: string; arm?: string; consentText?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 422 });
  }

  const shopify = createShopifyClient();
  const consent = {
    state: "subscribed",
    opt_in_level: "single_opt_in",
    consent_updated_at: new Date().toISOString(),
  };

  try {
    await shopify.rest("customers.json", {
      method: "POST",
      body: JSON.stringify({
        customer: {
          email,
          tags: `mos-offer,${payload.surfaceId ?? "unknown"},arm:${payload.arm ?? "na"}`,
          email_marketing_consent: consent,
        },
      }),
    });
    console.log("[mos-surface-capture]", JSON.stringify({ surfaceId: payload.surfaceId, arm: payload.arm }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Existing customer (422) → update their marketing consent instead.
    try {
      const found = await shopify.rest<{ customers: { id: number }[] }>(
        `customers/search.json?query=${encodeURIComponent(`email:${email}`)}&limit=1`
      );
      const id = found.customers?.[0]?.id;
      if (id) {
        await shopify.rest(`customers/${id}.json`, {
          method: "PUT",
          body: JSON.stringify({ customer: { id, email_marketing_consent: consent } }),
        });
        console.log("[mos-surface-capture]", JSON.stringify({ surfaceId: payload.surfaceId, arm: payload.arm, resubscribed: true }));
        return NextResponse.json({ ok: true });
      }
    } catch {
      /* fall through */
    }
    console.log("[mos-surface-capture-error]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "capture_failed" }, { status: 502 });
  }
}
