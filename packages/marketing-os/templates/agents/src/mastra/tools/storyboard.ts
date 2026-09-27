import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { planStoryboards } from "../../../lib/storyboard/plan";
import { planningContextSchema } from "../../../lib/storyboard/schemas";
import { compileGraphPlanningContext } from "../../../lib/storyboard/graph-context";
import { collectGraphSubjects, bindGraphSubjectReads } from "../../../lib/social/graph-subjects";
import { readCatalogSubjects } from "../../../lib/social/catalog-subjects";
import { conceptPath, parseConcept } from "../../../lib/social/concepts";
import { getExternalMcpTools } from "./external-mcp";
import { socialRepo } from "../../../lib/social/repo";
import { getTenant } from "../../../lib/tenant-context";
import { createMastraStoryModel } from "../storyboard-model";
import { getBrandInstructions } from "../brand/store";

const CONTEXT_PATH = "social/reference/storyboard-context.json";

export const storyboardTools = {
  social_graph_storyboard_plan: createTool({
    id: "social_graph_storyboard_plan",
    description: "Acquire current graph/catalog subjects and plan three alternatives for one store-owned content concept in the same read-only call. Select the exact enabled art-graph prefix, graph concept query, and social concept ID. Returns the acquired source packet and a critique shortlist for human review before imagery spend. Hard concept needs remain subject to evidence review; no graph match is a pass by itself. No imagery, artifact write, scheduling or publishing. Missing reviewed pattern context remains explicit hypothesis status.",
    inputSchema: z.object({
      brief: z.string().trim().min(1).max(12000),
      conceptId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
      graphPrefix: z.string().regex(/^[a-z0-9_]{1,100}$/),
      graphQuery: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(6).default(4),
    }),
    execute: async ({ brief, conceptId, graphPrefix, graphQuery, limit }) => {
      const tenant = getTenant();
      if (!tenant.shop) throw new Error("Graph storyboard planning requires tenant context");
      const model = process.env.STORYBOARD_MODEL;
      if (!model || !model.includes("/")) throw new Error("Configure STORYBOARD_MODEL as provider/model with structured-output and vision support");
      const conceptRaw = await socialRepo.readFile(conceptPath(conceptId));
      if (!conceptRaw) throw new Error(`Missing content concept ${conceptId}; review a concept before instantiating it`);
      const concept = parseConcept(conceptRaw, conceptPath(conceptId));
      if (concept.id !== conceptId || concept.status === "retired") throw new Error("Content concept identity or lifecycle is not eligible");
      const brand = await getBrandInstructions(tenant.shop);
      if (!brand.trim()) throw new Error("Graph storyboard planning requires current brand instructions");
      const baseRaw = await socialRepo.readFile(CONTEXT_PATH);
      const base = baseRaw ? planningContextSchema.parse(JSON.parse(baseRaw)) : {
        brand: { source: "brand.md", content: brand }, facts: [], patterns: [], priorPosts: [], assets: [],
      };
      base.brand = { source: "brand.md", content: brand };
      const packet = await collectGraphSubjects({ concept: graphQuery, limit: limit ?? 4 }, {
        tenant: tenant.shop,
        callGraph: bindGraphSubjectReads(graphPrefix, await getExternalMcpTools()),
        readCatalog: readCatalogSubjects,
      });
      const context = compileGraphPlanningContext(base, concept, packet, tenant.shop);
      const review = await planStoryboards(brief, context, createMastraStoryModel(model));
      return { conceptId, conceptStatus: concept.status, subjectPacket: packet, review };
    },
  }),
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
