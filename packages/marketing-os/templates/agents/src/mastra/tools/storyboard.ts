import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { planStoryboards } from "../../../lib/storyboard/plan";
import { planningContextSchema } from "../../../lib/storyboard/schemas";
import { socialRepo } from "../../../lib/social/repo";
import { getTenant } from "../../../lib/tenant-context";
import { createMastraStoryModel } from "../storyboard-model";
import { getBrandInstructions } from "../brand/store";

const CONTEXT_PATH = "social/reference/storyboard-context.json";

export const storyboardTools = {
  social_storyboard_plan: createTool({
    id: "social_storyboard_plan",
    description: "Plan and independently critique three narrative arcs before imagery spend. Returns a review shortlist, eliminated alternatives and evidence gaps. Reads the tenant's reviewed storyboard context and current brand rules. Does not generate imagery, persist artifacts or authorize publishing. Present the shortlist to the human before requesting imagery.",
    inputSchema: z.object({ brief: z.string().trim().min(1).max(12000) }),
    execute: async ({ brief }) => {
      const tenant = getTenant();
      if (!tenant.shop) throw new Error("Storyboard planning requires tenant context");
      // Deliberate operator configuration: no silent downgrade of a visual/taste task.
      const model = process.env.STORYBOARD_MODEL;
      if (!model || !model.includes("/")) throw new Error("Configure STORYBOARD_MODEL as provider/model with structured-output and vision support");
      const raw = await socialRepo.readFile(CONTEXT_PATH);
      if (!raw) throw new Error(`Missing ${CONTEXT_PATH}: prepare reviewed fact sources, asset inventory and pattern references first. Research may remain explicitly uncounted.`);
      const context = planningContextSchema.parse(JSON.parse(raw));
      const brand = await getBrandInstructions(tenant.shop);
      if (!brand.trim()) throw new Error("No current brand instructions; storyboard planning requires brand grounding");
      // Refresh brand per request rather than trusting a stale copy in the corpus manifest.
      context.brand = { source: "brand.md", content: brand };
      return planStoryboards(brief, context, createMastraStoryModel(model));
    },
  }),
};
