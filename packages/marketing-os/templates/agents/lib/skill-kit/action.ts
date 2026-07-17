/**
 * The spec 20 Action contract — the platform's core write primitive.
 *
 * "Reads compose freely. Writes narrow through one gate." Nothing mutates a
 * store except through an Action: a declared, previewable, role-gated,
 * audited unit of change (spec 20 §2). Packs DECLARE actions (via factories
 * that close over their bindings, same pattern as tools); the hosted runtime
 * owns the gate — propose → scope check → risk tier → preview() → approval
 * card → approver check → execute() → audit (spec 20 §4).
 *
 * Invariants (spec 20 §2, enforced by the runtime gate, testable per action):
 *  1. `preview()` never mutates — the card renders ITS output, so the
 *     approver sees the real diff, not the agent's prose.
 *  2. `execute()` runs only after an approval event bound to that action
 *     instance (nonce), never from a tool call.
 *  3. Every execute writes an audit record
 *     `{action, params, previewHash, approver, at, result}`.
 *  4. An Action declares its scopes; missing scope ⇒ never offered, never
 *     rendered.
 */

import type { z } from "zod";

/** Risk tier — drives who may approve (spec 20 §4). `high` additionally
 * requires a confirmation dialog and supports an optional second approver
 * (first exercised by klaviyo.schedule_campaign, 05 H2). */
export type ActionRisk = "low" | "medium" | "high";

/** A detail row on the approval card (spec 17 branded renderer). */
export interface ActionRow {
  label: string;
  value: string;
}

/** What `preview()` returns — the material the approval card renders. */
export interface ActionPreview {
  /** One line: what exactly will change. */
  summary: string;
  rows?: ActionRow[];
  /** Optional URL the card links for a rendered preview (e.g. assembled email HTML). */
  previewUrl?: string;
  /** Non-blocking cautions surfaced on the card. */
  warnings?: string[];
  /**
   * Content hash binding the approval nonce to exactly what was previewed.
   * Deterministic over everything that affects the mutation (assembled HTML
   * bytes, audience refs, send time, …). The gate stores it in the audit row
   * and re-checks it before execute — any drift re-arms the card.
   */
  previewHash: string;
}

/** What `execute()` returns — recorded verbatim in the audit row. */
export interface ActionResult {
  ok: boolean;
  summary: string;
  /** Ids/refs the mutation created or touched (idempotent resume reads these). */
  detail?: Record<string, unknown>;
}

export interface Action<P> {
  /** e.g. "klaviyo.schedule_campaign" | "offer.activate" | "email.approve_plan" */
  kind: string;
  /** Human title for the card. */
  title: string;
  /** Validates + types `propose_action` params before anything else runs. */
  paramsSchema: z.ZodType<P>;
  /** One line: what will change (renders before preview() completes). */
  summary: (p: P) => string;
  /** Card detail rows derivable from params alone (preview() may add more). */
  rows?: (p: P) => ActionRow[];
  /** e.g. ["klaviyo:write_campaigns"] — checked before the Action is offered. */
  scopes: string[];
  risk: ActionRisk;
  /** MUST be read-only. */
  preview: (p: P) => Promise<ActionPreview>;
  /** The mutation. Idempotent where possible (record per-step ids in
   * ActionResult.detail so a retry resumes rather than duplicates). */
  execute: (p: P) => Promise<ActionResult>;
  /** Reversible where possible (spec 20 OQ2). */
  undo?: (r: ActionResult) => Promise<void>;
}

/** Loosely-typed view for registries that hold heterogeneous actions. */
export type AnyAction = Action<unknown>;
