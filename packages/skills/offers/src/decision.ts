/**
 * decideOfferExperiment — the promote/reallocate/continue/wash read
 * (spec 14 O3).
 *
 * SIDE-EFFECT FREE: applying a decision goes through the merchant's approval
 * (a console click or a Slack card), or the nightly reallocation cron for
 * surfaces already on the `thompson` policy. This function only recommends.
 *
 * Thresholds were duplicated identically across the template and the pooled
 * runtime — the actual risk being consolidated here is that "identically"
 * drifting silently the next time one of them got tuned.
 */

import type { OfferArmDecisionInput } from "./types";

export const MIN_IMPRESSIONS = 200;
export const MIN_CAPTURES = 10;
export const PROMOTE_AT = 0.95;
export const FUTILITY_AT = 0.7;
export const FUTILITY_N = 2000;

export type OfferDecisionKind = "promote" | "reallocate" | "continue" | "wash";

export interface OfferDecision {
  decision: OfferDecisionKind;
  rationale: string;
  winner: string | null;
  actionable: boolean;
  proposedMode: "promote" | "thompson" | null;
}

/** Thrown/returned by callers as `{unavailable: true, reason}` — this
 * function signals "no data" by returning null rather than throwing, so
 * both bindings' existing unavailable-shape conventions stay intact. */
export function decideOfferExperiment(arms: OfferArmDecisionInput[]): OfferDecision | null {
  const shown = arms.filter((a) => a.arm !== "control");
  if (shown.length === 0) return null;

  const totalCaptures = shown.reduce((t, a) => t + a.captures, 0);
  const minN = Math.min(...shown.map((a) => a.impressions));
  const top = [...shown].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0]!;
  const samplesMet = minN >= MIN_IMPRESSIONS && totalCaptures >= MIN_CAPTURES;

  if (samplesMet && (top.pBest ?? 0) >= PROMOTE_AT) {
    return {
      decision: "promote",
      proposedMode: "promote",
      winner: top.arm,
      actionable: true,
      rationale:
        `"${top.arm}" is best with ${Math.round((top.pBest ?? 0) * 100)}% probability at ` +
        `${top.captureRate !== null ? (top.captureRate * 100).toFixed(1) : "—"}% capture. Promote it.`,
    };
  }

  if (minN >= FUTILITY_N && (top.pBest ?? 0) < FUTILITY_AT) {
    return {
      decision: "wash",
      proposedMode: null,
      winner: null,
      actionable: false,
      rationale:
        `After ${minN.toLocaleString()}+ impressions per arm no variant separates ` +
        `(top P(best) ${Math.round((top.pBest ?? 0) * 100)}%). Keep the simpler variant and test a bolder difference next.`,
    };
  }

  if (samplesMet && shown.length >= 2) {
    return {
      decision: "reallocate",
      proposedMode: "thompson",
      winner: null,
      actionable: true,
      rationale:
        `Signal is forming ("${top.arm}" at ${Math.round((top.pBest ?? 0) * 100)}% P(best)) but not ` +
        `conclusive. Shift new traffic toward the leader (Thompson) to learn faster without losing the control.`,
    };
  }

  return {
    decision: "continue",
    proposedMode: null,
    winner: null,
    actionable: false,
    rationale:
      `Not enough data yet (${minN.toLocaleString()} impressions on the smallest arm, ` +
      `${totalCaptures} captures total; needs ${MIN_IMPRESSIONS}/arm and ${MIN_CAPTURES} captures). Let it run.`,
  };
}
