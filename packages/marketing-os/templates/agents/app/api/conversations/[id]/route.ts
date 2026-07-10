import { Memory } from "@mastra/memory";
import { HOSTED, getTenant, runWithTenant } from "@/lib/tenant-context";
import { getTenantStorage } from "@/src/mastra/tenant-storage";
import { storage } from "@/src/mastra/storage";

export const runtime = "nodejs";

const RESOURCE_ID = "storefront";

/** Delete a conversation (the sidebar's "manage" affordance). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = getTenant();
  const { id } = await params;

  return runWithTenant(tenant, async () => {
    const store = HOSTED ? await getTenantStorage() : storage;
    if (!store) return Response.json({ error: "no_storage" }, { status: 404 });

    const memory = new Memory({ storage: store });
    const thread = await memory.getThreadById({ threadId: id });
    if (!thread || thread.resourceId !== RESOURCE_ID) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    await memory.deleteThread(id);
    return Response.json({ ok: true });
  });
}
