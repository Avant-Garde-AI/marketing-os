import { describe, expect, it } from "vitest";
import {
  assessFit,
  beatInstruction,
  conceptPath,
  parseConcept,
  selectSubjects,
  serializeConcept,
  validateConcept,
  type PostConcept,
} from "../src/concepts";

const concept: PostConcept = {
  id: "imagined-brushwork",
  name: "How it was made",
  premise: "Reconstruct the making of a piece — the marks, in the order they were laid down.",
  payoff: "You see the hand behind a piece you were only ever going to see finished.",
  needs: [
    { id: "visible-technique", description: "The work shows inferable technique — brush, pen or pencil marks" },
    { id: "medium-known", description: "The medium is recorded on the product", required: false },
  ],
  expressions: {
    carousel: {
      beats: [
        { role: "setup", direction: "Faint construction lines only", archetypeId: "work-detail" },
        { role: "turn", direction: "Linework half laid in", archetypeId: "work-detail" },
        { role: "payoff", direction: "The finished work", archetypeId: "work-detail" },
      ],
      continuity: ["the same drawing board", "one fixed overhead camera", "unchanged daylight"],
    },
    video: {
      beats: [
        { role: "setup", direction: "A hand begins the first marks", seconds: 3 },
        { role: "payoff", direction: "The marks resolve into the finished work", seconds: 5 },
      ],
      continuity: ["one fixed overhead camera"],
      availability: "blocked",
      availabilityNote: "no Veo access on this project yet",
    },
  },
  evidence: { kind: "brand-derived", n: 0 },
  status: "draft",
  body: "Tested 2026-09-10 as a four-stage still sequence.",
};

describe("concept artifacts", () => {
  it("round-trips through the store repo format", () => {
    expect(parseConcept(serializeConcept(concept))).toEqual(concept);
  });

  it("puts concepts where the other social artifacts live", () => {
    expect(conceptPath("imagined-brushwork")).toBe("social/concepts/imagined-brushwork.md");
  });
});

describe("validateConcept", () => {
  it("accepts a well-formed concept", () => {
    expect(validateConcept(concept).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("rejects a concept with no needs — it could never be refused", () => {
    const problems = validateConcept({ ...concept, needs: [] });
    expect(problems.some((p) => p.field === "needs" && p.severity === "error")).toBe(true);
  });

  it("warns when the payoff is written from the brand's chair", () => {
    const problems = validateConcept({
      ...concept,
      payoff: "Showcases our collection and drives traffic to the shop.",
    });
    const payoff = problems.find((p) => p.field === "payoff");
    expect(payoff?.severity).toBe("warning");
    expect(payoff?.detail).toMatch(/reader's chair/);
  });

  it("refuses to let a non-counted concept claim exemplars", () => {
    const problems = validateConcept({ ...concept, evidence: { kind: "brand-derived", n: 32 } });
    expect(problems.some((p) => p.field === "evidence" && p.severity === "error")).toBe(true);
  });

  it("warns when a sequence declares no continuity constants", () => {
    const problems = validateConcept({
      ...concept,
      expressions: { carousel: { beats: concept.expressions.carousel!.beats } },
    });
    expect(problems.some((p) => p.detail.includes("drift"))).toBe(true);
  });

  it("rejects a one-beat sequence", () => {
    const problems = validateConcept({
      ...concept,
      expressions: { carousel: { beats: [{ role: "setup", direction: "x" }] } },
    });
    expect(problems.some((p) => p.severity === "error" && p.detail.includes("at least two beats"))).toBe(true);
  });
});

describe("assessFit", () => {
  it("treats an unassessed need as unmet, never as met", () => {
    // The resolver said nothing about visible-technique. Silence is exactly the
    // case where nobody checked.
    const verdict = assessFit(concept, { subjectId: "10192-cela", assessments: [] });
    expect(verdict.eligible).toBe(false);
    expect(verdict.unmet.map((n) => n.id)).toEqual(["visible-technique"]);
  });

  it("separates a hard miss from a thin one", () => {
    const verdict = assessFit(concept, {
      subjectId: "25654-we-dont-talk",
      assessments: [
        { need: concept.needs[0]!, met: true },
        { need: concept.needs[1]!, met: false },
      ],
    });
    expect(verdict.eligible).toBe(true);
    expect(verdict.thin.map((n) => n.id)).toEqual(["medium-known"]);
  });
});

describe("selectSubjects", () => {
  const met = (id: string) => ({
    subjectId: id,
    assessments: [{ need: concept.needs[0]!, met: true }],
  });
  const unmet = (id: string) => ({
    subjectId: id,
    assessments: [{ need: concept.needs[0]!, met: false, evidence: "flat digital pattern, no marks" }],
  });

  it("returns what it found and names the shortfall rather than padding", () => {
    const result = selectSubjects(concept, [met("a"), unmet("b"), unmet("c")], 3);
    expect(result.chosen.map((c) => c.subjectId)).toEqual(["a"]);
    expect(result.shortfall).toBe(2);
    expect(result.note).toMatch(/Asked for 3, found 1/);
    expect(result.note).toMatch(/do NOT fill the gap/);
  });

  it("reports no shortfall when the request is satisfied", () => {
    const result = selectSubjects(concept, [met("a"), met("b")], 2);
    expect(result.shortfall).toBe(0);
    expect(result.chosen).toHaveLength(2);
  });

  it("never returns more than asked", () => {
    const result = selectSubjects(concept, [met("a"), met("b"), met("c")], 2);
    expect(result.chosen).toHaveLength(2);
  });
});

describe("beatInstruction", () => {
  it("appends the constants that must not vary between frames", () => {
    const carousel = concept.expressions.carousel!;
    const text = beatInstruction(carousel.beats[0]!, carousel.continuity);
    expect(text).toContain("Faint construction lines only");
    expect(text).toContain("the same drawing board");
    expect(text).toContain("one fixed overhead camera");
  });

  it("is just the direction when nothing is held constant", () => {
    expect(beatInstruction({ role: "setup", direction: "A wide shot" })).toBe("A wide shot");
  });
});
