/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
/**
 * Slot resolution — the seam between "which layout" and "which artwork".
 *
 * `resolveArchetype` (reference.ts) answers where things go: a `work` image
 * belongs at these pixels on this board. It says nothing about WHICH work.
 * That question is this module, and it is the one step between a genome and a
 * post that nothing owned before — the agent filled roles ad hoc, so nothing
 * checked that every role got content, that an image slot got an image, or
 * that a chosen archetype was one the store could actually satisfy.
 *
 * TWO RULES, structural rather than conventional:
 *
 * 1. THE GENOME SUPPLIES STRUCTURE; THE STORE SUPPLIES PIXELS. Bindings carry
 *    `assetRef` strings, never bytes and never URLs into the reference corpus.
 *    A resolver that COULD read an image out of the corpus would eventually do
 *    it, and the corpus is third-party material that must never become the
 *    work. The type cannot express it, which is the only durable version of
 *    that rule.
 *
 * 2. UNFILLABLE ROLES FAIL LOUDLY. A missing room scene is a named miss, not
 *    an empty rect. Silently composing a blank is how a "designed" post
 *    becomes a grey box that still passes every fit-check — the exact failure
 *    the fit-check cannot see, because geometrically the box is perfect.
 *
 * No I/O, no clock, no randomness: same archetype + same bindings → the same
 * resolution, always. Materializing an `assetRef` into bytes is the caller's
 * job, at the compose boundary.
 */

import type { ArchetypeSlot, LayoutArchetype, SocialGenome } from "./types";
import { rankArchetypes, resolveArchetype, type Board, type ResolvedSlot } from "./reference";

// ---------------------------------------------------------------------------
// What can fill a slot
// ---------------------------------------------------------------------------

/**
 * Content for one slot, in the three kinds the genome vocabulary allows.
 *
 * `image` carries a REFERENCE, not bytes — see rule 1. The string is opaque
 * here: a store may key its assets however it likes (product id, media id, a
 * path into its own asset store) as long as its compose step understands it.
 */
export type SlotFill =
  | { kind: "image"; assetRef: string; alt?: string }
  | { kind: "text"; characters: string }
  | { kind: "band"; color: string };

/**
 * Role → content, as the caller assembled it. `null`/`undefined` is an
 * explicit "the store has nothing for this role" and produces a miss rather
 * than an exception: not having a room scene for every artwork is a normal
 * state, and the agent's response is to choose a different archetype.
 */
export type SlotBindings = Record<string, SlotFill | null | undefined>;

/** A resolved rect that now knows what goes in it. */
export interface FilledSlot extends ResolvedSlot {
  fill: SlotFill;
}

export interface SlotMiss {
  role: string;
  /** What the archetype expected here. */
  expected: ArchetypeSlot["kind"];
  reason: "unbound" | "kind-mismatch" | "empty";
  /** Sentence-shaped, for an agent or a human reading a failure. */
  detail: string;
}

export interface Resolution {
  archetypeId: string;
  board: Board;
  filled: FilledSlot[];
  misses: SlotMiss[];
  /** True when every slot the archetype declares has usable content. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function emptyFill(fill: SlotFill): boolean {
  if (fill.kind === "text") return fill.characters.trim() === "";
  if (fill.kind === "image") return fill.assetRef.trim() === "";
  return fill.color.trim() === "";
}

/**
 * Fill an archetype's slots from `bindings`, on a concrete board.
 *
 * Never throws for missing or wrong-kind content — those are reported as
 * `misses` so a caller can try another archetype. It throws only for a board
 * that cannot exist (delegated to `resolveArchetype`), which is a programming
 * error rather than a content gap.
 */
export function resolveSlots(
  archetype: LayoutArchetype,
  board: Board,
  bindings: SlotBindings,
): Resolution {
  const rects = resolveArchetype(archetype, board);
  const filled: FilledSlot[] = [];
  const misses: SlotMiss[] = [];

  for (const rect of rects) {
    const fill = bindings[rect.role];
    if (fill === undefined || fill === null) {
      misses.push({
        role: rect.role,
        expected: rect.kind,
        reason: "unbound",
        detail: `archetype "${archetype.id}" needs a ${rect.kind} for role "${rect.role}" and the store supplied none`,
      });
      continue;
    }
    if (fill.kind !== rect.kind) {
      misses.push({
        role: rect.role,
        expected: rect.kind,
        reason: "kind-mismatch",
        detail: `role "${rect.role}" expects a ${rect.kind} but was bound to a ${fill.kind}`,
      });
      continue;
    }
    if (emptyFill(fill)) {
      // An empty string is worse than an absent binding: it looks filled to
      // every downstream check and renders as nothing.
      misses.push({
        role: rect.role,
        expected: rect.kind,
        reason: "empty",
        detail: `role "${rect.role}" was bound to an empty ${fill.kind} — an empty slot renders as a blank, so it is treated as unfilled`,
      });
      continue;
    }
    filled.push({ ...rect, fill });
  }

  return {
    archetypeId: archetype.id,
    board,
    filled,
    misses,
    complete: misses.length === 0,
  };
}

/**
 * The loud version, for callers that have already committed to an archetype.
 * The message names every unsatisfied role at once — resolving them one error
 * per attempt is how a caller ends up round-tripping five times to learn it
 * was missing two things.
 */
export function assertComplete(resolution: Resolution): FilledSlot[] {
  if (!resolution.complete) {
    const lines = resolution.misses.map((m) => `  - ${m.detail}`).join("\n");
    throw new Error(
      `archetype "${resolution.archetypeId}" cannot be composed from the supplied content:\n${lines}\n` +
        `Bind the missing roles, or choose an archetype this store can fill (chooseArchetype does that for you).`,
    );
  }
  return resolution.filled;
}

// ---------------------------------------------------------------------------
// Choosing an archetype the store can actually satisfy
// ---------------------------------------------------------------------------

export interface ChooseOptions {
  /** Passed through to rankArchetypes — drop weakly-evidenced layouts. */
  minEvidence?: number;
  /** Consider only these archetype ids, in the caller's own priority order. */
  only?: string[];
}

export interface Choice {
  archetype: LayoutArchetype;
  resolution: Resolution;
}

/**
 * Pick the strongest archetype whose every slot this store can fill.
 *
 * This is the "pick a different archetype" step from the plan, made explicit.
 * Ranking stays `rankArchetypes`' business (evidence desc, deterministic), so
 * fillability filters that order rather than replacing it: the best layout the
 * store can actually satisfy, never merely the best layout.
 *
 * Returns null when nothing is fillable — a real answer meaning "compose
 * brand-only", consistent with a store having no genome at all. `rejected`
 * on the failure path would be nice, but a caller that wants the detail can
 * call resolveSlots on the archetype it cares about and read the misses.
 */
export function chooseArchetype(
  genome: SocialGenome,
  board: Board,
  bindings: SlotBindings,
  opts: ChooseOptions = {},
): Choice | null {
  const ranked = rankArchetypes(
    genome,
    opts.minEvidence !== undefined ? { minEvidence: opts.minEvidence } : {},
  );
  const candidates = opts.only
    ? opts.only
        .map((id) => ranked.find((a) => a.id === id))
        .filter((a): a is LayoutArchetype => a !== undefined)
    : ranked;

  for (const archetype of candidates) {
    const resolution = resolveSlots(archetype, board, bindings);
    if (resolution.complete) return { archetype, resolution };
  }
  return null;
}

/**
 * Which roles a store would need to fill to unlock each archetype.
 *
 * Useful before any content exists — a store can see that `room-in-situ`
 * costs it a room scene per artwork and decide whether that pillar is worth
 * the production. Sorted by how close each archetype is to fillable.
 */
export function missingRoles(
  genome: SocialGenome,
  board: Board,
  bindings: SlotBindings,
): { archetypeId: string; missing: SlotMiss[] }[] {
  return genome.archetypes
    .map((a) => ({ archetypeId: a.id, missing: resolveSlots(a, board, bindings).misses }))
    .sort((x, y) => x.missing.length - y.missing.length || x.archetypeId.localeCompare(y.archetypeId));
}
