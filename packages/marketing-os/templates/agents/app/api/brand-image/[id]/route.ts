// Serves a visual-exploration candidate PNG (spec 22 BS2b) so Slack image
// blocks and the console gallery can render it. Ids are unguessable UUIDs;
// content is non-sensitive (generated moodboards).
import { NextRequest } from "next/server";
import { getCandidatePng } from "@/src/mastra/brand/candidates";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad id", { status: 400 });
  const png = await getCandidatePng(id);
  if (!png) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
