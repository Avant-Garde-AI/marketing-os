import { Memory } from "@mastra/memory";
import type { MastraDBMessage } from "@mastra/core/agent";
import { HOSTED, getTenant, runWithTenant } from "@/lib/tenant-context";
import { getTenantStorage } from "@/src/mastra/tenant-storage";
import { storage } from "@/src/mastra/storage";

export const runtime = "nodejs";

const RESOURCE_ID = "storefront";

function messageText(msg: MastraDBMessage): string {
  const parts = msg.content?.parts ?? [];
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Replay a past conversation's messages so the console can hydrate it when selected. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = getTenant();
  const { id } = await params;

  return runWithTenant(tenant, async () => {
    const store = HOSTED ? await getTenantStorage() : storage;
    if (!store) return Response.json({ messages: [] });

    const memory = new Memory({ storage: store });
    const thread = await memory.getThreadById({ threadId: id });
    if (!thread || thread.resourceId !== RESOURCE_ID) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const { messages } = await memory.recall({
      threadId: id,
      resourceId: RESOURCE_ID,
      perPage: false,
    });

    return Response.json({
      messages: messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: messageText(m) }))
        .filter((m) => m.content.length > 0),
    });
  });
}
