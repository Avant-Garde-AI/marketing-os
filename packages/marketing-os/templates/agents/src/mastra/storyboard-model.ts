import { Agent, type AgentConfig } from "@mastra/core/agent";
import type { StoryModel } from "../../lib/storyboard/critics";

/** Each stage gets a fresh, tool-less agent: no shared memory, credentials or write tools. */
export function createMastraStoryModel(model: AgentConfig["model"]): StoryModel {
  return {
    async generate(request) {
      const agent = new Agent({
        id: `storyboard-${request.task}`,
        name: request.task,
        instructions: request.instruction,
        model,
      });
      const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
        { type: "text", text: JSON.stringify(request.data) },
      ];
      for (const image of request.images ?? []) {
        content.push({ type: "text", text: `Candidate: ${image.label}` });
        content.push({ type: "image", image: image.url });
      }
      const response = await agent.generate([{ role: "user", content }], {
        structuredOutput: { schema: request.schema },
        maxSteps: 1,
      });
      return request.schema.parse(response.object);
    },
  };
}
