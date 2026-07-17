/**
 * The spec 20 Action contract, runtime-side (WS3-R1). Mirrors
 * @avant-garde/skill-kit's types (vendored-local until the packages publish,
 * H8.3 — same pattern as lib/social).
 *
 * Invariants (spec 20 §2):
 *  1. preview() never mutates — the approval card renders ITS output.
 *  2. execute() runs only after an approval bound to the instance's nonce —
 *     which lives in the platform gate (marketing-os-app), never here. This
 *     runtime exposes execute ONLY via /api/actions/execute behind the
 *     gate's shared secret; no Mastra tool wraps it.
 *  3. Every execute is audited by the gate.
 */

import type { z } from "zod";

export type ActionRisk = "low" | "medium" | "high";

export interface ActionRow {
  label: string;
  value: string;
}

export interface ActionPreview {
  summary: string;
  rows?: ActionRow[];
  previewUrl?: string;
  warnings?: string[];
  /** Deterministic hash over everything that affects the mutation — the
   * approval nonce binds to this; drift re-arms the card. */
  previewHash: string;
}

export interface ActionResult {
  ok: boolean;
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * An action this runtime can preview + execute for the current tenant.
 * Instances are constructed per request inside runWithTenant() — bindings
 * (repo, Klaviyo client, …) resolve from the tenant context, so definitions
 * stay tenant-free.
 */
export interface RuntimeAction<P = unknown> {
  kind: string;
  title: string;
  risk: ActionRisk;
  scopes: string[];
  paramsSchema: z.ZodType<P>;
  preview: (p: P) => Promise<ActionPreview>;
  execute: (p: P) => Promise<ActionResult>;
}
