/** Agent-facing, fixed-shape requests into the platform's governed generation lane. */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { apiBase, brokerHeaders } from "../../../lib/broker-client";

const endpoint = "/api/broker/social-generation";
const jobId = z.string().uuid();

async function brokerJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: brokerHeaders(), cache: "no-store" });
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
    inputSchema: z.object({
      artifactId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
      maximumCredits: z.number().finite().positive().max(100),
      declinedPresetId: jobId.optional(),
    }).strict(),
    execute: async (input) => brokerJson(`${apiBase()}${endpoint}`, {
      method: "POST", body: JSON.stringify(input),
    }),
  }),
  social_generation_status: createTool({
    id: "social_generation_status",
    description: "Read the current status and reconciliation outcome of an approved generation job. This read does not submit or resubmit a provider request.",
    inputSchema: z.object({ id: jobId }).strict(),
    execute: async ({ id }) => brokerJson(`${apiBase()}${endpoint}?id=${encodeURIComponent(id)}`, { method: "GET" }),
  }),
};
