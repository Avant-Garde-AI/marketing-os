import { NextResponse } from "next/server";
import { packMeta } from "@/lib/skills-catalog";
import { upsertEnablement } from "@/lib/skill-enablements";
import { checkProviderConnection } from "@/lib/provider-connections";

/**
 * Skill enablement writes (WS4-R4 / 05 H1).
 *
 * Session-authed by the middleware (not excluded from the matcher), the same
 * posture as /api/offers/deploy. Body: { packId, enabled?, config? }.
 *
 * H1.2 is enforced HERE, server-side, not just by the disabled toggle in the
 * UI: enabling a pack whose catalog entry `requires` providers is refused
 * (409) until a live connection exists for each — the response carries the
 * connect pointer. The hosted runtime's dynamic tool merge reads the row per
 * request, so a disable takes effect within one request cycle.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { packId?: string; enabled?: boolean; config?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const meta = body.packId ? packMeta(body.packId) : undefined;
  if (!meta) {
    return NextResponse.json({ error: "Unknown pack." }, { status: 404 });
  }
  if (body.enabled === undefined && body.config === undefined) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }
  if (body.config !== undefined) {
    // Only catalog-declared wiring keys land in the jsonb (H1.3).
    const allowed = new Set(meta.configFields.map((f) => f.key));
    const rejected = Object.keys(body.config).filter((k) => !allowed.has(k));
    if (rejected.length > 0) {
      return NextResponse.json(
        { error: `Unknown config keys: ${rejected.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // The enable gate (H1.2): every required provider must be live.
  if (body.enabled === true && meta.requires.length > 0) {
    for (const provider of meta.requires) {
      const health = await checkProviderConnection(provider, meta.id);
      if (health.state !== "connected") {
        return NextResponse.json(
          {
            error: `Connect ${provider} first — ${meta.name} can't be enabled without it.`,
            provider,
            state: health.state,
            ...(health.actionUrl ? { connectUrl: health.actionUrl } : {}),
          },
          { status: 409 }
        );
      }
    }
  }

  try {
    const row = await upsertEnablement({
      packId: meta.id,
      version: meta.version,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      actor: "console",
    });
    return NextResponse.json({ ok: true, enablement: row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed." },
      { status: 503 }
    );
  }
}
