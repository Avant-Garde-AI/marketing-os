import { Agent, type AgentConfig } from "@mastra/core/agent";
import type { StoryModel } from "../../lib/storyboard/critics";
import { jsonSchemaFromZod } from "../../lib/mcp/zod-schema";

/** Each stage gets a fresh, tool-less agent: no shared memory, credentials or write tools. */
export function createMastraStoryModel(model: AgentConfig["model"]): StoryModel {
  return {
    async generate(request) {
      const agent = new Agent({
        id: `storyboard-${request.task}`,
        name: request.task,
        instructions: `${request.instruction}
Return complete JSON matching the supplied output schema. Include every required
property even when an array is empty. Optional properties may be omitted; never
return a partial object. Keep prose concise enough to finish the complete output.
${request.task === "plan-storyboards" ? "Return exactly three complete storyboards. Each needs continuity. Every provided transition must include change, why and patternRefs (an empty array when unsupported)." : ""}
Output shape (the structured-output schema is authoritative):
${JSON.stringify(jsonSchemaFromZod(request.schema))}`,
        model,
        maxRetries: 0,
      });
      const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
        { type: "text", text: JSON.stringify(request.data) },
      ];
      for (const image of request.images ?? []) {
        content.push({ type: "text", text: `Candidate: ${image.label}` });
        content.push({ type: "image", image: image.url });
      }
      const response = await agent.generate([{ role: "user", content }], {
        structuredOutput: { schema: request.schema, errorStrategy: "strict" },
        maxSteps: 1,
        maxProcessorRetries: 0,
        // Gemini 3 defaults to high thinking and charges thoughts against this
        // same output cap. Bound its thinking so the complete JSON can fit.
        ...(typeof model === "string" && /^google\/gemini-3(?:\.|-)/.test(model)
          ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } }
          : {}),
        modelSettings: { maxOutputTokens: request.task === "plan-storyboards" ? 24000 : 8000 },
      });
      if (response.finishReason === "length") {
        throw new Error(`Storyboard ${request.task} exhausted its bounded output budget; no partial output accepted`);
      }
      return request.schema.parse(response.object);
    },
  };
}
