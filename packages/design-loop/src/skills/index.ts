/**
 * Design Skill Library (PRD §4.3) — the design-code agent's execution vocabulary.
 */
export type { DesignSkill, SkillSet, SkillManifest, SkillSetPin, SkillSetSource } from "./types.js";
export { LOCAL_SKILLSET, loadLocalSkillSet } from "./local.js";
export { selectSkills, type SelectInput } from "./select.js";
export { LocalSkillSetSource, pullSkillSet } from "./source.js";
