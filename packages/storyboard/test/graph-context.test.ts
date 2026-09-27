import { planningTransportFixtureV1 } from "./planning-transport-fixture";
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
        if (request.task === "narrative-critique") {
          const data = request.data as { storyboard: Storyboard; alternatives: Storyboard[] };
          expect(data.alternatives).toHaveLength(2);
          expect(data.alternatives.every((other) => other.id !== data.storyboard.id)).toBe(true);
        }
        return request.schema.parse(request.task === "plan-storyboards"
          ? planningTransportFixtureV1({ storyboards: [story(), { ...story(), id: "two" }, { ...story(), id: "three" }] })
          : { wholeStory: { kill: false, score: 0.6, reason: "Fixture only; human visual support review remains open" } });
      },
    });
    expect(images).toHaveLength(4);
    expect(images.every((value) => JSON.stringify(value) === JSON.stringify([{ label: "catalog:one", url: packet.subjects[0]!.imageUrl }]))).toBe(true);
    expect(review.imageryCalls).toBe(0);
    expect(review.options.every((option) => option.evidenceStatus === "hypothesis")).toBe(true);
  });
});


const voicedConcept: PlanningConcept = { ...concept, voice: { copyFormulaRefs: ["curatorial-question"], hook: "Ask what changes when the detail is seen in context" } };
const voicedBase: PlanningContext = { ...base,
  facts: [{ source: "voice:acquired-receipt", content: "Acquired creative structure; no performance claim" }],
  copyFormulas: [{ id: "curatorial-question", source: "voice:acquired-receipt", definition: "One viewing question, then one concrete contextual observation" }],
};

describe("acquired concept voice", () => {
  it("preserves voice and acquired formula definitions in structured planning context", () => {
    const context = compileGraphPlanningContext(voicedBase, voicedConcept, packet, "store-a");
    expect(context.concept?.voice).toEqual(voicedConcept.voice);
    expect(context.copyFormulas).toEqual(voicedBase.copyFormulas);
    expect(context.facts.some((fact) => fact.source === context.copyFormulas![0]!.source)).toBe(true);
    expect(context.patterns).toEqual([]);
  });
  it("requires acquired definitions instead of treating a configured ID as enough", () => {
    expect(() => compileGraphPlanningContext(base, voicedConcept, packet, "store-a")).toThrow("unavailable copy formula definition");
    expect(() => compileGraphPlanningContext({ ...voicedBase, copyFormulas: [{ ...voicedBase.copyFormulas![0]!, definition: " " }] }, voicedConcept, packet, "store-a")).toThrow();
    expect(() => compileGraphPlanningContext({ ...voicedBase, copyFormulas: [{ ...voicedBase.copyFormulas![0]!, source: "voice:unacquired" }] }, voicedConcept, packet, "store-a")).toThrow("unavailable definition source");
  });
  it("refuses duplicate definitions and configured references", () => {
    expect(() => compileGraphPlanningContext({ ...voicedBase, copyFormulas: [...voicedBase.copyFormulas!, ...voicedBase.copyFormulas!] }, voicedConcept, packet, "store-a")).toThrow("duplicate IDs");
    expect(() => compileGraphPlanningContext(voicedBase, { ...voicedConcept, voice: { copyFormulaRefs: ["curatorial-question", "curatorial-question"] } }, packet, "store-a")).toThrow("duplicate copy formula references");
  });
  it("does not borrow a formula's provenance from new catalog receipts", () => {
    const unacquired = { ...base, copyFormulas: [{ ...voicedBase.copyFormulas![0]!, source: "catalog:1" }] };
    expect(() => compileGraphPlanningContext(unacquired, voicedConcept, packet, "store-a")).toThrow("unavailable definition source");
  });
  it("independently rejects missing or foreign formula refs in saved-review grounding", () => {
    const context = compileGraphPlanningContext(voicedBase, voicedConcept, packet, "store-a");
    expect(checkGrounding(story(), context).some((verdict) => verdict.kill && verdict.reason.includes("copy formula"))).toBe(true);
    expect(checkGrounding({ ...story(), copyFormulaRef: "generic-description" }, context).some((verdict) => verdict.kill && verdict.reason.includes("copy formula"))).toBe(true);
    expect(checkGrounding({ ...story(), copyFormulaRef: "curatorial-question" }, context)).toEqual([]);
    expect(checkGrounding({ ...story(), copyFormulaRef: "curatorial-question" }, { ...context, copyFormulas: [] }).some((verdict) => verdict.kill && verdict.reason.includes("unavailable"))).toBe(true);
  });
});


it("refuses old compact contexts that dropped configured voice from the acquired concept fact", () => {
  const compiled = compileGraphPlanningContext(voicedBase, voicedConcept, packet, "store-a");
  const { voice: _voice, ...legacyConcept } = compiled.concept!;
  const legacy = { ...compiled, concept: legacyConcept };
  const wrong = { ...compiled, concept: { ...compiled.concept!, voice: { copyFormulaRefs: ["generic-description"] } } };
  for (const saved of [legacy, wrong]) {
    expect(checkGrounding({ ...story(), copyFormulaRef: "curatorial-question" }, saved).some((verdict) => verdict.kill && verdict.reason.includes("Concept voice was not compiled"))).toBe(true);
  }
  expect(checkGrounding({ ...story(), copyFormulaRef: "curatorial-question" }, compiled)).toEqual([]);
});

it("does not infer voice from generic prose facts or concepts without a configured formula", () => {
  const compiled = compileGraphPlanningContext(base, concept, packet, "store-a");
  const generic = { ...compiled, facts: compiled.facts.map((fact) => fact.source === compiled.concept!.source
    ? { ...fact, content: "A curatorial question might be interesting" } : fact) };
  expect(checkGrounding(story(), compiled)).toEqual([]);
  expect(checkGrounding(story(), generic)).toEqual([]);
});
