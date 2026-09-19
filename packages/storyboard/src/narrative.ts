/**
 * Structural validation of a Storyboard (spec 33 §7, criteria 2–4).
 *
 * This is the cheapest critic in the system and the only one that is pure: it
 * reads the arc, spends nothing, and can run before a single image exists. It
 * is deliberately NOT a taste judgement — it answers "is this a story at all",
 * not "is this a good one". Taste is §4's narrative critic, and it is a
 * separate thing so that a model's opinion can never quietly replace a
 * structural guarantee.
 *
 * The rules below all trace to something that actually happened.
 */

import {
  BEAT_ROLES,
  type Beat,
  type Problem,
  type Storyboard,
  type StoryboardFormat,
} from "./types";

/** Beats a format may carry. A carousel of one is a single; a single of three is a lie. */
const BEAT_BOUNDS: Record<StoryboardFormat, { min: number; max: number }> = {
  single: { min: 1, max: 1 },
  carousel: { min: 2, max: 10 },
  video: { min: 2, max: 8 },
};

function isBlank(s: string | undefined): boolean {
  return !s || !s.trim();
}

/**
 * Does the arc turn?
 *
 * A sequence that never leaves `setup` is a catalogue with slide numbers. This
 * is the single most valuable structural rule, because the failure it catches —
 * three variations of the same statement — is exactly what the first three
 * composed posts were, and no amount of visual polish fixes it.
 *
 * A single is exempt: a one-beat arc implies its turn rather than showing one.
 */
function hasTurn(storyboard: Storyboard): boolean {
  if (storyboard.format === "single") return true;
  const roles = new Set(storyboard.beats.map((b) => b.role));
  return roles.has("turn") || (roles.has("tension") && roles.has("payoff"));
}

/**
 * Validate structure. Fatal problems mean it cannot be built; non-fatal mean it
 * probably should not be.
 */
export function validateStoryboard(storyboard: Storyboard): Problem[] {
  const problems: Problem[] = [];
  const fail = (field: string, detail: string) => problems.push({ field, detail, fatal: true });
  const warn = (field: string, detail: string) => problems.push({ field, detail, fatal: false });

  if (isBlank(storyboard.id)) fail("id", "a storyboard needs an id");
  if (isBlank(storyboard.premise)) {
    fail(
      "premise",
      "no premise — the arc in one sentence. If it cannot be written, there is no story yet and the beats will be decoration",
    );
  }
  if (isBlank(storyboard.payoff)) {
    fail("payoff", "no payoff — say why anyone should care before deciding what to show");
  }

  const bounds = BEAT_BOUNDS[storyboard.format];
  if (!bounds) {
    fail("format", `unknown format "${storyboard.format}"`);
  } else if (storyboard.beats.length < bounds.min || storyboard.beats.length > bounds.max) {
    fail(
      "beats",
      `${storyboard.format} takes ${bounds.min}–${bounds.max} beats, got ${storyboard.beats.length}`,
    );
  }

  const seen = new Set<string>();
  for (const beat of storyboard.beats) {
    const at = `beats.${beat.id || "(unnamed)"}`;
    if (isBlank(beat.id)) fail("beats", "a beat with no id cannot be referenced by a critic or a candidate");
    else if (seen.has(beat.id)) fail(at, `duplicate beat id "${beat.id}"`);
    seen.add(beat.id);

    if (!BEAT_ROLES.includes(beat.role)) {
      fail(`${at}.role`, `unknown role "${beat.role}" — expected one of ${BEAT_ROLES.join(", ")}`);
    }
    if (isBlank(beat.assertion)) {
      fail(
        `${at}.assertion`,
        "a beat that asserts nothing is decoration — say the one thing it claims, in a sentence someone could disagree with",
      );
    }
    problems.push(...validateBrief(beat, at));

    if (!beat.evidence?.length) {
      warn(
        `${at}.evidence`,
        "no evidence — the assertion cannot be checked, and the claims guard has nothing to verify against",
      );
    }
  }

  if (!hasTurn(storyboard)) {
    fail(
      "beats",
      `no turn: roles are ${storyboard.beats.map((b) => b.role).join(" → ") || "(none)"}. ` +
        "A sequence that never leaves setup is a catalogue with slide numbers. Give it a `turn`, " +
        "or a `tension` that a `payoff` resolves",
    );
  }

  problems.push(...validateContinuity(storyboard));
  return problems;
}

/** The brief must be actionable by a generator, not evocative to a human. */
function validateBrief(beat: Beat, at: string): Problem[] {
  const out: Problem[] = [];
  const brief = beat.brief;
  if (!brief) {
    return [{ field: `${at}.brief`, detail: "no visual brief — nothing to generate from", fatal: true }];
  }
  if (isBlank(brief.shows)) {
    out.push({
      field: `${at}.brief.shows`,
      detail: "say what is literally in frame; a generator cannot act on a mood alone",
      fatal: true,
    });
  }
  if (isBlank(brief.feels)) {
    out.push({
      field: `${at}.brief.feels`,
      detail: "no register — the picture will be on-subject and off-brand",
      fatal: false,
    });
  }
  if (!brief.avoid?.length) {
    // Not fatal, but this is the field that would have prevented a catalogue
    // render being used where an intimate crop was specified.
    out.push({
      field: `${at}.brief.avoid`,
      detail:
        "nothing to avoid? This is where the intent that used to live in unread prose becomes enforceable — " +
        "state what would ruin this beat",
      fatal: false,
    });
  }
  if (brief.seconds !== undefined && brief.seconds <= 0) {
    out.push({ field: `${at}.brief.seconds`, detail: "seconds must be positive", fatal: true });
  }
  return out;
}

/**
 * Continuity must be BOUND, not described.
 *
 * `prompt-only` is permitted and warned about, every time. It is the form that
 * produced four unrelated-looking frames from a brief that read as consistent,
 * and the warning is the only record that a known-weak mechanism was chosen.
 */
function validateContinuity(storyboard: Storyboard): Problem[] {
  const out: Problem[] = [];
  const multiBeat = storyboard.beats.length > 1;

  if (multiBeat && !storyboard.continuity?.length) {
    out.push({
      field: "continuity",
      detail:
        "a multi-beat storyboard with no continuity constants will read as unrelated pictures — " +
        "name what must not change (the work, the camera, the light) before generating",
      fatal: false,
    });
  }

  for (const c of storyboard.continuity ?? []) {
    if (isBlank(c.what)) {
      out.push({ field: "continuity", detail: "a continuity constant with no subject", fatal: true });
      continue;
    }
    if (c.binding === "prompt-only") {
      out.push({
        field: "continuity",
        detail:
          `"${c.what}" is held by prompt text alone, which does not hold. Bind it to a reference frame ` +
          "or a fixed asset, or expect it to drift between beats",
        fatal: false,
      });
    } else if (!c.ref) {
      out.push({
        field: "continuity",
        detail: `"${c.what}" claims binding "${c.binding}" but names no ref to bind to`,
        fatal: true,
      });
    }
  }
  return out;
}

/** Convenience: fatal problems only. */
export function fatalProblems(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.fatal);
}

/** Is this storyboard buildable at all? */
export function isBuildable(storyboard: Storyboard): boolean {
  return fatalProblems(validateStoryboard(storyboard)).length === 0;
}
