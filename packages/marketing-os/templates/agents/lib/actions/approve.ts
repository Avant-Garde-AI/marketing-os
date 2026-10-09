/**
 * Approve a stored proposal at the platform gate, in a signed-in operator's name.
 *
 * For console routes where the owner's click IS the decision — "schedule it",
 * "save this edit to a scheduled email". The proposal still exists, the gate
 * still claims its nonce and writes the audit row; this only removes the wait
 * between asking and answering. Never call it without a verified session.
 */
import { proposeAction } from "./propose";

export async function approveAtGate(proposalId: string, actor: string): Promise<{ status: string; message: string }> {
  const url = process.env.MARKETING_OS_API_URL?.replace(/\/$/, "");
  const secret = process.env.ACTIONS_GATE_SECRET;
  if (!url || !secret) throw new Error("approvals need MARKETING_OS_API_URL and ACTIONS_GATE_SECRET");
  const res = await fetch(`${url}/api/actions/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ proposalId, approve: true, actor }),
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; error?: string };
  if (!res.ok) throw new Error(`approval gate refused ${proposalId} (${res.status}): ${body.error ?? body.message ?? "unknown"}`);
  return { status: body.status ?? "unknown", message: body.message ?? "" };
}

/** Propose, then approve as the operator. Throws with the gate's own words when it does not execute. */
export async function proposeAndApprove(
  input: { kind: string; params: Record<string, unknown> },
  actor: string,
): Promise<{ summary: string }> {
  const proposed = await proposeAction(input);
  const decision = await approveAtGate(proposed.proposalId, actor);
  if (decision.status !== "executed") throw new Error(decision.message || `The step did not run (${decision.status}).`);
  return { summary: proposed.summary };
}
