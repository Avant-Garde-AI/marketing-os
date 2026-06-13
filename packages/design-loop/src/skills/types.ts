/**
 * Design Skill Library (PRD §4.3) — the design-code agent's execution
 * vocabulary. Versioned, pinned, pulled at session start, invoked for common
 * Shopify design tasks. Each skill encodes a vetted design procedure (a
 * SKILL.md body); the library treats skill-sets as artifacts to optimize (§5).
 */

export interface DesignSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Matching surface for selection. */
  appliesTo: {
    intents: string[];
    sections: string[];
  };
  /** The vetted, ordered procedure (the SKILL.md body). */
  procedure: string[];
}

export interface SkillManifest {
  /** Skill-set version (semver) — rides the release discipline (PRD §7). */
  version: string;
  skills: { id: string; version: string }[];
  /** Compatibility expressed in the manifest (PRD §7). */
  compatibility?: {
    agentMin?: string;
    mcpSnapshot?: string;
  };
}

export interface SkillSet {
  manifest: SkillManifest;
  skills: DesignSkill[];
}

/** What the agent pins in config and pulls at session start. */
export interface SkillSetPin {
  version: string;
}

export interface SkillSetSource {
  pull(pin: SkillSetPin): Promise<SkillSet>;
}
