import { NextResponse } from "next/server";

/**
 * Offer deploy-on-approve (spec 14, O2/D3).
 *
 * Called by the console's OfferProposalCard after the merchant clicks
 * Approve. Session-authed by the middleware (this route is NOT excluded);
 * the tenant API key stays server-side. The platform re-validates the
 * surface mechanically before storing it ACTIVE — the storefront picks it
 * up within the manifest cache window.
 */
export async function POST(req: Request) {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiUrl || !apiKey) {
    return NextResponse.json({ error: "Platform link not configured." }, { status: 503 });
  }

  const { surface } = await req.json();
  if (!surface) return NextResponse.json({ error: "missing surface" }, { status: 400 });

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/offers/surfaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ surface }),
  });
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    return NextResponse.json(
      { error: `Platform returned ${res.status} — offers API may not be deployed.` },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: (json.detail as string) ?? (json.error as string) ?? "Deploy failed." },
      { status: res.status }
    );
  }
  return NextResponse.json(json);
}
