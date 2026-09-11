import { createMemoryRepo } from "@avant-garde/skill-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { createConceptTools } from "../src/concept-tools";
import { conceptPath, parseConcept, serializeConcept, type PostConcept } from "../src/concepts";

const howItWasMade: PostConcept = {
  id: "how-it-was-made",
  name: "How it was made",
  premise: "Reconstruct the making of a piece — the marks in the order they were laid down.",
  payoff: "You see the hand behind a piece you were only ever going to meet finished.",
  needs: [
    { id: "visible-technique", description: "The work shows inferable technique" },
    { id: "medium-known", description: "The medium is recorded", required: false },
  ],
  expressions: {
    carousel: {
      beats: [
        { role: "setup", direction: "Faint construction lines only", archetypeId: "work-detail" },
        { role: "payoff", direction: "The finished work", archetypeId: "work-detail" },
      ],
      continuity: ["one fixed overhead camera", "unchanged daylight"],
    },
    video: {
      beats: [
        { role: "setup", direction: "A hand begins", seconds: 3 },
        { role: "payoff", direction: "The work resolves", seconds: 5 },
      ],
      availability: "blocked",
      availabilityNote: "no Veo access on this project",
    },
  },
  voice: { copyFormulaRefs: ["artist-in-a-sentence"], hook: "Name the first mark." },
  evidence: { kind: "brand-derived", n: 0 },
  status: "draft",
  body: "",
};

function repoWith(...concepts: PostConcept[]) {
  const files: Record<string, string> = {};
  for (const c of concepts) files[conceptPath(c.id)] = serializeConcept(c);
  return createMemoryRepo(files);
}

describe("social_concept_list", () => {
  it("reports an empty store as normal, not as an error", async () => {
    const tools = createConceptTools(createMemoryRepo());
    const out = await tools.social_concept_list.execute({});
    expect(out.available).toBe(false);
    expect(out.note).toMatch(/no post concepts yet/);
  });

  it("separates producible formats from blocked ones, with the reason", async () => {
    const tools = createConceptTools(repoWith(howItWasMade));
    const out = await tools.social_concept_list.execute({});
    const c = out.concepts[0]!;
    expect(c.formats).toEqual(["carousel"]);
    expect(c.blockedFormats).toEqual([{ format: "video", why: "no Veo access on this project" }]);
    expect(c.needs).toEqual(["visible-technique", "medium-known"]);
  });
});

describe("social_concept_read", () => {
  it("returns the concept with any standing warnings", async () => {
    const tools = createConceptTools(repoWith(howItWasMade));
    const out = await tools.social_concept_read.execute({ id: "how-it-was-made" });
    expect(out.found).toBe(true);
    expect((out.concept as PostConcept).premise).toMatch(/order they were laid down/);
  });

  it("says so plainly when there is no such concept", async () => {
    const tools = createConceptTools(createMemoryRepo());
    const out = await tools.social_concept_read.execute({ id: "nope" });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/No concept "nope"/);
  });
});

describe("social_concept_draft", () => {
  const base = {
    id: "one-work-three-rooms",
    name: "One work, three rooms",
    premise: "The same piece, in three genuinely different rooms.",
    payoff: "You can tell whether it works in a room like yours, not in a gallery.",
    needs: [{ id: "three-rooms", description: "A work with at least three distinct room scenes" }],
    expressions: {
      carousel: {
        beats: [
          { role: "setup", direction: "Room one" },
          { role: "payoff", direction: "Room three" },
        ],
        continuity: ["the same work, same frame"],
      },
    },
    evidence: { kind: "brand-derived" as const, n: 0 },
  };

  it("stores a draft and never an active concept", async () => {
    const repo = createMemoryRepo();
    const tools = createConceptTools(repo);
    const out = await tools.social_concept_draft.execute(base);
    expect(out.ok).toBe(true);
    const stored = parseConcept((await repo.readFile(out.path!))!);
    expect(stored.status).toBe("draft");
  });

  it("refuses to overwrite an idea the store may already be running", async () => {
    const tools = createConceptTools(repoWith(howItWasMade));
    const out = await tools.social_concept_draft.execute({ ...base, id: "how-it-was-made" });
    expect(out.ok).toBe(false);
    expect(out.note).toMatch(/already exists/);
  });

  it("stores a brand-side payoff but says what is wrong with it", async () => {
    const repo = createMemoryRepo();
    const tools = createConceptTools(repo);
    const out = await tools.social_concept_draft.execute({
      ...base,
      payoff: "Showcases our collection.",
    });
    expect(out.ok).toBe(true);
    expect(out.note).toMatch(/reader's chair/);
  });

  it("does not store a concept whose evidence overclaims", async () => {
    const repo = createMemoryRepo();
    const tools = createConceptTools(repo);
    const out = await tools.social_concept_draft.execute({
      ...base,
      evidence: { kind: "brand-derived", n: 32 },
    });
    expect(out.ok).toBe(false);
    expect(await repo.readFile(conceptPath(base.id))).toBeNull();
  });
});

describe("social_concept_instantiate", () => {
  const tools = () => createConceptTools(repoWith(howItWasMade));

  it("returns what it found and names the shortfall rather than inventing", async () => {
    // Cela is a flat digital pattern: there is no process to reconstruct, which
    // is exactly the case `visible-technique` exists to refuse.
    const out = await tools().social_concept_instantiate.execute({
      conceptId: "how-it-was-made",
      n: 3,
      candidates: [
        {
          subjectId: "25654-we-dont-talk",
          label: "We Don't Talk About That",
          assessments: [{ needId: "visible-technique", met: true, evidence: "ink and pencil linework" }],
        },
        {
          subjectId: "10192-cela",
          assessments: [
            { needId: "visible-technique", met: false, evidence: "flat digital repeat pattern, no marks" },
          ],
        },
        { subjectId: "10157-road-to-heaven", assessments: [] },
      ],
    });
    expect(out.produced).toBe(1);
    expect(out.shortfall).toBe(2);
    expect(out.ok).toBe(false);
    expect(out.note).toMatch(/do NOT fill the gap/);
    expect(out.rejected.map((r) => r.subjectId).sort()).toEqual(["10157-road-to-heaven", "10192-cela"]);
  });

  it("carries the continuity constants into every frame instruction", async () => {
    const out = await tools().social_concept_instantiate.execute({
      conceptId: "how-it-was-made",
      n: 1,
      candidates: [
        { subjectId: "a", assessments: [{ needId: "visible-technique", met: true, evidence: "pen" }] },
      ],
    });
    expect(out.format).toBe("carousel");
    for (const frame of out.plans[0]!.frames) {
      expect(frame.instruction).toContain("one fixed overhead camera");
      expect(frame.instruction).toContain("unchanged daylight");
    }
  });

  it("keeps the grounding evidence with the plan, for review", async () => {
    const out = await tools().social_concept_instantiate.execute({
      conceptId: "how-it-was-made",
      n: 1,
      candidates: [
        {
          subjectId: "a",
          assessments: [{ needId: "visible-technique", met: true, evidence: "visible pen strokes" }],
        },
      ],
    });
    expect(out.plans[0]!.grounding).toEqual([
      { needId: "visible-technique", evidence: "visible pen strokes" },
    ]);
    expect(out.plans[0]!.thinOn).toEqual(["medium-known"]);
  });

  it("will not produce a format the store cannot make", async () => {
    const out = await tools().social_concept_instantiate.execute({
      conceptId: "how-it-was-made",
      n: 1,
      format: "video",
      candidates: [
        { subjectId: "a", assessments: [{ needId: "visible-technique", met: true, evidence: "pen" }] },
      ],
    });
    expect(out.ok).toBe(false);
    expect(out.produced).toBe(0);
    expect(out.note).toMatch(/no Veo access/);
  });

  it("ignores an assessment naming a need the concept does not have", async () => {
    // A typo'd needId must not read as grounding for the real need.
    const out = await tools().social_concept_instantiate.execute({
      conceptId: "how-it-was-made",
      n: 1,
      candidates: [
        { subjectId: "a", assessments: [{ needId: "visible-technqiue", met: true, evidence: "typo" }] },
      ],
    });
    expect(out.produced).toBe(0);
    expect(out.rejected[0]!.unmet).toEqual(["visible-technique"]);
  });
});
