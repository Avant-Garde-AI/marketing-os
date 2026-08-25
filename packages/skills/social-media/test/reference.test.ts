import { describe, expect, it } from "vitest";
import {
  GENOME_PATH,
  emptyReferenceCorpus,
  findArchetype,
  parseGenome,
  rankArchetypes,
  repoReferenceCorpus,
  resolveArchetype,
  serializeGenome,
} from "../src/reference";
import { createSocialTools } from "../src/tools";
import type { LayoutArchetype, SocialGenome, SocialRepo } from "../src/types";

function memoryRepo(seed: Record<string, string> = {}): SocialRepo & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const fullBleed: LayoutArchetype = {
  id: "full-bleed-work",
  name: "Full-bleed work",
  description: "The work fills the frame; a caption band carries attribution.",
  slots: [
    { role: "work", kind: "image", x: 0, y: 0, w: 1, h: 0.82 },
    { role: "caption-band", kind: "band", x: 0, y: 0.82, w: 1, h: 0.18 },
    { role: "attribution", kind: "text", x: 0.06, y: 0.86, w: 0.88, h: 0.1 },
  ],
  evidence: { n: 34, signal: 0.71 },
};

const quoteOverlay: LayoutArchetype = {
  id: "quote-overlay",
  name: "Quote overlay",
  description: "Editorial line set over a detail crop.",
  slots: [{ role: "work", kind: "image", x: 0, y: 0, w: 1, h: 1 }],
  evidence: { n: 12 },
};

function genome(overrides: Partial<SocialGenome> = {}): SocialGenome {
  return {
    domain: "framed-art-retail",
    archetypes: [fullBleed, quoteOverlay],
    register: { treatment: "Quiet, gallery-forward. Natural light.", doNot: ["neon gradients"] },
    copyFormulas: [{ id: "attribution-first", structure: "artist + title, then one-line provenance" }],
    distilledAt: "2026-08-01T00:00:00+00:00",
    provenance: [{ claim: "distilled from 46 retail exemplars", origin: "agent" }],
    body: "Rationale prose.",
    ...overrides,
  };
}

describe("genome artifact round-trip", () => {
  it("parse(serialize(x)) deep-equals x", () => {
    const g = genome({ channel: "instagram", sources: ["@examplegallery"] });
    expect(parseGenome(serializeGenome(g))).toEqual(g);
  });

  it("rejects a slot that overflows the board (the spec's core guarantee)", () => {
    const bad = genome({
      archetypes: [
        { ...fullBleed, slots: [{ role: "work", kind: "image", x: 0.5, y: 0, w: 0.8, h: 0.5 }] },
      ],
    });
    expect(() => parseGenome(serializeGenome(bad))).toThrow(/right edge/);
  });

  it("rejects duplicate archetype ids (ids are addresses)", () => {
    const dupe = genome({ archetypes: [fullBleed, { ...quoteOverlay, id: "full-bleed-work" }] });
    expect(() => parseGenome(serializeGenome(dupe))).toThrow(/duplicate archetype id/);
  });

  it("rejects a non-slug archetype id", () => {
    const bad = genome({ archetypes: [{ ...fullBleed, id: "Full Bleed" }] });
    expect(() => parseGenome(serializeGenome(bad))).toThrow();
  });
});

describe("resolveArchetype", () => {
  const formats: [string, { width: number; height: number }][] = [
    ["IG square", { width: 1080, height: 1080 }],
    ["IG portrait", { width: 1080, height: 1350 }],
    ["story", { width: 1080, height: 1920 }],
    ["odd", { width: 703, height: 197 }],
  ];

  it.each(formats)("keeps every slot inside the board — %s", (_label, board) => {
    for (const a of [fullBleed, quoteOverlay]) {
      for (const s of resolveArchetype(a, board)) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
        expect(s.x + s.width).toBeLessThanOrEqual(board.width);
        expect(s.y + s.height).toBeLessThanOrEqual(board.height);
      }
    }
  });

  it("scales the same archetype across formats", () => {
    const square = resolveArchetype(fullBleed, { width: 1080, height: 1080 });
    const portrait = resolveArchetype(fullBleed, { width: 1080, height: 1350 });
    expect(square[0]).toMatchObject({ role: "work", x: 0, y: 0, width: 1080, height: 886 });
    expect(portrait[0]).toMatchObject({ role: "work", x: 0, y: 0, width: 1080, height: 1107 });
  });

  it("is deterministic", () => {
    const board = { width: 1080, height: 1350 };
    expect(resolveArchetype(fullBleed, board)).toEqual(resolveArchetype(fullBleed, board));
  });

  it("refuses a non-positive board", () => {
    expect(() => resolveArchetype(fullBleed, { width: 0, height: 100 })).toThrow(/positive finite/);
  });
});

describe("rankArchetypes", () => {
  it("orders by signal, then n, then id — and sinks unsignalled archetypes", () => {
    expect(rankArchetypes(genome()).map((a) => a.id)).toEqual(["full-bleed-work", "quote-overlay"]);
  });

  it("filters by minEvidence", () => {
    expect(rankArchetypes(genome(), { minEvidence: 20 }).map((a) => a.id)).toEqual([
      "full-bleed-work",
    ]);
  });

  it("breaks ties on id, deterministically", () => {
    const a = { ...quoteOverlay, id: "b-arch", evidence: { n: 5 } };
    const b = { ...quoteOverlay, id: "a-arch", evidence: { n: 5 } };
    expect(rankArchetypes(genome({ archetypes: [a, b] })).map((x) => x.id)).toEqual([
      "a-arch",
      "b-arch",
    ]);
  });

  it("findArchetype returns null for an unknown id", () => {
    expect(findArchetype(genome(), "nope")).toBeNull();
    expect(findArchetype(genome(), "quote-overlay")?.name).toBe("Quote overlay");
  });
});

describe("repoReferenceCorpus", () => {
  it("reads the committed genome", async () => {
    const repo = memoryRepo({ [GENOME_PATH]: serializeGenome(genome()) });
    expect((await repoReferenceCorpus(repo).genome())?.domain).toBe("framed-art-retail");
  });

  it("prefers a channel-specific genome when present", async () => {
    const repo = memoryRepo({
      [GENOME_PATH]: serializeGenome(genome()),
      "social/reference/genome.threads.md": serializeGenome(genome({ domain: "threads-native" })),
    });
    const corpus = repoReferenceCorpus(repo);
    expect((await corpus.genome({ channel: "threads" }))?.domain).toBe("threads-native");
    expect((await corpus.genome({ channel: "instagram" }))?.domain).toBe("framed-art-retail");
  });

  it("returns null when the store has no genome (never throws)", async () => {
    expect(await repoReferenceCorpus(memoryRepo()).genome()).toBeNull();
    expect(await emptyReferenceCorpus.genome()).toBeNull();
  });
});

describe("social_genome_read", () => {
  const board = { width: 1080, height: 1350 };
  const NOW = Date.parse("2026-08-25T00:00:00Z");

  it("returns board-resolved archetypes, strongest first, with staleness", async () => {
    const repo = memoryRepo({ [GENOME_PATH]: serializeGenome(genome()) });
    const tools = createSocialTools(repo, repoReferenceCorpus(repo), () => NOW);
    const out = await tools.social_genome_read.execute({ board });

    expect(out.available).toBe(true);
    expect(out.domain).toBe("framed-art-retail");
    expect(out.ageDays).toBe(24);
    expect(out.archetypes?.[0].id).toBe("full-bleed-work");
    expect(out.archetypes?.[0].slots[0]).toMatchObject({ width: 1080, height: 1107 });
    expect(out.register?.doNot).toEqual(["neon gradients"]);
    expect(out.copyFormulas?.[0].id).toBe("attribution-first");
  });

  it("degrades to available:false with guidance when no genome exists", async () => {
    const repo = memoryRepo();
    const out = await createSocialTools(repo, repoReferenceCorpus(repo), () => NOW)
      .social_genome_read.execute({ board });
    expect(out.available).toBe(false);
    expect(out.archetypes).toBeUndefined();
    expect(out.note).toMatch(/brand\.md alone/);
  });

  it("degrades when minEvidence filters every archetype out", async () => {
    const repo = memoryRepo({ [GENOME_PATH]: serializeGenome(genome()) });
    const out = await createSocialTools(repo, repoReferenceCorpus(repo), () => NOW)
      .social_genome_read.execute({ board, minEvidence: 500 });
    expect(out.available).toBe(false);
    expect(out.note).toMatch(/minEvidence=500/);
    expect(out.domain).toBe("framed-art-retail");
  });

  it("defaults to the repo-backed corpus with no explicit binding", async () => {
    const repo = memoryRepo({ [GENOME_PATH]: serializeGenome(genome()) });
    const out = await createSocialTools(repo).social_genome_read.execute({ board });
    expect(out.available).toBe(true);
  });
});
