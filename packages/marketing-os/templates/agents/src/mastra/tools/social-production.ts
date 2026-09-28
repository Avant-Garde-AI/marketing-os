import { createTool } from "@mastra/core/tools";
import { planStoreProductionMonth, productionPlanInputSchema } from "../../../lib/social/production-context";
import { bindGraphSubjectReads } from "../../../lib/social/graph-subjects";
import { readCatalogSubjects } from "../../../lib/social/catalog-subjects";
import { socialRepo } from "../../../lib/social/repo";
import { getTenant } from "../../../lib/tenant-context";
import { getExternalMcpTools } from "./external-mcp";
import { getBrandInstructions } from "../brand/store";

export const socialProductionTools = {
  social_production_month_plan: createTool({
    id: "social_production_month_plan",
    description: "Plan a repeatable month from tenant-owned recipes, fresh graph/catalog facts, and verified full-artwork source receipts. Returns stable editorial slots, exact subject/copy packets, creative directions, source gaps, and current brand/formula definitions. No saved posts, media generation, scheduling or publishing. Planned means source context is present, not creative approval or provider readiness. Draft copy through social_post_upsert; review the storyboard and quoted generation before provider spend. Do not bypass the Action gate with generic external generation tools.",
    inputSchema: productionPlanInputSchema,
    execute: async (input) => {
      const tenant = getTenant().shop;
      if (!tenant) throw new Error("Production planning requires tenant context");
      return planStoreProductionMonth(input, {
        tenant, repo: socialRepo, brand: await getBrandInstructions(tenant),
        callGraph: bindGraphSubjectReads(input.graphPrefix, await getExternalMcpTools()),
        readCatalog: readCatalogSubjects,
      });
    },
  }),
};
