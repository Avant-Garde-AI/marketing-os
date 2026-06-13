/**
 * Skill selection — picks the applicable skills for a task from the pinned
 * skill-set, ranked by match strength. This is the agent reaching for its
 * execution vocabulary at the right point in its path.
 */
import type { DesignSkill } from "./types.js";

export interface SelectInput {
  intent: string;
  sections: string[];
}

export function selectSkills(skills: DesignSkill[], input: SelectInput): DesignSkill[] {
  const intent = input.intent.toLowerCase();
  const sections = new Set(input.sections.map((s) => s.toLowerCase()));

  const scored = skills
    .map((skill) => ({ skill, score: matchScore(skill, intent, sections) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.skill);
}

function matchScore(skill: DesignSkill, intent: string, sections: Set<string>): number {
  let intentScore = 0;
  for (const kw of skill.appliesTo.intents) {
    if (intent.includes(kw.toLowerCase())) intentScore += 2;
  }
  let explicitSectionScore = 0;
  let universal = false;
  for (const sec of skill.appliesTo.sections) {
    const s = sec.toLowerCase();
    if (s === "all") universal = true;
    else if (sections.has(s)) explicitSectionScore += 1;
  }

  // A skill is a candidate only when the task's intent or an explicit section
  // triggers it. "all" marks a skill as compatible-with-any-section — a ranking
  // bonus once triggered, never a trigger on its own (else it always selects).
  if (intentScore === 0 && explicitSectionScore === 0) return 0;
  return intentScore + explicitSectionScore + (universal ? 1 : 0);
}
