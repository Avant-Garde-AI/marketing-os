/** Agent-facing, fixed-shape requests into the platform's governed generation lane. */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { apiBase, brokerHeaders } from "../../../lib/broker-client";
import { HOSTED, getTenant } from "../../../lib/tenant-context";
import { generationRunHeaders, getGenerationActor } from "../../../lib/social/generation-authority";
import { socialReviewLink, socialSheetLink } from "../../../lib/social/review-links";

const endpoint = "/api/broker/social-generation";
const jobId = z.string().uuid();
export const generationInput = z.object({
  artifactId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  maximumCredits: z.number().finite().positive().max(100),
  declinedPresetId: jobId.optional(),
}).strict();

async function brokerJson(url: string, init: RequestInit, timeoutMs = 45_000): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { ...brokerHeaders(), ...init.headers },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : `Generation broker returned ${res.status}`;
    throw new Error(error);
  }
  return body;
}

export const socialGenerationTools = {
  social_generation_prepare: createTool({
    id: "social_generation_prepare",
    description: "Create a human-reviewable proposal for one stored pilot generation plan. Reads the exact source and creative, requests a bounded credit ceiling, and returns the existing Action approval card. This does not upload source media or spend credits. Provider settings are selected by the platform's fixed pilot profile.",
    inputSchema: generationInput,
    execute: async (input) => brokerJson(`${apiBase()}${endpoint}`, {
      method: "POST", body: JSON.stringify(input),
    }),
  }),
  social_generation_run: createTool({
    id: "social_generation_run",
    description: "Spend up to maximumCredits on one bounded social generation plan, only for an explicit user request in an authenticated console or generation:run MCP session. The platform verifies the bound actor, source, settings and exact quote before submitting once through the existing Action gate. Return its one-page review link and job status; an unknown provider outcome is never automatically retried. This does not publish.",
    inputSchema: generationInput,
    execute: async (input) => {
      const actor = getGenerationActor();
      if (!actor) throw new Error("Authenticated generation request required");
      const shop = getTenant().shop;
      const body = JSON.stringify({ action: "run", ...input, actor });
      const result = await brokerJson(`${apiBase()}${endpoint}`, {
        method: "POST", body,
        headers: { ...brokerHeaders(), ...generationRunHeaders(body, shop) },
      }, 240_000);
      if (!result || typeof result !== "object") return result;
      const postId = "postId" in result && typeof result.postId === "string" ? result.postId : null;
      if (!postId) return result;
      // Pooled runtimes must use the source store's signed review links from the platform.
      if (HOSTED) return result;
      const month = postId.match(/(?:^|[^0-9])(20\d{2}-(?:0[1-9]|1[0-2]))(?:[^0-9]|$)/)?.[1];
      return { ...result,
        reviewUrl: "reviewUrl" in result && typeof result.reviewUrl === "string"
          ? result.reviewUrl : socialReviewLink(shop, postId).url,
        ...(month && !("sheetUrl" in result) ? { sheetUrl: socialSheetLink(shop, month).url } : {}) };
    },
  }),
  social_generation_status: createTool({
    id: "social_generation_status",
    description: "Read the current status and reconciliation outcome of an approved generation job. This read does not submit or resubmit a provider request.",
    inputSchema: z.object({ id: jobId }).strict(),
    execute: async ({ id }) => brokerJson(`${apiBase()}${endpoint}?id=${encodeURIComponent(id)}`, { method: "GET" }),
  }),
};
