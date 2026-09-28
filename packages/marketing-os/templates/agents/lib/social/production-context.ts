import { z } from "zod";
import { planProductionMonth, productionRecipeSchema } from "./production-recipes";
import type { ProductionSubject } from "./production-recipes";
import { collectGraphSubjects, parseGraphFacetAliases, type GraphSubjectPacket, type GraphSubjectDependencies, type SubjectReceipt } from "./graph-subjects";
import { storyboardContentHash } from "../storyboard/reviews";
import { bindConceptVoice } from "../storyboard/voice";
import { parseConcept, conceptPath } from "./concepts";
import { calendarPath, parseCalendar, postPath } from "./artifacts";

const CONFIG = "social/production/recipes.json";
const MASTERS = "social/production/artwork-sources.json";
const text = z.string().trim().min(1);
const facetSchema = z.object({
  palette: z.array(text.max(200)).max(20).optional(),
  subject: z.array(text.max(200)).max(20).optional(),
  movement: z.array(text.max(200)).max(20).optional(),
  mood: z.array(text.max(200)).max(20).optional(),
}).strict();
const FACETS = ["palette", "subject", "movement", "mood"] as const;
type Facet = typeof FACETS[number];
type FacetValues = Record<Facet, string[]>;
const emptyFacets = (): FacetValues => ({ palette: [], subject: [], movement: [], mood: [] });
const normalized = (values: string[]) => [...new Set(values.map(value => value.trim().toLowerCase()))].sort();
function publicHttps(value: string | undefined): boolean {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
const configSchema = z.object({
  version: z.literal(1),
  recipes: z.array(productionRecipeSchema).min(1).max(12),
  directions: z.record(text, z.array(text.max(4000)).min(1).max(31)),
}).strict();
// This inventory is an operator-reviewed source receipt, never a model input.
// A receipt is planning context, not permission to fetch, upload or generate.
const inventorySchema = z.object({
  version: z.literal(1), tenant: text,
  sources: z.array(z.object({
    handle: text, ref: text, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1024), height: z.number().int().min(1024),
    verificationRef: text, verifiedAt: z.string().datetime(),
    composition: z.literal("full-unframed-artwork"),
    artist: text.max(200).optional(),
    visualFacts: z.array(text.max(500)).max(30).optional(),
    facets: facetSchema.optional(),
  }).strict()).max(500),
}).strict();

export const productionPlanInputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  count: z.number().int().min(1).max(31).default(12),
  channel: z.string().regex(/^[a-z0-9-]{1,40}$/).default("instagram"),
  graphPrefix: z.string().regex(/^[a-z0-9_]{1,100}$/),
  graphQueries: z.array(text.max(200)).min(1).max(6),
});

export async function planStoreProductionMonth(input: z.input<typeof productionPlanInputSchema>, dependencies: {
  tenant: string; brand: string; repo: { readFile(path: string): Promise<string | null> };
  callGraph: GraphSubjectDependencies["callGraph"]; readCatalog: GraphSubjectDependencies["readCatalog"];
}) {
  const {month, count, channel, graphPrefix, graphQueries} = productionPlanInputSchema.parse(input);
  const {tenant, brand, repo, callGraph} = dependencies;
  if (!tenant.trim()) throw new Error("Production planning requires tenant context");
      const requestedCount = count ?? 12;
      const selectedChannel = channel ?? "instagram";
      const calendarFile = calendarPath(month);
      const calendarRaw = await repo.readFile(calendarFile);
      let existingSlots: Array<{ date: string }> | undefined;
      let calendarContext: {
        status: "existing" | "proposed-calendar";
        path: string;
        snapshotHash: string | null;
        selectedSlots: Array<{ slot: string; channel: string; pillar: string; intent: string; postId: string | null; status: string }>;
        preservedOccupiedSlots: Array<{ slot: string; channel: string; pillar: string; intent: string; postId: string | null; status: string }>;
        countMeaning: string;
      };
      if (calendarRaw !== null) {
        const calendar = parseCalendar(calendarRaw);
        if (calendar.month !== month) throw new Error(`Calendar at ${calendarFile} declares ${calendar.month}, expected ${month}`);
        const available = calendar.slots.filter(slot => slot.channel === selectedChannel && slot.status === "planned" && !slot.postId && slot.slot.startsWith(`${month}-`));
        const uniqueByDate = [...new Map(available.map(slot => [slot.slot, slot])).values()].sort((a, b) => a.slot.localeCompare(b.slot));
        if (uniqueByDate.length < requestedCount)
          throw new Error(`Only ${uniqueByDate.length} unoccupied planned ${selectedChannel} dates remain in ${calendarFile}; requested ${requestedCount} new production slots. Revise the calendar before planning.`);
        const selectedSlots = Array.from({ length: requestedCount }, (_, i) => uniqueByDate[Math.floor(((i + 0.5) * uniqueByDate.length) / requestedCount)]!);
        existingSlots = selectedSlots.map(slot => ({ date: slot.slot }));
        calendarContext = {
          status: "existing", path: calendarFile, snapshotHash: storyboardContentHash(calendarRaw),
          selectedSlots: selectedSlots.map(slot => ({ ...slot })),
          preservedOccupiedSlots: calendar.slots.filter(slot => Boolean(slot.postId)).map(slot => ({ ...slot })),
          countMeaning: "Number of new production slots selected from unoccupied planned dates on this channel; occupied calendar rows and post IDs are preserved.",
        };
      } else {
        calendarContext = {
          status: "proposed-calendar", path: calendarFile, snapshotHash: null,
          selectedSlots: [], preservedOccupiedSlots: [],
          countMeaning: "Number of new editorial slots in a proposed calendar; review and create calendar rows before writing posts.",
        };
      }
      const raw = await repo.readFile(CONFIG);
      if (!raw) throw new Error(`Missing ${CONFIG}; review the store's temporary production recipes first`);
      const config = configSchema.parse(JSON.parse(raw));
      for (const recipe of config.recipes) if (!config.directions[recipe.id]?.length) throw new Error(`No creative directions for ${recipe.id}`);
      const inventoryRaw = await repo.readFile(MASTERS);
      const inventory = inventoryRaw ? inventorySchema.parse(JSON.parse(inventoryRaw)) : { version: 1, tenant, sources: [] };
      if (inventory.tenant !== tenant) throw new Error("Artwork source inventory belongs to another tenant");
      if (new Set(inventory.sources.map(s => s.handle)).size !== inventory.sources.length) throw new Error("Duplicate artwork source handles");
      const inventoryHash = inventoryRaw ? storyboardContentHash(inventoryRaw) : null;
      const curatedSources = inventory.sources.slice(0, 24);
      const sourceWarnings: Array<{handle?: string; reason: string}> = [];
      const sourceFailures: Array<{handle: string; reason: string}> = [];
      if (inventory.sources.length > curatedSources.length)
        sourceWarnings.push({ reason: `Source inventory has ${inventory.sources.length} entries; only the first 24 operator-curated handles were checked. Review or reorder the source pool.` });
      const inventoryRef = (handle: string, sha256: string) => `inventory:${inventoryHash}:${handle}:${sha256}`;
      if (!brand.trim()) throw new Error("Production planning needs current brand instructions");
      const voices = [];
      for (const recipe of config.recipes) {
        const path = conceptPath(recipe.conceptId);
        const conceptRaw = await repo.readFile(path);
        if (!conceptRaw) throw new Error(`Missing production concept ${recipe.conceptId}`);
        const concept = parseConcept(conceptRaw, path);
        if (concept.id !== recipe.conceptId || concept.status === "retired") throw new Error(`Ineligible production concept ${recipe.conceptId}`);
        const bound = await bindConceptVoice({ brand: { source: "brand.md", content: brand }, facts: [], patterns: [], priorPosts: [], assets: [] }, concept, repo);
        voices.push({ recipeId: recipe.id, concept, conceptHash: storyboardContentHash(conceptRaw), copyFormulas: bound.context.copyFormulas ?? [], sources: bound.sources });
      }
      const aliasesRaw = await repo.readFile("social/reference/art-graph.json");
      const packets: GraphSubjectPacket[] = [];
      const subjects = new Map<string, ProductionSubject>();
      const facetEvidence = new Map<string, Record<Facet, {values: string[]; sourceRefs: string[]}>>();
      const graphSubjects = new Map<string, GraphSubjectPacket["subjects"][number]>();
      const curatedCatalogReceipts: SubjectReceipt[] = [];
      const acquisitionFailures: Array<{query: string; reason: string}> = [];
      for (const query of [...new Set(graphQueries)]) {
        let packet: GraphSubjectPacket;
        try {
        packet = await collectGraphSubjects({ concept: query, limit: 6 }, {
          tenant, callGraph, readCatalog: dependencies.readCatalog,
          facetHandleAliases: parseGraphFacetAliases(aliasesRaw, graphPrefix),
        });
        } catch (error) {
          acquisitionFailures.push({ query, reason: error instanceof Error ? error.message : "Graph/catalog acquisition failed" });
          continue;
        }
        packets.push(packet);
        for (const s of packet.subjects) {
          if (subjects.has(s.handle)) continue;
          graphSubjects.set(s.handle, s);
          facetEvidence.set(s.handle, Object.fromEntries(FACETS.map(facet => [facet, { values: s.facets[facet], sourceRefs: s.sourceRefs }])) as Record<Facet, {values: string[]; sourceRefs: string[]}>);
          const master = inventory.sources.find(m => m.handle === s.handle);
          subjects.set(s.handle, {
            handle: s.handle, artist: s.artist || "Unattributed in acquired graph; do not invent a credit",
            sourceRefs: s.sourceRefs,
            ...(master ? { asset: { kind: "full-master" as const, ref: master.ref, verificationRef: `${master.verificationRef}#sha256=${master.sha256}` } } : {}),
            facts: [
              { text: `Catalog title: ${s.title}. Public product page: ${s.productUrl}. Stock availability is unknown.`, sourceRefs: s.sourceRefs },
              ...Object.entries(s.facets).filter(([, values]) => values.length).map(([key, values]) => ({ text: `Graph ${key}: ${values.join(", ")}`, sourceRefs: s.sourceRefs })),
            ],
          });
        }
      }
      for (let offset = 0; offset < curatedSources.length; offset += 6) {
        const batch = curatedSources.slice(offset, offset + 6);
        const handles = batch.map(source => source.handle);
        let catalog: Awaited<ReturnType<GraphSubjectDependencies["readCatalog"]>>;
        try {
          catalog = await dependencies.readCatalog(handles);
          if (new Set(catalog.map(item => item.handle)).size !== catalog.length || catalog.some(item => !handles.includes(item.handle)))
            throw new Error("Catalog returned duplicate or unexpected handles");
        } catch (error) {
          for (const handle of handles) sourceFailures.push({ handle, reason: error instanceof Error ? error.message : "Catalog lookup failed" });
          continue;
        }
        const digest = storyboardContentHash(JSON.stringify({ tenant, handles, catalog }));
        const catalogReceipt: SubjectReceipt = { ref: `catalog:${digest}`, kind: "catalog", operation: "products-by-handle", capturedAt: new Date().toISOString(), digest, data: catalog };
        curatedCatalogReceipts.push(catalogReceipt);
        for (const source of batch) {
          const item = catalog.find(product => product.handle === source.handle);
          const reason = !item ? "Current catalog product is missing" :
            item.status.toUpperCase() !== "ACTIVE" ? "Current catalog product is inactive" :
            !item.title.trim() ? "Current catalog title is missing" :
            !publicHttps(item.onlineStoreUrl) ? "Current public HTTPS product URL is missing" : null;
          if (reason) {
            sourceFailures.push({ handle: source.handle, reason });
            subjects.delete(source.handle);
            facetEvidence.delete(source.handle);
            continue;
          }
          const verifiedItem = item!;
          const sourceRef = inventoryRef(source.handle, source.sha256);
          const current = subjects.get(source.handle);
          const graph = graphSubjects.get(source.handle);
          const observedFacets = facetEvidence.get(source.handle) ?? Object.fromEntries(FACETS.map(facet => [facet, { values: [], sourceRefs: [] }])) as Record<Facet, {values: string[]; sourceRefs: string[]}>;
          for (const facet of FACETS) {
            const observed = source.facets?.[facet] ?? [];
            const graphValues = graph?.facets[facet] ?? [];
            if (observed.length && graphValues.length && JSON.stringify(normalized(observed)) !== JSON.stringify(normalized(graphValues)))
              sourceWarnings.push({ handle: source.handle, reason: `Operator-reviewed ${facet} differs from acquired graph ${facet}; retain both sources for review.` });
            if (observed.length) observedFacets[facet] = { values: observed, sourceRefs: [sourceRef, catalogReceipt.ref] };
          }
          facetEvidence.set(source.handle, observedFacets);
          if (source.artist && graph?.artist && source.artist.trim().toLowerCase() !== graph.artist.trim().toLowerCase())
            sourceWarnings.push({ handle: source.handle, reason: "Operator-reviewed artist differs from acquired graph artist; review credit before copy." });
          const visualFacts = [
            ...(source.artist ? [{ text: `Operator-reviewed artist: ${source.artist}`, sourceRefs: [sourceRef] }] : []),
            ...(source.visualFacts ?? []).map(text => ({ text: `Operator-reviewed visual observation: ${text}`, sourceRefs: [sourceRef] })),
            ...FACETS.flatMap(facet => (source.facets?.[facet]?.length ?? 0) ? [{ text: `Operator-reviewed ${facet}: ${source.facets![facet]!.join(", ")}`, sourceRefs: [sourceRef] }] : []),
          ];
          subjects.set(source.handle, current ? {
            ...current, sourceRefs: [...new Set([...current.sourceRefs, catalogReceipt.ref, sourceRef])],
            facts: [...(current.facts ?? []), ...visualFacts],
          } : {
            handle: source.handle, artist: source.artist ?? "Unattributed in reviewed inventory; do not invent a credit",
            sourceRefs: [catalogReceipt.ref, sourceRef],
            asset: { kind: "full-master", ref: source.ref, verificationRef: `${source.verificationRef}#sha256=${source.sha256}` },
            facts: [
              { text: `Catalog title: ${verifiedItem.title}. Public product page: ${verifiedItem.onlineStoreUrl}. Stock availability is unknown.`, sourceRefs: [catalogReceipt.ref] },
              ...visualFacts,
            ],
          });
        }
      }
      const plan = planProductionMonth({ month, count: requestedCount, channel: selectedChannel, recipes: config.recipes, subjects: [...subjects.values()], ...(existingSlots ? { existingSlots } : {}) });
      const uses = new Map<string, number>();
      const slots = await Promise.all(plan.slots.map(async slot => {
        const ordinal = uses.get(slot.recipeId) ?? 0;
        uses.set(slot.recipeId, ordinal + 1);
        const directions = config.directions[slot.recipeId]!;
        const selected = slot.subjectHandles.map(handle => ({ handle, facets: facetEvidence.get(handle) })).filter((item): item is {handle: string; facets: Record<Facet, {values: string[]; sourceRefs: string[]}>} => Boolean(item.facets));
        const recipe = config.recipes.find(r => r.id === slot.recipeId)!;
        const relationships = FACETS.flatMap(facet => {
          if (selected.length !== recipe.requiredDistinctSubjects) return [];
          const values = selected[0]?.facets[facet].values ?? [];
          return values.filter(value => selected.every(s => s.facets[facet].values.some(v => v.toLowerCase() === value.toLowerCase())))
            .map(value => ({ facet, value, sourceRefs: [...new Set(selected.flatMap(s => s.facets[facet].sourceRefs))] }));
        });
        const blockedReasons = [...slot.blockedReasons];
        if (recipe.mechanic === "collection-scene" && !relationships.length) blockedReasons.push("No shared acquired facet connects all selected artworks; curate a different set before realization.");
        if (await repo.readFile(postPath(slot.id)) !== null)
          blockedReasons.push(`Post artifact ${postPath(slot.id)} already exists; inspect or reuse it instead of overwriting.`);
        return { ...slot, status: blockedReasons.length ? "blocked" as const : "planned" as const, blockedReasons, relationships, creativeDirection: directions[ordinal % directions.length], directionRepeated: ordinal >= directions.length };
      }));
      return {
        ...plan, slots, calendarContext, summary: { ...plan.summary, planned: slots.filter(s => s.status === "planned").length, blocked: slots.filter(s => s.status === "blocked").length }, sourcePackets: packets, curatedCatalogReceipts, acquisitionFailures, sourceFailures, sourceWarnings, voices, brand,
        sources: [{ path: CONFIG, hash: storyboardContentHash(raw) }, { path: MASTERS, hash: inventoryRaw ? storyboardContentHash(inventoryRaw) : null }, { path: "social/reference/art-graph.json", hash: aliasesRaw ? storyboardContentHash(aliasesRaw) : null }],
        generation: { available: false, reason: "This tool prepares editorial/source context only. A verified provider connection, quoted execution adapter and approved creative are required for imagery." },
        next: "Use each slot's facts, creative direction and acquired voice to draft distinct caption alternatives. Never describe a planned animation or fictional home as observed footage. Review the recipe/storyboard before provider spend; preserve existing post IDs on retries and inspect existing artifacts before any upsert. Finish with the existing monthly social review sheet after real assets are bound.",
      };
}
