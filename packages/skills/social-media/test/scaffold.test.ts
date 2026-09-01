import { describe, expect, it } from "vitest";
import { scaffoldSocialSystem, type ScaffoldSocialOptions } from "../src/scaffold";
import { STRATEGY_PATH, parseStrategy } from "../src/artifacts";
import { GENOME_PATH, parseGenome, rankArchetypes, resolveArchetype } from "../src/reference";

const opts: ScaffoldSocialOptions = {
  storeName: "Arthaus",
  storeUrl: "https://myarthaus.com",
  channels: ["instagram", "threads"],
  stampedAt: "2026-08-31T00:00:00+00:00",
  domain: "framed-art-retail",
  version: "0.17.0",
};

const files = scaffoldSocialSystem(opts);

describe("scaffoldSocialSystem", () => {
  it("emits the whole social/ tree", () => {
    expect(Object.keys(files).sort()).toEqual([
      "social/README.md",
      "social/calendar/.gitkeep",
      "social/posts/.gitkeep",
      "social/reference/README.md",
      "social/reference/corpus/.gitignore",
      "social/reference/genome.md",
      "social/reference/seeds.md",
      "social/strategy.md",
    ]);
  });

  it("is deterministic — same opts, byte-identical output", () => {
    expect(scaffoldSocialSystem(opts)).toEqual(files);
  });

  it("reads no clock (the stamp comes from opts)", () => {
    const other = scaffoldSocialSystem({ ...opts, stampedAt: "2027-01-01T00:00:00+00:00" });
    expect(other[GENOME_PATH]).toContain("2027-01-01T00:00:00+00:00");
    expect(files[GENOME_PATH]).toContain("2026-08-31T00:00:00+00:00");
  });
});

describe("the scaffold's own artifacts parse (the guarantee that matters)", () => {
  it("strategy.md round-trips through the real parser", () => {
    const strategy = parseStrategy(files[STRATEGY_PATH]);
    expect(strategy.channels.map((c) => c.channel)).toEqual(["instagram", "threads"]);
    expect(strategy.pillars).toHaveLength(3);
    expect(strategy.body).toContain("This is a scaffold, not a strategy");
  });

  it("defaults the channel roster to instagram", () => {
    const bare = scaffoldSocialSystem({ ...opts, channels: undefined });
    expect(parseStrategy(bare[STRATEGY_PATH]).channels.map((c) => c.channel)).toEqual(["instagram"]);
  });

  it("genome.md round-trips and its archetypes are in-bounds at every format", () => {
    const genome = parseGenome(files[GENOME_PATH]);
    expect(genome.domain).toBe("framed-art-retail");
    expect(genome.archetypes).toHaveLength(3);

    for (const board of [
      { width: 1080, height: 1080 },
      { width: 1080, height: 1350 },
      { width: 1080, height: 1920 },
    ]) {
      for (const a of genome.archetypes) {
        for (const s of resolveArchetype(a, board)) {
          expect(s.x + s.width).toBeLessThanOrEqual(board.width);
          expect(s.y + s.height).toBeLessThanOrEqual(board.height);
        }
      }
    }
  });

  it("the starter genome is honest: every archetype declares zero evidence", () => {
    const genome = parseGenome(files[GENOME_PATH]);
    expect(genome.archetypes.every((a) => a.evidence.n === 0)).toBe(true);
    expect(genome.provenance[0].claim).toContain("scaffold default");
    // Still usable — the tool ranks and returns them, so composition has a
    // vocabulary on day one.
    expect(rankArchetypes(genome)).toHaveLength(3);
    // …but a caller that only wants evidenced grammar gets nothing.
    expect(rankArchetypes(genome, { minEvidence: 1 })).toHaveLength(0);
  });
});

describe("the scaffold teaches the things that bite", () => {
  const readme = files["social/README.md"];

  it("documents all three ways to engage a coding agent", () => {
    expect(readme).toContain("The store console");
    expect(readme).toContain("Claude Code session over MCP");
    expect(readme).toContain("cloned");
  });

  it("states the approval boundary and the review-link caveat", () => {
    expect(readme).toContain("The agent proposes; a human approves");
    expect(readme).toContain("never an authorisation");
  });

  it("warns about the guardrails that surprise people", () => {
    // Prose is hard-wrapped, so assert on the unwrapped text — otherwise a
    // reflow breaks the test without changing what the doc says.
    const flat = readme.replace(/\s+/g, " ");
    expect(flat).toContain("voids its approval");
    expect(flat).toContain("Published posts are frozen");
    expect(flat).toContain("revision is pinned at approval time");
  });

  it("states the brand-dominates hierarchy in the reference lane", () => {
    expect(files["social/reference/README.md"]).toContain("DOMINATES");
    expect(files["social/reference/README.md"]).toContain("Abstractions, never assets");
  });

  it("gitignores the raw corpus so third-party content cannot be committed", () => {
    const ignore = files["social/reference/corpus/.gitignore"];
    expect(ignore).toContain("*");
    expect(ignore).toContain("!.gitignore");
  });
});
