import { NextResponse } from "next/server";

/**
 * Nightly experiment steward (spec 14, O3).
 *
 * For every surface already on the thompson policy, re-run the reallocation
 * from fresh posteriors. NEVER promotes and never flips a fixed experiment to
 * thompson — those are merchant decisions made in chat; this cron only keeps
 * an already-authorized bandit current.
 *
 * Auth: Vercel Cron (Authorization: Bearer CRON_SECRET when set, or the
 * x-vercel-cron header on platform-invoked runs).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (secret ? auth !== `Bearer ${secret}` : !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiUrl = process.env.MARKETING_OS_API_URL;
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiUrl || !apiKey) {
    return NextResponse.json({ error: "platform_not_configured" }, { status: 503 });
  }
  const platform = (path: string, init?: RequestInit) =>
    fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(init?.headers ?? {}) },
    });

  const listRes = await platform("/api/offers/surfaces");
  if (!listRes.ok) return NextResponse.json({ error: "list_failed" }, { status: 502 });
  const { surfaces } = (await listRes.json()) as {
    surfaces: { surfaceId: string; status: string }[];
  };

  const results: Record<string, unknown>[] = [];
  for (const s of surfaces.filter((x) => x.status === "ACTIVE")) {
    // Only steward surfaces whose manifest policy is already thompson —
    // the reallocate endpoint is a no-op-safe check via stats regardless.
    const statsRes = await platform(`/api/offers/stats?surfaceId=${encodeURIComponent(s.surfaceId)}&days=30`);
    if (!statsRes.ok) continue;
    const stats = (await statsRes.json()) as { surfaces: { arms: { impressions: number }[] }[] };
    const arms = stats.surfaces[0]?.arms ?? [];
    const minN = Math.min(...arms.filter((a: { impressions: number }) => a.impressions > 0).map((a) => a.impressions), 0);
    if (minN < 200) { results.push({ surfaceId: s.surfaceId, action: "skipped_low_n" }); continue; }

    const rr = await platform("/api/offers/reallocate", {
      method: "POST",
      body: JSON.stringify({ surfaceId: s.surfaceId, mode: "thompson_if_enabled" }),
    });
    results.push({ surfaceId: s.surfaceId, action: rr.ok ? "reallocated" : `error_${rr.status}` });
  }

  console.log("[mos-offer-review]", JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}
