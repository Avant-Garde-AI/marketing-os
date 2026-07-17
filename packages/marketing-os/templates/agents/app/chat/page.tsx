"use client";

import { ChatPanel } from "@/components/chat/chat-panel";

/**
 * Chat — the console's primary work surface. The whole surface lives in the
 * shared ChatPanel (AI SDK v6 UIMessage stream + registered generative-UI
 * renderers, spec 13 addendum); this page mounts it full-screen with the
 * conversation sidebar. The Design Studio (/studio) mounts the same panel
 * beside the embedded canvas.
 */

export default function ChatPage() {
  return (
    <div className="h-screen">
      <ChatPanel />
    </div>
  );
}
