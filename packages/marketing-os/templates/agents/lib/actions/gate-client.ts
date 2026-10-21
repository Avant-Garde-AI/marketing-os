/**
 * Client for the platform Action gate (marketing-os-app):
 *   POST /api/actions/propose     — register a proposal + post the card
 *   POST /api/actions/invalidate  — kill a pending approval (nonce discipline)
 *
 * Auth: ACTIONS_GATE_SECRET — a shared service secret between the gate and
 * this runtime (same seam class as MOS_PLATFORM_SERVICE_KEY). The gate URL
 * rides the existing MARKETING_OS_API_URL.
 */

import { getTenant } from "../tenant-context";
import type { ActionPreview, ActionRisk } from "./types";

function gateConfig(): { apiUrl: string; secret: string } {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  const secret = process.env.ACTIONS_GATE_SECRET;
  if (!apiUrl) throw new Error("MARKETING_OS_API_URL is not configured");
  if (!secret) throw new Error("ACTIONS_GATE_SECRET is not configured");
  return { apiUrl: apiUrl.replace(/\/$/, ""), secret };
}

export interface GateProposal {
  proposalId: string;
  posted: boolean;
  channel: string | null;
}

export async function proposeToGate(input: {
  kind: string;
  title: string;
  params: unknown;
  risk: ActionRisk;
  scopes: string[];
  preview: ActionPreview;
  channel?: string;
}): Promise<GateProposal> {
  const { apiUrl, secret } = gateConfig();
  const tenant = getTenant();
  const res = await fetch(`${apiUrl}/api/actions/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      shop: tenant.shop,
      kind: input.kind,
      title: input.title,
      params: input.params,
      risk: input.risk,
      scopes: input.scopes,
      executor: "agents",
      preview: input.preview,
      proposedBy: "agent",
      ...(input.channel ? { channel: input.channel } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GateProposal> & { error?: string };
  if (!res.ok) throw new Error(`action gate propose failed (${res.status}): ${body.error ?? "unknown"}`);
  return {
    proposalId: body.proposalId ?? "",
    posted: Boolean(body.posted),
    channel: body.channel ?? null,
  };
}

export async function invalidateAtGate(proposalId: string, reason: string): Promise<boolean> {
  const { apiUrl, secret } = gateConfig();
  const res = await fetch(`${apiUrl}/api/actions/invalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ proposalId, reason }),
  });
  const body = (await res.json().catch(() => ({}))) as { invalidated?: boolean };
  return res.ok && Boolean(body.invalidated);
}

export interface GateDelegated {
  proposalId: string;
  mode: "immediate" | "held";
  released?: { status: string; message: string };
}

/**
 * Raise a proposal under a standing grant (EMAIL-AUTOPILOT.md). The platform
 * decides whether the grant covers it; a 409 is that refusal, returned as a
 * reason rather than thrown so the stager can leave the campaign for a person.
 */
export async function proposeDelegatedToGate(input: {
  kind: string;
  title: string;
  params: unknown;
  risk: ActionRisk;
  scopes: string[];
  preview: ActionPreview;
  delegation: { grantId: string; batchId: string; claims: unknown };
}): Promise<GateDelegated | { refused: string }> {
  const { apiUrl, secret } = gateConfig();
  const tenant = getTenant();
  const res = await fetch(`${apiUrl}/api/actions/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      shop: tenant.shop,
      kind: input.kind,
      title: input.title,
      params: input.params,
      risk: input.risk,
      scopes: input.scopes,
      executor: "agents",
      preview: input.preview,
      delegation: input.delegation,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GateDelegated> & { error?: string };
  if (res.status === 409) return { refused: body.error ?? "not covered by the grant" };
  if (!res.ok) throw new Error(`action gate propose failed (${res.status}): ${body.error ?? "unknown"}`);
  return { proposalId: body.proposalId ?? "", mode: body.mode ?? "held", ...(body.released ? { released: body.released } : {}) };
}

/** Propose a PLATFORM-executed action (the platform runs its own preview). */
export async function proposeAppActionToGate(input: { kind: string; params: unknown }): Promise<GateProposal & { error?: string }> {
  const { apiUrl, secret } = gateConfig();
  const tenant = getTenant();
  const res = await fetch(`${apiUrl}/api/actions/propose-app`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ shop: tenant.shop, kind: input.kind, params: input.params, proposedBy: "agent" }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GateProposal> & { error?: string };
  if (!res.ok) throw new Error(`action gate propose failed (${res.status}): ${body.error ?? "unknown"}`);
  return { proposalId: body.proposalId ?? "", posted: Boolean(body.posted), channel: body.channel ?? null };
}
