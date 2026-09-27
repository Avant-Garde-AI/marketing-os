import type { Storyboard } from "../src/types";

/** Test fixture formatting only: no authored assessment values are invented. */
export function planningTransportFixtureV1(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("storyboards" in output)) return output;
  const storyboards = (output as { storyboards: Storyboard[] }).storyboards.map((storyboard) => {
    if (!storyboard.conceptId && !storyboard.needAssessments) return storyboard;
    const { needAssessments, ...story } = storyboard;
    const entries = (needAssessments ?? []).map(({ needId, ...authored }) => [needId, authored] as const);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error("Duplicate fixture need IDs");
    return { ...story, needAssessmentsById: Object.fromEntries(entries) };
  });
  return { transportVersion: "planning-v1", storyboards };
}
