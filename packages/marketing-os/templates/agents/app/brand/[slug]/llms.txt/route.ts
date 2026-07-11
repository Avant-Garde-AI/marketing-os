// llms.txt for a store's Brand Portal (spec 22 §Portal) — the well-known-style
// index agents fetch to discover the brand's machine-readable identity files.
import { NextRequest } from "next/server";
import { getPortalData } from "@/src/mastra/brand/portal";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const data = await getPortalData(slug);
  if (!data) return new Response("not found", { status: 404 });
  const body = `# ${data.name}

> ${data.essence ?? `The brand identity of ${data.name}.`}

${data.name} publishes its brand identity as machine-readable documents (brand.md/v0 — versioned, provenance-tagged, owner-approved) for agents that write copy, recommend products, design surfaces, or represent the brand.

## Brand identity

- [brand.md](/brand/${data.slug}/file/brand.md): the brand soul — essence, positioning, personas, voice pillars with usage examples, copy formulas, AI interaction rules, guardrails (v${data.version})
- [DESIGN.md](/brand/${data.slug}/file/DESIGN.md): the visual system — color tokens, typography, spacing, components, do's and don'ts${data.designVersion ? ` (v${data.designVersion})` : ""}

## Reading view

- [Brand overview](/brand/${data.slug}): the human-readable editorial portal
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
