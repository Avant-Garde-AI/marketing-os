import { NextResponse } from "next/server";
import { verifyProxyHandoff } from "@/lib/proxy-auth";
import manifest from "@/config/surfaces.json";

/**
 * Surface manifest (spec 14, O0). Reached only through the platform App Proxy
 * (router-signed handoff). O0: hand-authored manifest from config/surfaces.json
 * — superseded by the platform offer store in O2.
 */
export async function GET(req: Request) {
  if (!verifyProxyHandoff(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
