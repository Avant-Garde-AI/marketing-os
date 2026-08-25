/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 — its test suite lives there). Keep this file faithful below this
 * header; fix bugs upstream first, then re-vendor.
 */
/**
 * Domain reference — the social genome contract (spec 24 §6).
 *
 * THIS MODULE IS THE SPEC. A store repo that wants its agent to compose with
 * domain fluency writes `social/reference/genome.md` to match
 * `genomeFrontMatterSchema`; the platform validates it, resolves its
 * archetypes to concrete geometry, and grounds compose on it. Everything a
 * store must adhere to is here, in one file, versioned with the pack.
 *
 * WHAT THIS LAYER DELIBERATELY DOES NOT DO. It does not acquire the corpus.
 * No scraping, no fetching, no vendor names, no credentials, no seed lists —
 * acquisition is domain-specific, frequently paid, and bound by a third
 * party's terms, so it belongs in the store's own repo behind the
 * `ReferenceCorpus` port. The platform ships the vocabulary; the store brings
 * the content. That is the same split as `ChannelTokenSource` (platform asks
 * for a token, store decides where it comes from) and `SocialRepo`.
 *
 * THE HIERARCHY, restated because it is the whole design: brand.md DOMINATES
 * (who the store is), the genome INFORMS (what the domain currently reads
 * like). Inverting these produces a competent forgery of the market average,
 * which for a brand whose value IS distinctiveness is a net loss.
 *
 * See the safety property on the genome types in types.ts: this contract
 * carries abstractions, never assets.
 */

import {
  frontMatterDocument as document,
  splitFrontMatter,
  validateFrontMatter as validate,
} from "../skill-kit";
import { z } from "zod";
import type {
  ArchetypeSlot,
  LayoutArchetype,
  SocialGenome,
  SocialRepo,
} from "./types";

// ---------------------------------------------------------------------------
// Canonical repo path
// ---------------------------------------------------------------------------

/** The distilled genome. Committed + reviewable, beside brand.md in spirit. */
export const GENOME_PATH = "social/reference/genome.md";

/**
 * Where a store's acquisition lane is expected to land its raw corpus. The
 * platform NEVER reads this — it is named only so store implementations
 * converge on one location instead of inventing five. Raw corpus is bulky
 * third-party content; stores should gitignore it and commit only the genome.
 */
export const CORPUS_DIR = "social/reference/corpus/";

/**
 * The competitor/cohort seed list a store's research step produces. Also
 * never read here — the platform has no opinion about who a store considers
 * its domain, only about the shape of what gets distilled from it.
 */
export const SEEDS_PATH = "social/reference/seeds.md";

// ---------------------------------------------------------------------------
// THE SPEC — what a store repo must produce
// ---------------------------------------------------------------------------

const FRACTION = z.number().min(0).max(1);

const slotSchema = z
  .object({
    role: z
      .string()
      .min(1)
      .describe("Semantic role compose fills, e.g. work / eyebrow / headline / cta"),
    kind: z.enum(["image", "text", "band"]).describe("Element type this slot expects"),
    x: FRACTION.describe("Left edge as a fraction of board width (0..1)"),
    y: FRACTION.describe("Top edge as a fraction of board height (0..1)"),
    w: z.number().gt(0).max(1).describe("Width as a fraction of board width"),
    h: z.number().gt(0).max(1).describe("Height as a fraction of board height"),
  })
  // In-bounds by construction: a validated archetype cannot overflow its
  // board at ANY resolution, so the compose fit-check's error tier can never
  // fire on resolved archetype geometry. Catching this here — where the
  // author can fix it — beats catching it at compose time.
  .refine((s) => s.x + s.w <= 1 + 1e-9, {
    message: "slot extends past the right edge (x + w must be <= 1)",
  })
  .refine((s) => s.y + s.h <= 1 + 1e-9, {
    message: "slot extends past the bottom edge (y + h must be <= 1)",
  });

const archetypeSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug")
    .describe("Stable slug, unique within the genome"),
  name: z.string().min(1),
  description: z.string().min(1).describe("What this layout is and when to choose it"),
  slots: z.array(slotSchema).min(1).describe("Regions, in normalized 0..1 coordinates"),
  evidence: z.object({
    n: z.number().int().nonnegative().describe("How many corpus exemplars this came from"),
    signal: z
      .number()
      .optional()
      .describe("Normalized performance signal; comparable only within one genome"),
  }),
});

export const genomeFrontMatterSchema = z.object({
  domain: z.string().min(1).describe("Opaque store-owned domain key, e.g. framed-art-retail"),
  channel: z.string().min(1).optional().describe("Narrows the genome to one channel"),
  archetypes: z.array(archetypeSchema).min(1),
  register: z
    .object({
      treatment: z.string().min(1),
      typographicPosture: z.string().min(1).optional(),
      doNot: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  copyFormulas: z
    .array(
      z.object({
        id: z.string().min(1),
        structure: z.string().min(1),
        example: z.string().min(1).optional(),
      }),
    )
    .optional(),
  distilledAt: z
    .string()
    .datetime({ offset: true })
    .describe("ISO datetime the distillation ran — staleness must be visible"),
  sources: z
    .array(z.string().min(1))
    .optional()
    .describe("Attribution handles for auditability — NOT fetch targets"),
  provenance: z
    .array(
      z.object({
        claim: z.string().min(1),
        origin: z.enum(["owner", "agent", "data"]),
      }),
    )
    .min(1)
    .describe("Where this genome's conclusions came from"),
});

/** Archetype ids must be unique — resolution addresses them by id. */
function assertUniqueIds(archetypes: { id: string }[], source: string): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const a of archetypes) {
    if (seen.has(a.id)) dupes.add(a.id);
    seen.add(a.id);
  }
  if (dupes.size > 0) {
    throw new Error(
      `${source}: duplicate archetype id(s) ${[...dupes].map((d) => `"${d}"`).join(", ")} — ids address archetypes, so they must be unique`,
    );
  }
}

// ---------------------------------------------------------------------------
// Artifact I/O
// ---------------------------------------------------------------------------

export function parseGenome(raw: string, source: string = GENOME_PATH): SocialGenome {
  const { frontMatter, body } = splitFrontMatter(raw, source);
  const fm = validate(genomeFrontMatterSchema, frontMatter, source);
  assertUniqueIds(fm.archetypes, source);
  const genome: SocialGenome = {
    domain: fm.domain,
    archetypes: fm.archetypes,
    distilledAt: fm.distilledAt,
    provenance: fm.provenance,
    body: body.trim(),
  };
  if (fm.channel) genome.channel = fm.channel;
  if (fm.register) genome.register = fm.register;
  if (fm.copyFormulas) genome.copyFormulas = fm.copyFormulas;
  if (fm.sources) genome.sources = fm.sources;
  return genome;
}

export function serializeGenome(genome: SocialGenome): string {
  const fm: Record<string, unknown> = { domain: genome.domain };
  if (genome.channel) fm.channel = genome.channel;
  fm.archetypes = genome.archetypes;
  if (genome.register) fm.register = genome.register;
  if (genome.copyFormulas) fm.copyFormulas = genome.copyFormulas;
  fm.distilledAt = genome.distilledAt;
  if (genome.sources) fm.sources = genome.sources;
  fm.provenance = genome.provenance;
  return document(fm, genome.body);
}

// ---------------------------------------------------------------------------
// Resolution — normalized archetype → concrete, fit-safe geometry
// ---------------------------------------------------------------------------

export interface ResolvedSlot {
  role: string;
  kind: ArchetypeSlot["kind"];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Board {
  width: number;
  height: number;
}

/**
 * Resolve an archetype's normalized slots to integer pixel rects on a board.
 * This is the programmatic seam: one archetype, any format.
 *
 * Rounding is the only thing that can push a validated (in-bounds) slot over
 * an edge, so every rect is clamped back inside the board afterwards. The
 * output therefore satisfies the compose fit-check's error tier by
 * construction — resolved geometry is always composable.
 */
export function resolveArchetype(archetype: LayoutArchetype, board: Board): ResolvedSlot[] {
  if (!Number.isFinite(board.width) || !Number.isFinite(board.height) || board.width <= 0 || board.height <= 0) {
    throw new Error(
      `resolveArchetype: board must have positive finite dimensions, got ${board.width}×${board.height}`,
    );
  }
  return archetype.slots.map((s) => {
    const x = Math.max(0, Math.min(Math.round(s.x * board.width), board.width - 1));
    const y = Math.max(0, Math.min(Math.round(s.y * board.height), board.height - 1));
    // Clamp against the board edge so rounding can never overflow; keep at
    // least 1px so the result is never a degenerate (non-positive) rect.
    const width = Math.max(1, Math.min(Math.round(s.w * board.width), board.width - x));
    const height = Math.max(1, Math.min(Math.round(s.h * board.height), board.height - y));
    return { role: s.role, kind: s.kind, x, y, width, height };
  });
}

// ---------------------------------------------------------------------------
// Selection — deterministic, evidence-aware
// ---------------------------------------------------------------------------

export interface RankOptions {
  /** Drop archetypes distilled from fewer than this many exemplars. */
  minEvidence?: number;
}

/**
 * Rank archetypes strongest-first: signal desc, then exemplar count desc,
 * then id asc. Fully deterministic — same genome, same order, every time
 * (layout is never a coin flip; cf. the compose layer's determinism rule).
 * Archetypes with no signal sort below those that have one at equal n.
 */
export function rankArchetypes(genome: SocialGenome, opts: RankOptions = {}): LayoutArchetype[] {
  const min = opts.minEvidence ?? 0;
  return genome.archetypes
    .filter((a) => a.evidence.n >= min)
    .slice()
    .sort((a, b) => {
      const as = a.evidence.signal ?? Number.NEGATIVE_INFINITY;
      const bs = b.evidence.signal ?? Number.NEGATIVE_INFINITY;
      if (as !== bs) return bs - as;
      if (a.evidence.n !== b.evidence.n) return b.evidence.n - a.evidence.n;
      return a.id.localeCompare(b.id);
    });
}

/** Look up one archetype by id. Returns null when absent — callers degrade. */
export function findArchetype(genome: SocialGenome, id: string): LayoutArchetype | null {
  return genome.archetypes.find((a) => a.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// The port — how a store supplies its genome
// ---------------------------------------------------------------------------

export interface GenomeQuery {
  /** Channel the post is for, e.g. "instagram". */
  channel?: string;
  /** Content pillar / intent from the plan slot, when the store keys on it. */
  pillar?: string;
}

/**
 * The seam a store repo implements. The default binding
 * (`repoReferenceCorpus`) reads the committed `social/reference/genome.md`,
 * which is all most stores need: the acquisition lane writes that file and
 * the platform picks it up with zero wiring. A store that wants something
 * live (DB, its own service) binds a custom implementation instead — the
 * compose layer never knows the difference.
 *
 * Returning null is a first-class answer meaning "no domain reference here",
 * and it must never be an error: a store without a genome composes exactly as
 * it does today, brand-only. Same null-degrading discipline as the publish
 * lane's `surfaceRevision` seam.
 */
export interface ReferenceCorpus {
  genome(query?: GenomeQuery): Promise<SocialGenome | null>;
}

/**
 * Default: the committed artifact in the store repo. Channel-specific
 * genomes are supported by convention — `social/reference/genome.{channel}.md`
 * wins over the base file when it exists, so a store can specialize Threads
 * without duplicating its Instagram grammar.
 */
export function repoReferenceCorpus(repo: SocialRepo): ReferenceCorpus {
  return {
    async genome(query?: GenomeQuery): Promise<SocialGenome | null> {
      const candidates = query?.channel
        ? [`social/reference/genome.${query.channel}.md`, GENOME_PATH]
        : [GENOME_PATH];
      for (const path of candidates) {
        const raw = await repo.readFile(path);
        if (raw !== null) return parseGenome(raw, path);
      }
      return null;
    },
  };
}

/** Explicit "this store has no domain reference" binding. */
export const emptyReferenceCorpus: ReferenceCorpus = {
  async genome(): Promise<SocialGenome | null> {
    return null;
  },
};
