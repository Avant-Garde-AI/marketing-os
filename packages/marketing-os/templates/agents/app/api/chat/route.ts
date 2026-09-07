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
/**
 * 300s, not 120.
 *
 * An authoring turn is not one model call. Planning a month, reading the
 * genome, asking an external art graph, fetching artwork bytes and composing a
 * board are five round trips, and the external-MCP tool budget alone is 45s
 * (TOOL_TIMEOUT_MS) because the Picasso graph does traversal plus synthesis.
 * Two of those and a 120s turn is over before the write.
 *
 * The symptom is not an error anyone can act on: the tool call is reported as
 * "that lookup didn't complete", the model carries on without the answer, and
 * it concludes the server is disconnected — which is how an available art graph
 * came to be described as unavailable, twice.
 */
export const maxDuration = 300;

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
