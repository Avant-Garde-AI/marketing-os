"use client";

import { Thread } from "@assistant-ui/react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react";
import { useEffect } from "react";

interface MarketingChatProps {
  apiEndpoint?: string;
}

export function MarketingChat({ apiEndpoint = "/api/chat" }: MarketingChatProps) {
  // Create runtime with custom transport
  const runtime = useChatRuntime({
    api: apiEndpoint,
  });

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto">
      <Thread
        runtime={runtime}
        welcome={{
          message:
            "Hi! I'm your Marketing OS agent. Ask me about your store, generate ad copy, or request improvements.",
          suggestions: [
            {
              prompt: "How is my store performing this week?",
              text: "Store performance"
            },
            {
              prompt: "Generate ad copy for my best-selling product",
              text: "Generate ad copy"
            },
            {
              prompt: "Run a store health check",
              text: "Health check"
            },
          ],
        }}
        assistantMessage={{
          components: {
            // Custom tool UI renderers can be added here
            // Example: Text: makeAssistantToolUI(...),
          },
        }}
      />
    </div>
  );
}

// Export helper for creating custom tool UIs
export { makeAssistantToolUI };
