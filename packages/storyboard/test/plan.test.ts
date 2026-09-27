import { describe, expect, it } from "vitest";
import { checkGrounding, planStoryboards } from "../src/plan";
import { createVisualCritic, type StoryModel } from "../src/critics";
import { patternSchema, type PlanningContext } from "../src/schemas";
import type { Storyboard } from "../src/types";

const context: PlanningContext = {
  brand: { source: "brand.md", content: "Editorial restraint." },
  facts: [{ source: "product:one", content: "A framed artwork." }],
  patterns: [],
  priorPosts: [],
  assets: [{ ref: "asset:framed", kind: "framed-render", verifiedBy: "owner" }],
};
const story: Storyboard = {
  id: "one",
  format: "carousel",
  premise: "Look at the boundary",
  payoff: "Notice the edge",
  beats: ["setup", "turn"].map((id, i) => ({
    id,
    role: i ? "turn" : "setup",
    assertion: "The work is framed",
    evidence: [{ claim: "Framed", origin: "data", source: "product:one" }],
    ...(i
      ? {
          transition: {
            change: "Whole object to edge",
            why: "Attend to the boundary",
            patternRefs: [],
          },
        }
      : {}),
    brief: {
      shows: i ? "The frame edge" : "The framed object",
      feels: "quiet",
      avoid: ["invented art"],
      sourcing: "store-asset",
      asset: { ref: "asset:framed", use: i ? "detail-crop" : "as-is" },
    },
  })),
  continuity: [{ what: "the work", binding: "fixed-asset", ref: "asset:framed" }],
};
function model(handler: (task: string, data: unknown) => unknown): StoryModel {
  return { generate: async (request) => request.schema.parse(handler(request.task, request.data)) };
}
const plans = { storyboards: [story, { ...story, id: "two" }, { ...story, id: "three" }] };

describe("planning before spend", () => {
  it("labels unsupported arcs hypotheses and returns eliminations for human agreement", async () => {
    const out = await planStoryboards(
      "An editorial post",
      context,
      model((task, data) => {
        if (task === "plan-storyboards") return plans;
        const id = (data as { storyboard: Storyboard }).storyboard.id;
        return {
          verdicts: [
            {
              kill: id === "two",
              score: 0.6,
              reason:
                id === "two"
                  ? "The edge repeats the first assertion; it does not earn a swipe"
                  : "The edge directs attention to the boundary",
            },
          ],
        };
      })
    );
    expect(out.status).toBe("awaiting-human-review");
    expect(out.options.filter((o) => o.status === "eliminated")).toHaveLength(1);
    expect(out.options.every((o) => o.evidenceStatus === "hypothesis")).toBe(true);
    expect(out.imageryCalls).toBe(0);
    expect(out.modelCalls).toBe(4);
    expect(out.missing.join(" ")).toContain("visually inspected corpus");
    expect(out.reviewHash).toHaveLength(64);
  });
  it("never treats an empty critic response as permission to proceed", async () => {
    const out = await planStoryboards(
      "A post",
      context,
      model((task) => (task === "plan-storyboards" ? plans : { verdicts: [] }))
    );
    expect(out.status).toBe("no-survivor");
  });
  it("rejects duplicate planner IDs before running critiques", async () => {
    await expect(
      planStoryboards(
        "A post",
        context,
        model(() => ({ storyboards: [story, story, story] }))
      )
    ).rejects.toThrow(/duplicate/);
  });
  it("refuses frame-inside-frame mockup input, including unverified purported masters", () => {
    const bad = structuredClone(story);
    bad.beats[0]!.brief.asset!.use = "mockup-input";
    expect(checkGrounding(bad, context)[0]!.reason).toContain("verified bare-artwork");
    expect(
      checkGrounding(bad, { ...context, assets: [{ ref: "asset:framed", kind: "bare-artwork" }] })
    ).toHaveLength(1);
    expect(
      checkGrounding(bad, {
        ...context,
        assets: [
          { ref: "asset:framed", kind: "bare-artwork", verifiedBy: "owner:master-manifest" },
        ],
      })
    ).toHaveLength(0);
  });
  it("refuses invented sources and prompt-only continuity", () => {
    const bad = structuredClone(story);
    bad.beats[1]!.evidence[0]!.source = "fiction";
    bad.continuity[0]!.binding = "prompt-only";
    expect(checkGrounding(bad, context)).toHaveLength(2);
  });
  it("does not infer a transition from a role named turn", () => {
    const bad = structuredClone(story);
    delete bad.beats[1]!.transition;
    expect(checkGrounding(bad, context)[0]!.reason).toContain("what changes");
  });
});

describe("visual critic", () => {
  it("sends image inputs and rejects incomplete candidate judgments", async () => {
    let images: unknown;
    const visualModel: StoryModel = {
      generate: async (request) => {
        images = request.images;
        return request.schema.parse({
          verdicts: [
            {
              kill: false,
              score: 0.8,
              reason: "Visible frame edge matches the brief",
              beatId: "setup",
              candidateId: "a",
            },
          ],
        });
      },
    };
    const critic = createVisualCritic(visualModel, context, story);
    const a = { id: "a", beatId: "setup", url: "https://example.test/a.png", origin: {} };
    await expect(critic.critique(story.beats[0]!, [a, { ...a, id: "b" }])).rejects.toThrow(
      /unjudged/
    );
    expect(images).toEqual([
      { label: "a", url: a.url },
      { label: "b", url: a.url },
    ]);
  });
});

it("does not let research carry a counted evidence field", () => {
  expect(() => patternSchema.parse({ id: "research", basis: "researched", move: "detail", rationale: "A hypothesis", sources: ["dossier.md"], evidence: { n: 5 } })).toThrow();
});
