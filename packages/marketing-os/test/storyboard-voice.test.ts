import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bindConceptVoice } from "../templates/agents/lib/storyboard/voice";
import type { PlanningContext } from "../templates/agents/lib/storyboard/schemas";
import type { PlanningConcept } from "../templates/agents/lib/storyboard/graph-context";
import { persistStoryboardReview, readStoryboardReview, storyboardContentHash } from "../templates/agents/lib/storyboard/reviews";

const base: PlanningContext = { brand: { source: "brand.md", content: "Keep writing concrete" }, facts: [], patterns: [], priorPosts: [], assets: [] };
const concept: PlanningConcept = { id: "a-detail", premise: "Notice a detail", payoff: "Understand its context", status: "draft", needs: [], expressions: { carousel: {} }, voice: { copyFormulaRefs: ["notice-and-explain"], hook: "Ask what changed" } };
const genome = `---
domain: synthetic-test
distilledAt: "2026-09-27T00:00:00Z"
provenance: [{claim: "Synthetic test writing guidance", origin: owner}]
archetypes:
  - id: uncounted-test-layout
    name: Synthetic fixture only
    description: Not an observed layout
    slots: [{role: image, kind: image, x: 0, y: 0, w: 1, h: 1}]
    evidence: {n: 0}
copyFormulas:
  - id: notice-and-explain
    structure: Name a visible detail and explain what changes its reading.
    example: A shadow reveals the depth of the fold.
  - id: unrelated-formula
    structure: A different writing rule.
---
Synthetic fixture, not a corpus exemplar.
`;
const repo = (raw: string | null) => ({ readFile: async () => raw });

describe("concept voice acquisition", () => {
  it("binds only declared writing definitions with the acquired genome receipt, without importing uncounted layouts", async () => {
    const result = await bindConceptVoice(base, concept, repo(genome));
    const hash = createHash("sha256").update(genome).digest("hex");
    expect(result.sources).toEqual([{ path: "social/reference/genome.md", hash: storyboardContentHash(genome) }]);
    expect(result.context.copyFormulas?.map((formula) => formula.id)).toEqual(["notice-and-explain"]);
    const definition = result.context.copyFormulas![0]!;
    expect(definition.source).toBe(`copy-formulas:${hash}`);
    expect(JSON.parse(definition.definition).structure).toContain("visible detail");
    const receipt = JSON.parse(result.context.facts.find((fact) => fact.source === definition.source)!.content);
    expect(receipt.copyFormulas).toHaveLength(1);
    expect(receipt).not.toHaveProperty("archetypes");
    expect(result.context.patterns).toEqual([]);
    expect(base.facts).toEqual([]);
  });
  it("does not require a genome or perform a read for legacy concepts without formula references", async () => {
    let reads = 0;
    const result = await bindConceptVoice(base, { ...concept, voice: { hook: "Look closer" } }, { readFile: async () => { reads++; return null; } });
    expect(reads).toBe(0);
    expect(result.context).toBe(base);
    expect(result.sources).toEqual([]);
  });
  it("refuses missing artifacts, missing definitions and duplicate requested references before planning", async () => {
    await expect(bindConceptVoice(base, concept, repo(null))).rejects.toThrow("acquired");
    await expect(bindConceptVoice(base, { ...concept, voice: { copyFormulaRefs: ["invented"] } }, repo(genome))).rejects.toThrow("unique definition");
    await expect(bindConceptVoice(base, { ...concept, voice: { copyFormulaRefs: ["notice-and-explain", "notice-and-explain"] } }, repo(genome))).rejects.toThrow("duplicate");
  });
  it("refuses ambiguous duplicate definitions rather than silently taking the first", async () => {
    const duplicate = genome.replace("  - id: unrelated-formula", "  - id: notice-and-explain");
    await expect(bindConceptVoice(base, concept, repo(duplicate))).rejects.toThrow("unique definition");
  });
  it("pins a changed artifact to a different source hash even if formula identifiers remain the same", async () => {
    const before = await bindConceptVoice(base, concept, repo(genome));
    const after = await bindConceptVoice(base, concept, repo(genome.replace("visible detail", "verified material detail")));
    expect(before.sources[0]!.hash).not.toBe(after.sources[0]!.hash);
    expect(before.context.copyFormulas![0]!.source).not.toBe(after.context.copyFormulas![0]!.source);
  });
  it("round-trips an acquired voice through durable review reads and refuses subsequent source edits", async () => {
    const files = new Map<string, string>([["social/reference/genome.md", genome]]);
    const store = { readFile: async (path: string) => files.get(path) ?? null,
      writeFile: async (path: string, content: string) => { files.set(path, content); } };
    const bound = await bindConceptVoice(base, concept, store);
    const artifact = await persistStoryboardReview({ repo: store, tenant: "test.myshopify.com", brief: "Synthetic persistence check",
      context: bound.context, sources: bound.sources, review: { status: "no-survivor", reviewHash: "a".repeat(64),
        options: ["a", "b", "c"].map(id => ({ storyboard: { id, format: "single" as const, premise: "Persistence fixture", payoff: "No accepted creative", beats: [{ id: "one", role: "payoff" as const, assertion: "Test fixture", brief: { shows: "Test", feels: "Test", avoid: ["production use"], sourcing: "generated" as const }, evidence: [{ claim: "Writing guidance", origin: "owner" as const, source: bound.context.copyFormulas![0]!.source }] }], continuity: [] }, verdicts: [{ kill: true, reason: "Synthetic persistence fixture" }], evidenceStatus: "hypothesis" as const, status: "eliminated" as const })),
        modelCalls: 0, imageryCalls: 0, missing: [] } });
    await expect(readStoryboardReview(store, artifact.reviewId, artifact.reviewHash, { tenant: artifact.tenant })).resolves.toEqual(artifact);
    files.set("social/reference/genome.md", genome + "\nEdited guidance");
    await expect(readStoryboardReview(store, artifact.reviewId, artifact.reviewHash, { tenant: artifact.tenant })).rejects.toThrow("Planning source changed");
  });
});
