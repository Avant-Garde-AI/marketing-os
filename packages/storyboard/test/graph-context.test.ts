import { describe, expect, it } from "vitest";
import { compileGraphPlanningContext, type PlanningConcept, type SubjectPlanningPacket } from "../src/graph-context";
import { checkGrounding, planStoryboards } from "../src/plan";
import type { PlanningContext } from "../src/schemas";
import type { Storyboard } from "../src/types";

const base: PlanningContext = { brand: { source: "brand.md", content: "Real art, no invented process." }, facts: [], patterns: [], priorPosts: [], assets: [] };
const concept: PlanningConcept = { id: "detail-reveal", status: "draft", premise: "Detail to full work", payoff: "See the hidden relationship", needs: [{ id: "clear-detail", description: "A legible detail in the real artwork" }], expressions: { carousel: {}, video: { availability: "blocked" } } };
const packet: SubjectPlanningPacket = {
  tenant: "store-a", receipts: [{ ref: "graph:1", kind: "graph", data: { handle: "one", palette: ["blue"] } }, { ref: "catalog:1", kind: "catalog", data: { handle: "one", imageUrl: "https://cdn.example/one.jpg" } }],
  subjects: [{ handle: "one", title: "One", imageUrl: "https://cdn.example/one.jpg", sourceRefs: ["graph:1", "catalog:1"] }],
};
function story(): Storyboard {
  return { id: "board", conceptId: concept.id, subjectHandles: ["one"], needAssessments: [{ needId: "clear-detail", met: true, sourceRefs: ["catalog:1"], reason: "Fixture provides a catalog image; visual support still needs critique" }], format: "carousel", premise: "Detail reveals full work", payoff: "See the relationship", continuity: [{ what: "same work", binding: "fixed-asset", ref: packet.subjects[0]!.imageUrl }], beats: [0, 1].map((i) => ({
    id: `beat-${i}`, role: i ? "turn" : "setup", assertion: "The artwork uses blue", evidence: [{ claim: "blue", source: "graph:1", origin: "data" }],
    ...(i ? { transition: { change: "detail to full work", why: "reveal context", patternRefs: [] } } : {}),
    brief: { shows: "the catalog artwork", feels: "editorial", avoid: ["invented art"], sourcing: "store-asset", asset: { ref: packet.subjects[0]!.imageUrl, use: i ? "as-is" : "detail-crop" } },
  })) };
}

describe("acquired graph context compilation", () => {
  it("pins the concept and acquired receipts without claiming a bare master or counted pattern", () => {
    const context = compileGraphPlanningContext(base, concept, packet, "store-a");
    expect(context.concept?.id).toBe(concept.id);
    expect(context.concept?.formats).toEqual(["carousel"]);
    expect(context.concept?.needs[0]?.required).toBe(true);
    expect(context.assets).toEqual([{ ref: packet.subjects[0]!.imageUrl, kind: "unknown" }]);
    expect(context.patterns).toEqual([]);
    expect(checkGrounding(story(), context)).toEqual([]);
  });

  it("fails before planning for foreign tenants, unbound receipts, no usable subjects or retired concepts", () => {
    expect(() => compileGraphPlanningContext(base, concept, packet, "store-b")).toThrow("tenant");
    expect(() => compileGraphPlanningContext(base, concept, { ...packet, receipts: packet.receipts.slice(0, 1) }, "store-a")).toThrow("receipts");
    expect(() => compileGraphPlanningContext(base, concept, { ...packet, subjects: [] }, "store-a")).toThrow("usable");
    expect(() => compileGraphPlanningContext(base, { ...concept, status: "retired" }, packet, "store-a")).toThrow("Retired");
  });

  it("rejects changed concept IDs, blocked formats and invented catalog subjects", () => {
    const context = compileGraphPlanningContext(base, concept, packet, "store-a");
    expect(checkGrounding({ ...story(), conceptId: "other" }, context).some((v) => v.kill && v.reason.includes("concept"))).toBe(true);
    expect(checkGrounding({ ...story(), format: "video" }, context).some((v) => v.kill && v.reason.includes("format"))).toBe(true);
    expect(checkGrounding({ ...story(), subjectHandles: ["invented"] }, context).some((v) => v.kill && v.reason.includes("unavailable catalog"))).toBe(true);
    expect(checkGrounding({ ...story(), needAssessments: [] }, context).some((v) => v.kill && v.reason.includes("Required content need"))).toBe(true);
    expect(checkGrounding({ ...story(), needAssessments: [{ needId: "clear-detail", met: true, sourceRefs: ["invented"], reason: "assumed" }] }, context).some((v) => v.kill && v.reason.includes("Required content need"))).toBe(true);
  });

  it("passes acquired catalog pixels to planning and independent critique, without generation", async () => {
    const context = compileGraphPlanningContext(base, concept, packet, "store-a");
    const images: unknown[] = [];
    const review = await planStoryboards("Explain a real detail", context, {
      generate: async (request) => {
        images.push(request.images);
        return request.schema.parse(request.task === "plan-storyboards"
          ? { storyboards: [story(), { ...story(), id: "two" }, { ...story(), id: "three" }] }
          : { verdicts: [{ kill: false, score: 0.6, reason: "Fixture only; human visual support review remains open" }] });
      },
    });
    expect(images).toHaveLength(4);
    expect(images.every((value) => JSON.stringify(value) === JSON.stringify([{ label: "catalog:one", url: packet.subjects[0]!.imageUrl }]))).toBe(true);
    expect(review.imageryCalls).toBe(0);
    expect(review.options.every((option) => option.evidenceStatus === "hypothesis")).toBe(true);
  });
});
