import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant-context";

/**
 * Klaviyo private-key connect, proxied to the platform (WS4-R4 / WS1-R2).
 *
 * The console's Klaviyo card posts the merchant-pasted pk_ key here
 * (session-authed by the middleware, same posture as /api/offers/deploy);
 * this route forwards it server-side to the platform's
 * POST /api/klaviyo/connect-key using the deploy-route base-URL pattern
 * (MARKETING_OS_API_URL + Bearer MARKETING_OS_API_KEY) so the key never
 * transits with deployment-wide auth exposed to the browser.
 *
 * KNOWN SEAM (report to the platform workstream): the platform route as
 * currently written authenticates via the EMBEDDED App Bridge admin session
 * (authenticate.admin), not the tenant API key — until it grows a
 * deployment-key lane this proxy will surface the platform's auth refusal,
 * and the card's "Open Integrations" link (the CONNECT_URL precedent the
 * semantic layer uses) is the working path.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiUrl || !apiKey) {
    return NextResponse.json({ error: "Platform link not configured." }, { status: 503 });
  }

  let body: { apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.apiKey || typeof body.apiKey !== "string" || !body.apiKey.startsWith("pk_")) {
    return NextResponse.json(
      { error: "Paste a Klaviyo private API key (it starts with pk_)." },
      { status: 400 }
    );
  }

  const { shop } = getTenant();
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/klaviyo/connect-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-mos-tenant-shop": shop,
    },
    body: JSON.stringify({ apiKey: body.apiKey }),
  });

  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    return NextResponse.json(
      {
        error: `Platform returned ${res.status} — connect from Marketing OS → Integrations instead.`,
      },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          (json.message as string) ??
          (json.error as string) ??
          "Connect failed — try Marketing OS → Integrations.",
      },
      { status: res.status }
    );
  }
  // Success shape from the platform: { ok, accountId, organizationName, conversionMetric }.
  return NextResponse.json(json);
}
