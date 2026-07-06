import { NextResponse } from "next/server";
import { verifyProxyHandoff } from "@/lib/proxy-auth";

/**
 * Surface event beacon (spec 14, O0): impression / exposure / dismiss /
 * engage / capture, stamped with experiment arm + allocation version.
 *
 * O0 sink: structured log lines (queryable in Vercel logs — enough to sanity-
 * check the funnel). O1 replaces this with the per-arm counter store that
 * feeds the Beta posteriors.
 */
export async function POST(req: Request) {
  if (!verifyProxyHandoff(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const e = await req.json();
    console.log(
      "[mos-surface-event]",
      JSON.stringify({
        surfaceId: e.surfaceId,
        experimentId: e.experimentId,
        arm: e.arm,
        allocation: e.allocation,
        event: e.event,
        page: e.page,
        visitorId: e.visitorId,
        ts: e.ts,
      })
    );
  } catch {
    // Malformed beacons are dropped silently — never error at the storefront.
  }
  return new NextResponse(null, { status: 204 });
}
