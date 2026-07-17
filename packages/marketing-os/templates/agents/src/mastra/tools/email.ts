/**
 * Email pack tools in the pooled runtime (WS3-R4/R7 — the lib/social wrap
 * pattern). Wraps the vendored pack's read tools + adds the runtime-owned
 * email_render_preview (02 §1: assemble current state → guarded preview URL;
 * ungated — previews are reads).
 *
 * Enablement (05 H1): these tools are merged into the agent per request ONLY
 * when getEmailEnablement() passes (pack enabled AND Klaviyo connected) —
 * see marketing-agent.ts's dynamic tools function. Importing this module also
 * registers the pack's four Actions with the propose_action registry.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { z as zod } from "zod";
import { createEmailTools } from "../../../lib/email/tools";
import { emailRepo } from "../../../lib/email/repo";
import { createKlaviyoClient } from "../../../lib/email/klaviyo-client";
import { assembleCampaign } from "../../../lib/email/assemble";
import { campaignPath, parseCampaign } from "../../../lib/email/artifacts";
import type { SkillToolDefinition } from "../../../lib/skill-kit";
import { emailPreviewUrl } from "../../../lib/email/preview-url";
import { getTenant } from "../../../lib/tenant-context";
import "../../../lib/email/register-actions";

function toMastraTool<I extends zod.ZodTypeAny, O extends zod.ZodTypeAny>(
  def: SkillToolDefinition<I, O>,
) {
  return createTool({
    id: def.id,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    execute: (input: zod.infer<I>) => def.execute(input),
  });
}

const defs = createEmailTools(emailRepo, createKlaviyoClient());

const emailRenderPreview = createTool({
  id: "email_render_preview",
  description:
    "Assemble a campaign's CURRENT state (skeleton + boards + copy) into real email HTML and return a preview URL the human can open — plus the assembly report (invariant errors/warnings). Read-only; nothing touches Klaviyo. Use before proposing klaviyo.create_campaign_draft so problems surface early.",
  inputSchema: z.object({ campaignId: z.string().min(1) }),
  outputSchema: z.object({
    previewUrl: z.string(),
    ok: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    htmlBytes: z.number(),
  }),
  execute: async ({ campaignId }) => {
    const raw = await emailRepo.readFile(campaignPath(campaignId));
    if (raw === null) throw new Error(`campaign "${campaignId}" not found`);
    const campaign = parseCampaign(raw);
    const assembled = await assembleCampaign(campaign);
    return {
      previewUrl: emailPreviewUrl(getTenant().shop, campaignId),
      ok: assembled.report.ok,
      errors: assembled.report.errors,
      warnings: assembled.report.warnings,
      htmlBytes: Buffer.byteLength(assembled.html, "utf8"),
    };
  },
});

export const emailTools = {
  email_plan_propose: toMastraTool(defs.email_plan_propose),
  email_calendar_read: toMastraTool(defs.email_calendar_read),
  email_campaign_read: toMastraTool(defs.email_campaign_read),
  klaviyo_audiences_read: toMastraTool(defs.klaviyo_audiences_read),
  klaviyo_templates_read: toMastraTool(defs.klaviyo_templates_read),
  klaviyo_performance_read: toMastraTool(defs.klaviyo_performance_read),
  email_render_preview: emailRenderPreview,
};
