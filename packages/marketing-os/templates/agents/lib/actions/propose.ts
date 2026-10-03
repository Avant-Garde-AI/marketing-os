/**
 * Propose a governed Action: registry lookup → params validation → read-only
 * preview() → the platform gate stores the proposal and posts the card.
 *
 * Shared by the agent's propose_action tool and the review sheet's "send
 * approvals" button. Neither can reach execute() — that only ever runs after a
 * verified human approves the card.
 */

import { getAction, knownActionKinds } from "./registry";
import { proposeToGate } from "./gate-client";

// The registry is populated by import side effects; the reader owns its data
// rather than relying on some tool module having been loaded first.
import "../email/register-actions";
import "../social/register-actions";
import "../social/schedule-batch";
import "../social/generation-publishing";
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
