import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra } from "@/src/mastra";

/**
 * Chat endpoint — AI SDK v6 UIMessage stream (spec 13 addendum).
 *
 * Replaces the old raw text pipe: the UIMessage stream carries typed message
 * parts (text, tool calls, tool results), which is what lets the console
 * render registered generative-UI components — charts, proposal cards — from
 * tool outputs instead of throwing that structure away.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  const params = await req.json();

  // Thread↔memory continuity (spec 15 §3). A `threadId` in the body — sent by
  // the Slack integration front door for a client-deployed tenant (spec 15 §5)
  // — is mapped to the agent's memory scope. `params` extends
  // AgentExecutionOptions, so `memory` rides through to the agent. The
  // interactive console omits threadId and is unaffected; an explicit
  // params.memory is never clobbered.
  if (params?.threadId && !params.memory) {
    params.memory = { thread: String(params.threadId), resource: "storefront" };
  }

  const stream = await handleChatStream({
    mastra,
    agentId: "marketing-agent",
    version: "v6",
    params,
  });
  return createUIMessageStreamResponse({ stream });
}
