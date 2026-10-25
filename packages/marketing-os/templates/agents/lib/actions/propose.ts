/**
 * Propose a governed Action: registry lookup → params validation → read-only
 * preview() → the platform gate stores the proposal and posts the card.
 *
 * Shared by the agent's propose_action tool and the review sheet's "send
 * approvals" button. Neither can reach execute() — that only ever runs after a
 * verified human approves the card.
 */

import { getAction, knownActionKinds } from "./registry";
import { proposeDelegatedToGate, proposeToGate } from "./gate-client";

// The registry is populated by import side effects; the reader owns its data
// rather than relying on some tool module having been loaded first.
import "../email/register-actions";
import "../social/register-actions";
import "../social/schedule-batch";
import "../social/generation-publishing";
import "../social/source-camera";
import "../social/autopilot-production";
import "../offers/register-actions";
import "../storyboard/register-actions";
import "../storyboard/realization";

export interface ProposedAction {
  proposalId: string;
  posted: boolean;
  channel: string | null;
  summary: string;
  warnings?: string[];
}

export async function proposeAction(input: {
  kind: string;
  params: Record<string, unknown>;
  channel?: string;
}): Promise<ProposedAction> {
  const { kind, params, channel } = input;
  const action = getAction(kind);
  if (!action) {
    const known = knownActionKinds();
    throw new Error(
      `Unknown action kind "${kind}". Registered kinds for this store: ${known.length ? known.join(", ") : "(none — the relevant pack may not be enabled)"}`,
    );
  }
  const parsed = action.paramsSchema.safeParse(params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid params for ${kind} — ${issues}`);
  }
  const preview = await action.preview(parsed.data as never);
  const proposed = await proposeToGate({
    kind,
    title: action.title,
    params: parsed.data,
    risk: action.risk,
    scopes: action.scopes,
    preview,
    ...(channel ? { channel } : {}),
  });
  return {
    proposalId: proposed.proposalId,
    posted: proposed.posted,
    channel: proposed.channel,
    summary: preview.summary,
    ...(preview.warnings?.length ? { warnings: preview.warnings } : {}),
  };
}

export interface DelegatedOutcome {
  proposalId?: string;
  released?: { status: string; message: string };
  /** The gate's reason when the grant does not cover this proposal. */
  refused?: string;
}

/**
 * The autopilot stager's propose: identical validation and preview, but raised
 * under a standing grant. Callable only from the service-authenticated stage
 * route — no agent tool or MCP tool reaches this.
 */
export async function proposeDelegated(input: {
  kind: string;
  params: Record<string, unknown>;
  delegation: { grantId: string; batchId: string; claims: unknown };
}): Promise<DelegatedOutcome> {
  const action = getAction(input.kind);
  if (!action) throw new Error(`Unknown action kind "${input.kind}"`);
  const parsed = action.paramsSchema.safeParse(input.params);
  if (!parsed.success) throw new Error(`Invalid params for ${input.kind} — ${parsed.error.message}`);
  const preview = await action.preview(parsed.data as never);
  const raised = await proposeDelegatedToGate({
    kind: input.kind,
    title: action.title,
    params: parsed.data,
    risk: action.risk,
    scopes: action.scopes,
    preview,
    delegation: input.delegation,
  });
  if ("refused" in raised) return { refused: raised.refused };
  return { proposalId: raised.proposalId, ...(raised.released ? { released: raised.released } : {}) };
}
