import { describe, expect, it } from "vitest";
import { DelegationService } from "../src/delegation/handlers.js";
import { createStubProviders } from "../src/providers/index.js";
import {
  loadLocalSkillSet,
  selectSkills,
  LocalSkillSetSource,
  pullSkillSet,
} from "../src/skills/index.js";
import type { TaskSpecInput } from "../src/contract.js";

const set = loadLocalSkillSet();

describe("design skill library", () => {
  it("selects applicable skills ranked by match strength", () => {
    const picked = selectSkills(set.skills, { intent: "build the PDP above-the-fold hero", sections: ["hero", "product"] });
    const ids = picked.map((s) => s.id);
    expect(ids).toContain("build-pdp-above-fold");
    expect(ids).toContain("implement-hero-section");
    // strongest match ranks first
    expect(ids[0]).toBe("build-pdp-above-fold");
  });

  it("returns no skills when nothing matches the intent/sections", () => {
    expect(selectSkills(set.skills, { intent: "xyzzy", sections: ["nowhere"] })).toEqual([]);
  });

  it("pulls the bundled set on a matching or 'none' pin, and rejects a mismatch", async () => {
    const source = new LocalSkillSetSource();
    expect((await pullSkillSet(source, { version: "none" })).manifest.version).toBe(set.manifest.version);
    expect((await pullSkillSet(source, { version: set.manifest.version })).skills.length).toBe(set.skills.length);
    await expect(pullSkillSet(source, { version: "9.9.9" })).rejects.toThrow(/not available/i);
  });
});

describe("skills invoked through the deep agent", () => {
  function task(): TaskSpecInput {
    return {
      taskId: "t-skills-1",
      parent: { id: "planner", kind: "claude-code" },
      intent: "tighten the homepage hero hierarchy and CTA",
      brandDesignRef: { path: "docs/brand-design.md", version: "1.0.0" },
      brand: { brandId: "arthaus", tokens: { primary: "#111111", bg: "#ffffff" }, principles: ["quiet luxury"] },
      scope: { pages: ["/"], sections: ["hero"], files: [] },
    };
  }

  it("records selected skills as provenance and stamps the skill-set version", async () => {
    const svc = new DelegationService({
      now: () => "2026-06-13T00:00:00Z",
      buildProviders: async () => ({ ...createStubProviders(), skillSet: set }),
    });
    const { taskId, status } = await svc.implement(task(), { async: false });
    expect(status).toBe("completed");

    const { report } = svc.getReport(taskId);
    expect(report?.provenance.skillsInvoked.length).toBeGreaterThan(0);
    expect(report?.provenance.skillsInvoked).toContain("implement-hero-section");
    expect(report?.versionVector.skillset).toBe(set.manifest.version);
  });

  it("leaves provenance empty when no skill-set is pinned", async () => {
    const svc = new DelegationService({
      now: () => "2026-06-13T00:00:00Z",
      buildProviders: async () => createStubProviders(),
    });
    const { taskId } = await svc.implement(task(), { async: false });
    const { report } = svc.getReport(taskId);
    expect(report?.provenance.skillsInvoked).toEqual([]);
  });
});
