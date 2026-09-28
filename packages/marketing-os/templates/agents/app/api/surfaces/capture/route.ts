import { NextResponse } from "next/server";
import { verifyProxyHandoff } from "@/lib/proxy-auth";
import { createShopifyClient } from "@/lib/shopify";
import { answerTags, mergeTags } from "@/lib/offers/capture-tags";

/**
 * Offer email capture (spec 14, O0/D1; spec 34 §2.5 answers).
 *
 * Writes the email as a Shopify customer with EXPLICIT marketing consent —
 * compliance rides Shopify's native rails; ESP sync (Klaviyo etc.) happens
 * downstream of Shopify, not here. Tagged with the surface id for attribution,
 * and with a v2 offer's zero-party answers as `mos-ans:<key>:<value>` tags.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!verifyProxyHandoff(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { email?: string; surfaceId?: string; arm?: string; consentText?: string; answers?: unknown };
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
  const answers = answerTags(payload.answers);
  const consent = {
    state: "subscribed",
    opt_in_level: "single_opt_in",
    consent_updated_at: new Date().toISOString(),
  };

  try {
    const created = await shopify.rest<{ customer?: { id?: number } }>("customers.json", {
      method: "POST",
      body: JSON.stringify({
        customer: {
          email,
          tags: [`mos-offer`, payload.surfaceId ?? "unknown", `arm:${payload.arm ?? "na"}`, ...answers].join(","),
          email_marketing_consent: consent,
        },
      }),
    });
    const customerId = created.customer?.id != null ? String(created.customer.id) : null;
    console.log("[mos-surface-capture]", JSON.stringify({ surfaceId: payload.surfaceId, arm: payload.arm, answers: answers.length }));
    return NextResponse.json({ ok: true, customerId });
  } catch (err) {
    // Existing customer (422) → update their marketing consent instead.
    try {
      const found = await shopify.rest<{ customers: { id: number; tags?: string }[] }>(
        `customers/search.json?query=${encodeURIComponent(`email:${email}`)}&limit=1&fields=id,tags`
      );
      const existing = found.customers?.[0];
      if (existing?.id) {
        const id = existing.id;
        // Shopify's PUT replaces the whole tag list, so answers are MERGED
        // into what the customer already carries — never overwrite.
        const update: Record<string, unknown> = { id, email_marketing_consent: consent };
        if (answers.length > 0) update.tags = mergeTags(existing.tags, answers);
        await shopify.rest(`customers/${id}.json`, {
          method: "PUT",
          body: JSON.stringify({ customer: update }),
        });
        console.log("[mos-surface-capture]", JSON.stringify({ surfaceId: payload.surfaceId, arm: payload.arm, resubscribed: true }));
        return NextResponse.json({ ok: true, customerId: String(id) });
      }
    } catch {
      /* fall through */
    }
    console.log("[mos-surface-capture-error]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: "capture_failed" }, { status: 502 });
  }
}
