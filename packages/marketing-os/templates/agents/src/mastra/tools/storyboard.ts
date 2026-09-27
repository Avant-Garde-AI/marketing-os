import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { persistStoryboardReview, storyboardContentHash, readSelectedStoryboard, readStoryboardReview } from "../../../lib/storyboard/reviews";
import { socialStoryboardReviewLink } from "../../../lib/social/review-links";
import { slideLayoutSchema, fetchReviewedSource } from "../../../lib/storyboard/realization";
import { imageDigest } from "../../../lib/storyboard/assets";
import { planStoryboards } from "../../../lib/storyboard/plan";
import { planningContextSchema } from "../../../lib/storyboard/schemas";
import { compileGraphPlanningContext } from "../../../lib/storyboard/graph-context";
import { bindConceptVoice } from "../../../lib/storyboard/voice";
import { collectGraphSubjects, bindGraphSubjectReads, parseGraphFacetAliases } from "../../../lib/social/graph-subjects";
import { readCatalogSubjects } from "../../../lib/social/catalog-subjects";
import { conceptPath, parseConcept } from "../../../lib/social/concepts";
import { getExternalMcpTools } from "./external-mcp";
import { socialRepo } from "../../../lib/social/repo";
import { getTenant } from "../../../lib/tenant-context";
import { createMastraStoryModel } from "../storyboard-model";
import { getBrandInstructions } from "../brand/store";

const CONTEXT_PATH = "social/reference/storyboard-context.json";

export const storyboardTools = {
  social_storyboard_review_read: createTool({
    id: "social_storyboard_review_read",
    description: "Read a durable narrative shortlist and its critique. Returns the signed read-only human review URL. Hashes do not authorize selection; use storyboard.select through propose_action.",
    inputSchema: z.object({ reviewId: z.string().regex(/^[a-zA-Z0-9_-]{1,101}$/), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    execute: async ({reviewId, reviewHash}) => {
      const tenant = getTenant();
      const review = await readStoryboardReview(socialRepo, reviewId, reviewHash, {tenant: tenant.shop, brand: await getBrandInstructions(tenant.shop)});
      return {review, reviewUrl: socialStoryboardReviewLink(tenant.shop, reviewId, reviewHash).url};
    },
  }),
  social_storyboard_realization_prepare: createTool({
    id: "social_storyboard_realization_prepare",
    description: "Prepare explicit per-beat still layouts for an approved storyboard. Reads and hashes reviewed source pixels, preserving exact beat order. Supply coordinates/crops derived from actual source inspection and copy positions; no automatic centered-stack template. Returns social.storyboard_realize proposal params; creates no images, files or authority. Generation/motion/mockups require future quoted adapters.",
    inputSchema: z.object({ reviewId: z.string().regex(/^[a-z0-9-]{1,100}$/), reviewHash: z.string().regex(/^[a-f0-9]{64}$/), postId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), layouts: z.array(slideLayoutSchema.omit({image:true}).extend({image: slideLayoutSchema.shape.image.omit({sourceSha256:true})})).min(1).max(10) }),
    execute: async (input) => {
      const tenant = getTenant();
      const selected = await readSelectedStoryboard(socialRepo, input.reviewId, input.reviewHash, {tenant:tenant.shop, brand:await getBrandInstructions(tenant.shop)});
      if (input.layouts.length !== selected.storyboard.beats.length) throw new Error("Supply one layout per selected beat");
      const layouts = [];
      const cache = new Map<string,string>();
      for (const [i,l] of input.layouts.entries()) {
        const beat = selected.storyboard.beats[i]!;
        if (beat.id !== l.beatId || !beat.brief.asset) throw new Error("Exact reviewed beat and source asset required");
        const ref = beat.brief.asset.ref;
        if (!cache.has(ref)) cache.set(ref,imageDigest(await fetchReviewedSource(ref)));
        layouts.push({...l,image:{...l.image,sourceSha256:cache.get(ref)!}});
      }
      return {kind:"social.storyboard_realize", params:{...input,layouts}, storyboardHash:selected.storyboardHash, imageryCalls:0};
    },
  }),
  social_graph_storyboard_plan: createTool({
    id: "social_graph_storyboard_plan",
    description: "Acquire current graph/catalog subjects and plan three alternatives for one store-owned content concept in the same read-only call. Select the exact enabled art-graph prefix, graph concept query, and social concept ID. Returns the acquired source packet and a critique shortlist for human review before imagery spend. Hard concept needs remain subject to evidence review; no graph match is a pass by itself. Persists a tenant-scoped planning review with its context and hash. No imagery, scheduling or publishing. Selection requires a storyboard.select proposal and human gate approval. Missing reviewed pattern context remains explicit hypothesis status.",
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
      const voice = await bindConceptVoice(base, concept, socialRepo);
      const graphConfigRaw = await socialRepo.readFile("social/reference/art-graph.json");
      const packet = await collectGraphSubjects({ concept: graphQuery, limit: limit ?? 4 }, {
        tenant: tenant.shop,
        callGraph: bindGraphSubjectReads(graphPrefix, await getExternalMcpTools()),
        readCatalog: readCatalogSubjects,
        facetHandleAliases: parseGraphFacetAliases(graphConfigRaw, graphPrefix),
      });
      const context = compileGraphPlanningContext(voice.context, concept, packet, tenant.shop);
      const review = await planStoryboards(brief, context, createMastraStoryModel(model));
      const artifact = await persistStoryboardReview({ repo: socialRepo, tenant: tenant.shop, brief, context, review, sources: [
        ...voice.sources,
        { path: CONTEXT_PATH, hash: baseRaw === null ? null : storyboardContentHash(baseRaw) },
        { path: conceptPath(conceptId), hash: storyboardContentHash(conceptRaw) },
        { path: "social/reference/art-graph.json", hash: graphConfigRaw === null ? null : storyboardContentHash(graphConfigRaw) },
      ] });
      return { conceptId, conceptStatus: concept.status, subjectPacket: packet, review: { ...review, reviewHash: artifact.reviewHash }, reviewId: artifact.reviewId, reviewHash: artifact.reviewHash, reviewUrl: socialStoryboardReviewLink(tenant.shop, artifact.reviewId, artifact.reviewHash).url };
    },
  }),
  social_storyboard_plan: createTool({
    id: "social_storyboard_plan",
    description: "Plan and independently critique three narrative arcs before imagery spend. Returns a review shortlist, eliminated alternatives and evidence gaps. Reads the tenant's reviewed storyboard context and current brand rules. Persists a tenant-scoped review and hash; does not generate imagery or authorize publishing. Propose storyboard.select with its reviewId and reviewHash for human approval before realization. Present the shortlist to the human before requesting imagery.",
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
      const review = await planStoryboards(brief, context, createMastraStoryModel(model));
      const artifact = await persistStoryboardReview({ repo: socialRepo, tenant: tenant.shop, brief, context, review, sources: [{ path: CONTEXT_PATH, hash: storyboardContentHash(raw) }] });
      return { ...review, reviewId: artifact.reviewId, reviewHash: artifact.reviewHash, reviewUrl: socialStoryboardReviewLink(tenant.shop, artifact.reviewId, artifact.reviewHash).url };
    },
  }),
};
