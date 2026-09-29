/** Request-bound authority for explicit generation. Never populated from tool input. */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type GenerationActor = {
  surface: "console" | "mcp_connector";
  subject: string;
};

const actors = new AsyncLocalStorage<GenerationActor | null>();

export function runWithGenerationActor<T>(actor: GenerationActor | null, fn: () => Promise<T>): Promise<T> {
  return actors.run(actor, fn);
}

export function getGenerationActor(): GenerationActor | null {
  return actors.getStore() ?? null;
}

/** Sign the exact body bytes sent to the platform, bound to shop and a fresh timestamp. */
export function generationRunHeaders(body: string, shop: string, now = Date.now()): Record<string, string> {
  const secret = process.env.ACTIONS_GATE_SECRET;
  if (!secret || !shop || !getGenerationActor()) throw new Error("Authenticated generation request required");
  const ts = String(now);
  const sig = crypto.createHmac("sha256", secret)
    .update(`social-generation-run:v1\n${shop}\n${ts}\n${body}`)
    .digest("hex");
  return { "x-mos-run-shop": shop, "x-mos-run-ts": ts, "x-mos-run-sig": sig };
}
