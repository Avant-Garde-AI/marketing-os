import { mastra } from "@/src/mastra";
import { chatRoute } from "@mastra/ai-sdk";

export const POST = chatRoute({
  mastra,
  agent: "marketing-agent",
});
