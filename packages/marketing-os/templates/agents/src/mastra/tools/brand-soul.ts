// Brand Soul pipeline tools (spec 22 BS2) — the definition pipeline surfaced
// as agent tools: manifest document store (get/save, versioned), Gemini Deep
// Research dispatch/check (stage 2), and the playbook that carries the
// compose-stage methodology (stages 1 & 4) so it costs no per-turn tokens.

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTenant } from "../../../lib/tenant-context";
import {
  getBrandDoc,
  saveBrandDoc,
  listBrandDocVersions,
  saveResearchJob,
  latestResearchJob,
  markResearchJob,
  type BrandDocKind,
} from "../brand/store";
import { startDeepResearch, getDeepResearch } from "../brand/deep-research";
import { generateCandidates, listCandidates } from "../brand/candidates";

const PUBLIC_URL = (
  process.env.MOS_AGENTS_PUBLIC_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

const KINDS = ["brand.md", "DESIGN.md", "research-brief.md", "research-output.md", "exploration-prompts.md"] as const;

export const getBrandDocument = createTool({
  id: "get_brand_document",
  description:
    "Read the store's Brand Soul manifest documents: brand.md (the versioned, provenance-tagged brand strategy), DESIGN.md (the visual system), research-brief.md, research-output.md (deep research results), or exploration-prompts.md. " +
    "Returns the latest version's full content plus the version history. Use this whenever you need brand depth beyond the distilled context in your instructions — positioning, messaging frameworks, experience architecture, copy examples.",
  inputSchema: z.object({
    kind: z.enum(KINDS).optional().describe("Which manifest document (default brand.md)"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    kind: z.string(),
    version: z.number().optional(),
    content: z.string().optional(),
    history: z.array(z.object({ version: z.number(), changeNote: z.string().nullable(), createdAt: z.string() })).optional(),
  }),
  execute: async (inputData: { kind?: BrandDocKind }) => {
    const { shop } = getTenant();
    const kind = inputData.kind ?? "brand.md";
    const doc = await getBrandDoc(shop, kind);
    if (!doc) return { found: false, kind };
    const history = await listBrandDocVersions(shop, kind);
    // Cap content so a huge research report can't blow the context.
    return { found: true, kind, version: doc.version, content: doc.content.slice(0, 24000), history };
  },
});

export const saveBrandDocument = createTool({
  id: "save_brand_document",
  description:
    "Save a new version of a Brand Soul manifest document (brand.md, DESIGN.md, research-brief.md, or exploration-prompts.md). Versions are monotonic and never overwrite — this is the version-bump write. " +
    "RULES: brand.md/DESIGN.md changes must be walked through with the owner and approved BEFORE saving (never save silently); always pass a changeNote saying what changed and why; brand.md must keep its YAML front matter + provenance tags (@owner/@agent/@data/@research) and append a row to its Provenance & Change Log section.",
  inputSchema: z.object({
    kind: z.enum(KINDS),
    content: z.string().describe("The complete document content (markdown, with YAML front matter for brand.md)"),
    changeNote: z.string().describe("One line: what changed and why"),
  }),
  outputSchema: z.object({ version: z.number(), kind: z.string() }),
  execute: async (inputData: { kind: BrandDocKind; content: string; changeNote: string }) => {
    const { shop } = getTenant();
    const { version } = await saveBrandDoc(shop, inputData.kind, inputData.content, {
      changeNote: inputData.changeNote,
      updatedBy: "agent",
    });
    return { version, kind: inputData.kind };
  },
});

export const dispatchDeepResearch = createTool({
  id: "dispatch_deep_research",
  description:
    "Dispatch a competitive/market deep-research run (Gemini Deep Research). Pass the full research brief text, or omit it to use the store's latest saved research-brief.md. Runs asynchronously — takes several minutes to complete. " +
    "After dispatching, tell the user research is running and they can ask 'is the research done?' later (which triggers check_deep_research). Use depth 'max' for an initial brand-definition run; 'standard' for refreshes.",
  inputSchema: z.object({
    brief: z.string().optional().describe("The research brief text (omit to use the saved research-brief.md)"),
    depth: z.enum(["standard", "max"]).optional(),
  }),
  outputSchema: z.object({ started: z.boolean(), interactionId: z.string().optional(), note: z.string() }),
  execute: async (inputData: { brief?: string; depth?: "standard" | "max" }) => {
    const { shop } = getTenant();
    let brief = inputData.brief;
    if (!brief) {
      const doc = await getBrandDoc(shop, "research-brief.md");
      if (!doc) return { started: false, note: "No brief provided and no saved research-brief.md — compose the brief first (see get_brand_soul_playbook)." };
      brief = doc.content;
    }
    const { id } = await startDeepResearch(brief, inputData.depth ?? "standard");
    await saveResearchJob(shop, id);
    return { started: true, interactionId: id, note: "Deep research dispatched; it runs in the background for several minutes. Check later with check_deep_research." };
  },
});

export const checkDeepResearch = createTool({
  id: "check_deep_research",
  description:
    "Check the store's latest deep-research run. If complete, the full report is saved as the research-output.md manifest document and a summary excerpt is returned — then read the full report via get_brand_document(kind='research-output.md') and distill it into @research-tagged evidence with the owner.",
  inputSchema: z.object({}),
  outputSchema: z.object({ status: z.string(), excerpt: z.string().optional(), savedVersion: z.number().optional(), note: z.string().optional() }),
  execute: async () => {
    const { shop } = getTenant();
    const job = await latestResearchJob(shop);
    if (!job) return { status: "none", note: "No research has been dispatched for this store." };
    if (job.status === "completed") return { status: "completed", note: "Already saved — read it via get_brand_document(kind='research-output.md')." };
    const res = await getDeepResearch(job.interactionId);
    if (res.status === "completed" && res.report) {
      const { version } = await saveBrandDoc(shop, "research-output.md", res.report, {
        changeNote: "Deep research report (Gemini Deep Research)",
        updatedBy: "deep-research",
      });
      await markResearchJob(shop, job.interactionId, "completed");
      return { status: "completed", savedVersion: version, excerpt: res.report.slice(0, 4000) };
    }
    if (res.status === "failed") {
      await markResearchJob(shop, job.interactionId, "failed");
      return { status: "failed", note: res.error };
    }
    return { status: res.status, note: "Still running — deep research takes several minutes." };
  },
});

export const getBrandSoulPlaybook = createTool({
  id: "get_brand_soul_playbook",
  description:
    "Get the Brand Soul definition-pipeline playbook: how to run the compose → research → iterate → explore process that produces a store's brand.md + DESIGN.md, including the research-brief template and the design-exploration prompt-pack template. " +
    "Call this FIRST whenever the user wants to define, refine, or explore their brand strategy or visual identity.",
  inputSchema: z.object({}),
  outputSchema: z.object({ playbook: z.string() }),
  execute: async () => ({
    playbook: `# Brand Soul Pipeline (spec 22)
The manifest you are producing (4 versioned documents, saved via save_brand_document):
research-brief.md → research-output.md → brand.md → exploration-prompts.md → DESIGN.md

## Stage 1 — COMPOSE the research brief (co-creative; never a blank form)
Interview the owner briefly (category, position hypothesis, primary persona sketch, goals), then DRAFT the brief yourself and walk them through it. Structure:
1. Context & Objective — brand, position hypothesis, persona sketch, why now.
2. Research scope: (a) tiered competitive set (direct / adjacent / intent-adjacent) with 5 dimensions per competitor: positioning & voice, target customer, product & merchandising, technology & discovery, acquisition & growth; (b) aesthetic-adjacent brand benchmarking (the brands shaping the persona's taste baseline); (c) ONE category-specific strategic deep-dive; (d) AI/discovery tech landscape; (e) content-commerce models; (f) paid acquisition landscape; (g) supply-side dynamics.
3. Demanded output format: landscape summary, competitor profiles, positioning map, whitespace analysis, risk assessment, tactical recommendations.
Owner approves the brief → save_brand_document(kind='research-brief.md') → dispatch_deep_research (depth 'max' for a first definition).

## Stage 2 — RESEARCH: runs async; check_deep_research when asked. Distill findings into @research-tagged claims (citation + date).

## Stage 3 — ITERATE to brand.md (owner has final say, section by section)
brand.md/v0 = YAML front matter (machine core) + prose sections. Front matter: essence, north_star, positioning (FOR/IS/THAT/UNLIKE/BECAUSE), promise, personas (with WEIGHTED 0-100 decision hierarchies), experience, voice (pillars + never + tone_by_context), copy formula templates (steps + banned_words + ai_prompt_template), ai_voice_rules, conversion, guardrails, health_metrics, design_ref. Every claim carries a provenance comment: # @owner / @agent / @data / @research. Voice pillars are specified via ✔/✘ example PAIRS — the examples ARE the spec. Where research contradicts the owner's hypothesis, SURFACE the tension; never silently rewrite. Version bumps append to the Provenance & Change Log section.

## Stage 4 — EXPLORE to DESIGN.md (discovered, not typed)
1. Compose a design-exploration prompt pack from the converged brand.md: a Context Brief (brand north star, aesthetic north star, aesthetic references from research, the two registers — editorial vs interactive density, implementation constraints) + per-surface prompts (PDP, collection, concierge, configurator, homepage, profile, article, email, component library, ad templates), each = PROMPT + EXPLORATION NOTES listing the diversity axes to vary. Save as exploration-prompts.md.
2. Per surface: generate_design_candidates with 2-4 variation prompts (one per diversity axis). The candidates post to Slack as cards; the owner clicks "Select this direction".
3. SYNTHESIZE when the owner has selected across surfaces (or asks to): call list_design_candidates(selectedOnly=true), study the selected directions (surface + axis tell you WHAT was chosen; describe each back to the owner), and draft DESIGN.md (Google DESIGN.md spec: YAML tokens — colors/typography/rounded/spacing/components — + prose sections in canonical order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts). Every claim must trace to an owner selection or the brand.md front matter. Walk the owner through it; on approval save_brand_document(kind='DESIGN.md') with a changeNote naming the selections it synthesizes.

## Stage 5 — PUBLISH: storefront agent discovery (default onboarding step)
Once brand.md + DESIGN.md exist, close the discovery chain on the store's OWN domain:
1. The platform App Proxy already serves the brand at /apps/mcp/brand/llms.txt, /apps/mcp/brand/brand.md, /apps/mcp/brand/DESIGN.md (and /apps/mcp/brand as the reading view).
2. Shopify auto-generates /agents.md + /llms.txt on every storefront (customizable via theme templates since May 2026, and llms.txt mirrors agents.md by default). Fetch the storefront's CURRENT /agents.md, preserve its commerce/UCP content verbatim, and add a "Brand Identity" section linking the three /apps/mcp/brand URLs with guidance ("consult before writing copy about, recommending, or visually representing this brand").
3. Save the result as theme file templates/agents.md.liquid and dispatch it as a THEME PR (dispatch-to-github) for owner approval — never edit the live theme directly.
Result: robots.txt → agents.md/llms.txt → brand index → brand.md + DESIGN.md, all on the store's domain. This is a standard part of Brand Soul onboarding for every store.

Reference worked examples (Arthaus): the four documents in this store's manifest if seeded, else packages/brand-md/examples/arthaus/ in the marketing-os repo.`,
  }),
});

export const generateDesignCandidates = createTool({
  id: "generate_design_candidates",
  description:
    "Generate diverse visual identity candidates for one brand surface (spec 22 stage 4 — DESIGN.md is discovered, not typed). YOU compose the 2–4 variation prompts before calling: start from the surface's PROMPT in the store's exploration-prompts.md (or the playbook template), then vary each candidate along a DIFFERENT exploration-notes diversity axis; every prompt must carry the brand's aesthetic north star (palette hexes, typography direction, materials, mood) and describe a single full-frame UI/design mockup image. " +
    "Generation takes ~30-60s. After it returns, present the candidates by emitting a fenced ```mos-gallery``` block: {\"title\":\"<surface> explorations\",\"images\":[{\"id\":\"...\",\"url\":\"...\",\"label\":\"<axis>\"}]} using the returned candidates VERBATIM, then 1 sentence per candidate on what it explores. The owner selects via the card buttons.",
  inputSchema: z.object({
    surface: z.string().describe("The brand surface, e.g. 'PDP hero', 'collection page', 'homepage'"),
    variations: z
      .array(z.object({ axis: z.string().describe("The diversity axis this candidate explores"), prompt: z.string().describe("Full image-generation prompt") }))
      .min(1)
      .max(4),
  }),
  outputSchema: z.object({
    candidates: z.array(z.object({ id: z.string(), url: z.string(), label: z.string() })),
    note: z.string().optional(),
  }),
  execute: async (inputData: { surface: string; variations: Array<{ axis: string; prompt: string }> }) => {
    const { shop } = getTenant();
    const saved = await generateCandidates(shop, inputData.surface, inputData.variations);
    const candidates = saved.map((c) => ({ id: c.id, url: `${PUBLIC_URL}/api/brand-image/${c.id}`, label: c.axis }));
    return {
      candidates,
      note: candidates.length < inputData.variations.length ? `${inputData.variations.length - candidates.length} generation(s) failed and were skipped.` : undefined,
    };
  },
});

export const listDesignCandidates = createTool({
  id: "list_design_candidates",
  description:
    "List the store's visual-exploration candidates (spec 22 stage 4), newest first — id, surface, diversity axis, and whether the owner SELECTED it via the gallery card. " +
    "Use with selectedOnly=true when synthesizing DESIGN.md: the selected candidates across surfaces are the owner's chosen directions, and every DESIGN.md claim must trace to one. Candidate images are viewable at /api/brand-image/{id}.",
  inputSchema: z.object({
    selectedOnly: z.boolean().optional().describe("Only candidates the owner selected (default false)"),
  }),
  outputSchema: z.object({
    candidates: z.array(
      z.object({ id: z.string(), surface: z.string(), axis: z.string().nullable(), selected: z.boolean(), url: z.string(), createdAt: z.string() })
    ),
  }),
  execute: async (inputData: { selectedOnly?: boolean }) => {
    const { shop } = getTenant();
    const rows = await listCandidates(shop, inputData.selectedOnly ?? false);
    return {
      candidates: rows.map((c) => ({ ...c, url: `${PUBLIC_URL}/api/brand-image/${c.id}` })),
    };
  },
});

export const brandSoulTools = {
  get_brand_document: getBrandDocument,
  save_brand_document: saveBrandDocument,
  dispatch_deep_research: dispatchDeepResearch,
  check_deep_research: checkDeepResearch,
  get_brand_soul_playbook: getBrandSoulPlaybook,
  generate_design_candidates: generateDesignCandidates,
  list_design_candidates: listDesignCandidates,
};
