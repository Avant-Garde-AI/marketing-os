/**
 * propose_action (spec 20 A1) — the agent's ONLY interface to writes.
 *
 * The agent proposes; the platform performs, after a human clicks (spec 20
 * §2). This tool: registry lookup → params validation (the action's own
 * zod schema) → preview() [read-only, with the tenant's bindings] → the
 * platform gate stores the proposal + posts the branded approval card.
 *
 * Structural invariant 2: NOTHING here (or anywhere in the Mastra toolset)
 * can reach an action's execute(). Execution happens in marketing-os-app's
 * decideAction() after the approval click, dispatched back to
 * /api/actions/execute behind the gate secret the agent never sees.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAction, knownActionKinds } from "../../../lib/actions/registry";
import { proposeToGate } from "../../../lib/actions/gate-client";

export const proposeActionTool = createTool({
  id: "propose_action",
  description:
    "Propose a governed write Action for human approval (spec 20). The action's preview() runs read-only and its real output renders on the approval card in Slack; nothing executes until an approver clicks Approve. Use for any operation that mutates external state (Klaviyo drafts/sends, publishing, activations). Returns the proposal id and where the card was posted.",
  inputSchema: z.object({
    kind: z.string().describe("Registered action kind, e.g. klaviyo.create_campaign_draft"),
    params: z.record(z.string(), z.unknown()).describe("The action's parameters (validated against its schema)"),
    channel: z.string().optional().describe("Slack channel id to post the card into (defaults to the store's digest channel)"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    posted: z.boolean(),
    channel: z.string().nullable(),
    summary: z.string().describe("What the approver will see — relay this to the user"),
    warnings: z.array(z.string()).optional(),
  }),
  execute: async (input) => {
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
  },
});

export const actionTools = { propose_action: proposeActionTool };
