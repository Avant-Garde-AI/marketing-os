// Social planning read tools (spec 24 SM0 — "reads compose freely", spec 20
// §3). Wraps the canonical skill pack's runtime-agnostic tool definitions
// (packages/skills/social-media, vendored at lib/social) in Mastra createTool,
// bound to the tenant's SocialRepo.
//
// UNGATED reads: social_plan_propose returns a proposal (structure + the
// serialized calendar draft) without persisting anything; the calendar/post
// reads answer over what exists. Approve/schedule/publish are SM2 Actions on
// the spec 20 framework — nothing here writes.
//
// Unlike the design-surface tools these keep the canonical throw-on-missing
// behavior: the error text ("social/strategy.md not found — co-create the
// social strategy first") is the message the agent needs to relay.

import { createTool } from "@mastra/core/tools";
import type { z } from "zod";
import { createSocialTools } from "../../../lib/social/tools";
import { socialRepo } from "../../../lib/social/repo";
import type { SkillToolDefinition } from "../../../lib/social/types";

const defs = createSocialTools(socialRepo);

/** SkillToolDefinition → Mastra tool (the wrap the pack's types.ts describes). */
function toMastraTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: SkillToolDefinition<I, O>
) {
  return createTool({
    id: def.id,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    execute: (input: z.infer<I>) => def.execute(input),
  });
}

export const socialTools = {
  social_plan_propose: toMastraTool(defs.social_plan_propose),
  social_calendar_read: toMastraTool(defs.social_calendar_read),
  social_post_read: toMastraTool(defs.social_post_read),
};
