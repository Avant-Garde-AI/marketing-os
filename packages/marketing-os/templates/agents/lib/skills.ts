/**
 * Skill registry loader for agent capabilities
 */

import { readdir, readFile } from "fs/promises"
import { join } from "path"

export interface Skill {
  id: string
  name: string
  description: string
  category: string
  enabled: boolean
  config?: Record<string, unknown>
  handler?: string
  examples?: string[]
  tags?: string[]
}

export interface SkillRegistry {
  skills: Skill[]
  categories: string[]
}

/**
 * Load skills from a directory
 */
export async function loadSkills(skillsDir: string): Promise<SkillRegistry> {
  const skills: Skill[] = []
  const categories = new Set<string>()

  try {
    const files = await readdir(skillsDir)

    for (const file of files) {
      if (!file.endsWith(".json") && !file.endsWith(".ts") && !file.endsWith(".js")) {
        continue
      }

      const filePath = join(skillsDir, file)

      try {
        let skill: Skill

        if (file.endsWith(".json")) {
          const content = await readFile(filePath, "utf-8")
          skill = JSON.parse(content)
        } else {
          // For .ts/.js files, dynamically import them
          const module = await import(filePath)
          skill = module.default || module.skill
        }

        if (skill && skill.id && skill.name) {
          skills.push(skill)
          if (skill.category) {
            categories.add(skill.category)
          }
        }
      } catch (error) {
        console.warn(`Failed to load skill from ${file}:`, error)
      }
    }
  } catch (error) {
    console.warn(`Failed to read skills directory ${skillsDir}:`, error)
  }

  return {
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    categories: Array.from(categories).sort(),
  }
}

/**
 * Get skill by ID
 */
export function getSkillById(registry: SkillRegistry, id: string): Skill | undefined {
  return registry.skills.find(skill => skill.id === id)
}

/**
 * Get skills by category
 */
export function getSkillsByCategory(registry: SkillRegistry, category: string): Skill[] {
  return registry.skills.filter(skill => skill.category === category)
}

/**
 * Get enabled skills
 */
export function getEnabledSkills(registry: SkillRegistry): Skill[] {
  return registry.skills.filter(skill => skill.enabled)
}

/**
 * Search skills by name or description
 */
export function searchSkills(registry: SkillRegistry, query: string): Skill[] {
  const lowerQuery = query.toLowerCase()
  return registry.skills.filter(
    skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery) ||
      skill.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

/**
 * Validate skill configuration
 */
export function validateSkill(skill: Partial<Skill>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!skill.id) errors.push("Skill ID is required")
  if (!skill.name) errors.push("Skill name is required")
  if (!skill.description) errors.push("Skill description is required")
  if (!skill.category) errors.push("Skill category is required")
  if (skill.enabled === undefined) errors.push("Skill enabled status is required")

  // Validate ID format (alphanumeric, hyphens, underscores)
  if (skill.id && !/^[a-z0-9-_]+$/.test(skill.id)) {
    errors.push("Skill ID must contain only lowercase letters, numbers, hyphens, and underscores")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Create a new skill registry
 */
export function createSkillRegistry(skills: Skill[] = []): SkillRegistry {
  const categories = new Set<string>()

  skills.forEach(skill => {
    if (skill.category) {
      categories.add(skill.category)
    }
  })

  return {
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    categories: Array.from(categories).sort(),
  }
}

/**
 * Merge multiple skill registries
 */
export function mergeRegistries(...registries: SkillRegistry[]): SkillRegistry {
  const allSkills: Skill[] = []
  const skillIds = new Set<string>()

  for (const registry of registries) {
    for (const skill of registry.skills) {
      if (!skillIds.has(skill.id)) {
        allSkills.push(skill)
        skillIds.add(skill.id)
      }
    }
  }

  return createSkillRegistry(allSkills)
}

/**
 * Example built-in skills
 */
export const builtInSkills: Skill[] = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Perform automated code reviews on pull requests",
    category: "development",
    enabled: true,
    tags: ["code", "review", "quality"],
    examples: [
      "Review PR #123",
      "Check code quality in the latest commit",
    ],
  },
  {
    id: "bug-tracker",
    name: "Bug Tracker",
    description: "Track and manage bugs across repositories",
    category: "development",
    enabled: true,
    tags: ["bugs", "issues", "tracking"],
    examples: [
      "Show open bugs",
      "Create bug report for login issue",
    ],
  },
  {
    id: "deployment",
    name: "Deployment Manager",
    description: "Manage deployments and releases",
    category: "operations",
    enabled: true,
    tags: ["deploy", "release", "production"],
    examples: [
      "Deploy to production",
      "Check deployment status",
    ],
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Analyze code metrics and project statistics",
    category: "insights",
    enabled: true,
    tags: ["metrics", "stats", "analysis"],
    examples: [
      "Show code coverage",
      "Analyze commit history",
    ],
  },
]
