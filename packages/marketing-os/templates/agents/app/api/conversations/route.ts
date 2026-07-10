import { Memory } from "@mastra/memory";
import { HOSTED, getTenant, runWithTenant } from "@/lib/tenant-context";
import { getTenantStorage } from "@/src/mastra/tenant-storage";
import { storage } from "@/src/mastra/storage";

export const runtime = "nodejs";

const RESOURCE_ID = "storefront";

/** List this store's conversations, newest first, for the chat sidebar. */
export async function GET() {
  const tenant = getTenant();

  return runWithTenant(tenant, async () => {
    const store = HOSTED ? await getTenantStorage() : storage;
    if (!store) return Response.json({ conversations: [] });

    const memory = new Memory({ storage: store });
    const { threads } = await memory.listThreads({
      filter: { resourceId: RESOURCE_ID },
      orderBy: { field: "updatedAt", direction: "DESC" },
    });

    return Response.json({
      conversations: threads.map((t) => ({
        id: t.id,
        title: t.title ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  });
}
