import { describe, expect, it } from "vitest";
import { planStoreProductionMonth } from "../templates/agents/lib/social/production-context";
import { serializeCalendar } from "../templates/agents/lib/social/artifacts";
import { storyboardContentHash } from "../templates/agents/lib/storyboard/reviews";

const tenant = "test.myshopify.com";
const recipe = { id: "home", mechanic: "collection-scene", scene: "real-home", weight: 1, conceptId: "three-works", requiredDistinctSubjects: 3, outputKind: "carousel" };
const concept = `---
id: three-works
name: Three works
premise: A shared palette connects three works.
payoff: See the connection.
needs: [{id: source, description: Three actual works.}]
expressions:
  carousel:
    availability: blocked
    beats: [{role: setup, direction: Establish the group.}, {role: payoff, direction: Explain the relationship.}]
voice: {hook: Observe a concrete detail.}
evidence: {kind: brand-derived, n: 0}
status: draft
---
Synthetic fixture.
`;
const reviewedSource = (handle: string) => ({ handle, ref: `asset:${handle}`, sha256: "a".repeat(64), width: 2048, height: 2048, verificationRef: `inspection:${handle}`, verifiedAt: "2026-09-28T00:00:00Z", composition: "full-unframed-artwork" });
function deps(options: {
  otherTenant?: boolean; sources?: boolean; unrelated?: boolean; calendar?: string; existingPostIds?: string[];
  inventorySources?: unknown[]; graphHandles?: string[]; graphFailure?: boolean;
  graphFacetOverrides?: Record<string, string[]>; catalogStatuses?: Record<string, string>;
} = {}) {
  const files: Record<string, string> = {
    "social/production/recipes.json": JSON.stringify({ version: 1, recipes: [recipe], directions: { home: ["Reading room", "Dining room"] } }),
    "social/concepts/three-works.md": concept,
    "social/production/artwork-sources.json": JSON.stringify({ version: 1, tenant: options.otherTenant ? "another.myshopify.com" : tenant, sources: options.inventorySources ?? (options.sources ? ["a", "b", "c"].map(reviewedSource) : []) }),
  };
  if (options.calendar) files["social/calendar/2026-10.md"] = options.calendar;
  for (const id of options.existingPostIds ?? []) files[`social/posts/${id}/post.md`] = "existing post";
  return {
    tenant, brand: "Concrete observations; no invented artist facts.",
    repo: { readFile: async (path: string) => files[path] ?? null },
    callGraph: async (op: "explore_concept" | "get_artwork_facets") => {
      if (options.graphFailure) throw new Error("Graph returned duplicate invalid rows");
      const handles = options.graphHandles ?? ["a", "b", "c"];
      return op === "explore_concept" ? {
        results: handles.map(handle => ({ handle, title: handle, artist: "Synthetic artist" })),
      } : { artworks: handles.map(handle => ({ handle, palette: options.graphFacetOverrides?.[handle] ?? [options.unrelated ? handle : "blue"], subject: [], mood: [], movement: [] })) };
    },
    readCatalog: async (handles: string[]) => handles.map(handle => ({ handle, title: `Work ${handle}`, status: options.catalogStatuses?.[handle] ?? "ACTIVE", onlineStoreUrl: `https://example.com/products/${handle}`, imageUrl: `https://example.com/${handle}.jpg` })),
  };
}
const input = { month: "2026-10", count: 2, channel: "instagram", graphPrefix: "graph", graphQueries: ["blue"] };
const calendar = serializeCalendar({ month: "2026-10", status: "proposed", slots: [
  { slot: "2026-10-01", channel: "instagram", pillar: "one", intent: "one", postId: null, status: "planned" },
  { slot: "2026-10-03", channel: "instagram", pillar: "two", intent: "two", postId: null, status: "planned" },
  { slot: "2026-10-05", channel: "instagram", pillar: "three", intent: "three", postId: null, status: "planned" },
  { slot: "2026-10-07", channel: "instagram", pillar: "occupied", intent: "occupied", postId: "2026-10-07-existing", status: "proposed" },
  { slot: "2026-10-09", channel: "threads", pillar: "other", intent: "other", postId: null, status: "planned" },
] });

describe("tenant production context", () => {
  it("keeps source gaps and usable copy packets, without trusting a product image as a master", async () => {
    const plan = await planStoreProductionMonth(input, deps());
    expect(plan.summary).toMatchObject({ planned: 0, blocked: 2 });
    expect(plan.slots[0]?.brief?.copyFacts.length).toBeGreaterThan(0);
    expect(plan.slots[0]?.relationships[0]).toMatchObject({ facet: "palette", value: "blue" });
    expect(plan.slots.map(s => s.creativeDirection)).toEqual(["Reading room", "Dining room"]);
    expect(plan.generation.available).toBe(false);
    expect(plan.sources.every(s => s.hash === null || /^[a-f0-9]{64}$/.test(s.hash))).toBe(true);
    expect(plan.slots[0]?.brief?.subjects[0]?.masterRef).toBeUndefined();
  });
  it("reports failed acquisition instead of discarding other usable query results", async () => {
    const dependency = deps();
    let calls = 0;
    const call = dependency.callGraph;
    dependency.callGraph = async op => { if (calls++ === 0) throw new Error("Duplicate upstream rows"); return call(op); };
    const plan = await planStoreProductionMonth({ ...input, graphQueries: ["broken", "blue"] }, dependency);
    expect(plan.acquisitionFailures).toEqual([{query: "broken", reason: "Duplicate upstream rows"}]);
    expect(plan.sourcePackets).toHaveLength(1);
    expect(plan.slots[0]?.subjectHandles).toHaveLength(3);
  });
  it("rejects another tenant's source inventory before graph acquisition", async () => {
    const dependency = deps({ otherTenant: true });
    dependency.callGraph = async () => { throw new Error("Must not query graph"); };
    await expect(planStoreProductionMonth(input, dependency)).rejects.toThrow("another tenant");
  });
  it("distinguishes source-ready planning from permission or provider readiness", async () => {
    const plan = await planStoreProductionMonth(input, deps({ sources: true }));
    expect(plan.summary.planned).toBe(2);
    expect(plan.generation.available).toBe(false);
    expect(plan.slots.every(s => !Object.hasOwn(s, "scheduledAt"))).toBe(true);
  });
  it("blocks a grouping with no shared acquired facet even when all masters exist", async () => {
    const plan = await planStoreProductionMonth(input, deps({ sources: true, unrelated: true }));
    expect(plan.summary).toMatchObject({ planned: 0, blocked: 2 });
    expect(plan.slots[0]?.blockedReasons.join(" ")).toContain("No shared acquired facet");
  });
  it("selects new slots only from free channel dates and preserves occupied post IDs", async () => {
    const plan = await planStoreProductionMonth(input, deps({ calendar, sources: true }));
    expect(plan.slots.map(slot => slot.date)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(plan.calendarContext).toMatchObject({ status: "existing", path: "social/calendar/2026-10.md", snapshotHash: storyboardContentHash(calendar) });
    expect(plan.calendarContext.preservedOccupiedSlots).toMatchObject([{ slot: "2026-10-07", postId: "2026-10-07-existing" }]);
    expect(plan.calendarContext.selectedSlots.map(slot => slot.slot)).toEqual(["2026-10-01", "2026-10-05"]);
  });
  it("asks for calendar revision when there are too few free channel dates", async () => {
    await expect(planStoreProductionMonth({ ...input, count: 4 }, deps({ calendar }))).rejects.toThrow(/Revise the calendar/);
  });
  it("blocks a generated post ID that already has an artifact", async () => {
    const plan = await planStoreProductionMonth(input, deps({ calendar, sources: true, existingPostIds: ["2026-10-instagram-01"] }));
    expect(plan.slots[0]).toMatchObject({ id: "2026-10-instagram-01", status: "blocked" });
    expect(plan.slots[0]?.blockedReasons.join(" ")).toMatch(/already exists/);
  });
  it("labels dates as a calendar proposal when no month calendar exists", async () => {
    const plan = await planStoreProductionMonth(input, deps());
    expect(plan.calendarContext).toMatchObject({ status: "proposed-calendar", snapshotHash: null, selectedSlots: [] });
  });
  it("uses three reviewed sources when graph discovery fails, with catalog and inventory lineage", async () => {
    const inventorySources = ["a", "b", "c"].map(handle => ({ ...reviewedSource(handle), artist: `Reviewed artist ${handle}`, visualFacts: ["A visible blue form"], facets: { palette: ["blue"] } }));
    const plan = await planStoreProductionMonth(input, deps({ graphFailure: true, inventorySources }));
    expect(plan.acquisitionFailures).toHaveLength(1);
    expect(plan.summary.planned).toBe(2);
    expect(plan.slots[0]?.subjectHandles).toEqual(["a", "b", "c"]);
    expect(plan.slots[0]?.relationships[0]).toMatchObject({ facet: "palette", value: "blue", sourceRefs: expect.arrayContaining([expect.stringMatching(/^inventory:/), expect.stringMatching(/^catalog:/)]) });
    expect(plan.curatedCatalogReceipts).toHaveLength(1);
    expect(plan.curatedCatalogReceipts[0]?.kind).toBe("catalog");
    expect(plan.slots[0]?.brief?.copyFacts.some(fact => fact.text.includes("visible blue form") && fact.sourceRefs[0]?.startsWith("inventory:"))).toBe(true);
  });
  it("fills the third work from reviewed inventory when graph yields only two", async () => {
    const inventorySources = ["a", "b", "c"].map(handle => ({ ...reviewedSource(handle), facets: { palette: ["blue"] } }));
    const plan = await planStoreProductionMonth(input, deps({ graphHandles: ["a", "b"], inventorySources }));
    expect(plan.summary.planned).toBe(2);
    expect(plan.slots[0]?.subjectHandles).toEqual(["a", "b", "c"]);
    expect(plan.slots[0]?.brief?.subjects.find(subject => subject.handle === "c")?.sourceRefs).toEqual(expect.arrayContaining([expect.stringMatching(/^catalog:/), expect.stringMatching(/^inventory:/)]));
  });
  it("excludes an inactive reviewed product from the curated fallback", async () => {
    const inventorySources = ["a", "b", "c"].map(handle => ({ ...reviewedSource(handle), facets: { palette: ["blue"] } }));
    const plan = await planStoreProductionMonth(input, deps({ graphHandles: ["a", "b"], inventorySources, catalogStatuses: { c: "DRAFT" } }));
    expect(plan.sourceFailures).toContainEqual({ handle: "c", reason: "Current catalog product is inactive" });
    expect(plan.slots[0]?.subjectHandles).toEqual(["a", "b"]);
    expect(plan.slots[0]?.status).toBe("blocked");
  });
  it("reports graph and reviewed visual conflicts without erasing either source", async () => {
    const inventorySources = ["a", "b", "c"].map(handle => ({ ...reviewedSource(handle), facets: { palette: ["blue"] } }));
    const plan = await planStoreProductionMonth(input, deps({ inventorySources, graphFacetOverrides: { a: ["red"] } }));
    expect(plan.sourceWarnings).toContainEqual({ handle: "a", reason: expect.stringContaining("differs from acquired graph") });
    expect(plan.slots[0]?.brief?.copyFacts.some(fact => fact.handle === "a" && fact.text.includes("Graph palette: red") && fact.sourceRefs.some(ref => ref.startsWith("graph:")))).toBe(true);
    expect(plan.slots[0]?.brief?.copyFacts.some(fact => fact.handle === "a" && fact.text.includes("Operator-reviewed palette: blue") && fact.sourceRefs.some(ref => ref.startsWith("inventory:")))).toBe(true);
    expect(plan.slots[0]?.relationships[0]).toMatchObject({ facet: "palette", value: "blue" });
  });
});
