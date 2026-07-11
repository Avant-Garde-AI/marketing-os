// Raw brand identity files for agents (spec 22 §Portal): brand.md (public
// subset — inward sections/keys stripped by the publication filter) and
// DESIGN.md (full — visual systems are meant to travel).
import { NextRequest } from "next/server";
import { getPublicBrandMd, getPublicDesignMd } from "@/src/mastra/brand/portal";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await ctx.params;
  let body: string | null = null;
  if (kind === "brand.md") body = await getPublicBrandMd(slug);
  else if (kind === "DESIGN.md") body = await getPublicDesignMd(slug);
  else return new Response("unknown file (brand.md | DESIGN.md)", { status: 404 });
  if (!body) return new Response("not found", { status: 404 });
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
