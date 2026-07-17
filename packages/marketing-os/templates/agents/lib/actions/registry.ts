/**
 * The agents-side Action registry (spec 20 A1, WS3-R1).
 *
 * Registrations are FACTORIES, not instances: the pooled runtime serves many
 * tenants, so an action's bindings (store repo, Klaviyo client, brand
 * context) must resolve per request. `getAction(kind)` constructs inside the
 * caller's runWithTenant() scope.
 *
 * What registers here: the email pack's four Actions (WS3-R5), future
 * social publish Actions (SM2). App-executed actions (offer.activate,
 * storefront.publish) live in marketing-os-app's registry — one contract,
 * two executors, ONE gate.
 */

import { z } from "zod";
import type { RuntimeAction } from "./types";
import { hashPreview } from "./hash";

type ActionFactory = () => RuntimeAction<never>;

const registry = new Map<string, ActionFactory>();

export function registerAction(kind: string, factory: () => RuntimeAction<any>): void {
  if (registry.has(kind)) throw new Error(`action kind "${kind}" already registered`);
  registry.set(kind, factory as unknown as ActionFactory);
}

export function getAction(kind: string): RuntimeAction<never> | null {
  const factory = registry.get(kind);
  return factory ? factory() : null;
}

export function knownActionKinds(): string[] {
  return [...registry.keys()].sort();
}

// ---------------------------------------------------------------------------
// demo.echo — a no-op action for validating the gate end to end
// (ACTIONS_DEMO=1 only; never registered in a normal deployment).
// ---------------------------------------------------------------------------

if (process.env.ACTIONS_DEMO === "1") {
  const demoParams = z.object({ message: z.string().min(1).max(200) });
  registerAction("demo.echo", () => ({
    kind: "demo.echo",
    title: "Demo echo (no-op)",
    risk: "low",
    scopes: [],
    paramsSchema: demoParams,
    async preview(p) {
      return {
        summary: `Echo "${p.message}" — a no-op used to validate the approval gate`,
        rows: [{ label: "Message", value: p.message }],
        previewHash: hashPreview({ kind: "demo.echo", message: p.message }),
      };
    },
    async execute(p) {
      return { ok: true, summary: `Echoed: ${p.message}`, detail: { message: p.message } };
    },
  }));
}
