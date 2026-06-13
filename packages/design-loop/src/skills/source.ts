/**
 * Skill-set sources — how the agent pulls a pinned skill-set at session start
 * (PRD §4.3). Local (bundled v0) is the default; a remote registry serves
 * versioned artifacts. Pinning is the contract: the agent asks for a version,
 * the source returns that skill-set or fails loudly on a mismatch.
 */
import { loadLocalSkillSet } from "./local.js";
import type { SkillSet, SkillSetPin, SkillSetSource } from "./types.js";

/** Serves the bundled v0 skill-set. Honors `"none"` and matching-version pins. */
export class LocalSkillSetSource implements SkillSetSource {
  async pull(pin: SkillSetPin): Promise<SkillSet> {
    const set = loadLocalSkillSet();
    if (pin.version !== "none" && pin.version !== set.manifest.version) {
      throw new Error(
        `Pinned skill-set ${pin.version} not available locally (have ${set.manifest.version}); configure a remote registry.`,
      );
    }
    return set;
  }
}

export async function pullSkillSet(source: SkillSetSource, pin: SkillSetPin): Promise<SkillSet> {
  return source.pull(pin);
}
