import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { bindGraphSubjectReads, collectGraphSubjects } from "../../../lib/social/graph-subjects";
import { readCatalogSubjects } from "../../../lib/social/catalog-subjects";
import { getTenant } from "../../../lib/tenant-context";
import { getExternalMcpTools } from "./external-mcp";

export const socialGraphSubjects = createTool({
  id: "social_graph_subjects",
  description: "Read a bounded art-graph concept and verify up to six candidate handles against the current Shopify catalog. Use the exact graph connection prefix from the enabled external tools (for example picasso_concierge). Returns per-work facets, current title/page/image and source receipts, plus explicit rejected handles. Does not assess semantic concept needs, assert stock availability, plan creative, save artifacts, generate images or publish. Use the returned facts and receipt refs to assess the needs of a social content concept before instantiation.",
  inputSchema: z.object({
    graphPrefix: z.string().regex(/^[a-z0-9_]{1,100}$/),
    concept: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(6).default(4),
  }),
  execute: async ({ graphPrefix, concept, limit }) => {
    const tenant = getTenant();
    if (!tenant.shop) throw new Error("Graph subject discovery requires tenant context");
    const callGraph = bindGraphSubjectReads(graphPrefix, await getExternalMcpTools());
    return collectGraphSubjects({ concept, limit: limit ?? 4 }, {
      tenant: tenant.shop,
      callGraph,
      readCatalog: readCatalogSubjects,
    });
  },
});
