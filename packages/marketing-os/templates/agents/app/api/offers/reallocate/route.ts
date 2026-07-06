import { NextResponse } from "next/server";

/**
 * Apply an experiment decision (spec 14, O3). Session-authed (middleware);
 * forwards to the platform policy loop with the server-side tenant key.
 */
export async function POST(req: Request) {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiUrl || !apiKey) {
    return NextResponse.json({ error: "Platform link not configured." }, { status: 503 });
  }
  const body = await req.json();
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/offers/reallocate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    return NextResponse.json({ error: `Platform returned ${res.status}.` }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: (json.detail as string) ?? (json.error as string) ?? "Reallocation failed." },
      { status: res.status }
    );
  }
  return NextResponse.json(json);
}
