/**
 * End-to-end demo — the full spec 23 + DS3 chain on the REAL Arthaus brand:
 *
 *   DESIGN.md (Arthaus reference instance)
 *     → compileDesignTokens (brand-md DTCG compiler, DS3)
 *     → composeSurfaceFile with brand tokens + palette (Lane 1, DS2)
 *     → import-binfile into tenant-arthaus (DS0 provisioning)
 *     → POST /api/export → PNG (DS1 export contract)
 *
 * Run: PENPOT_ACCESS_TOKEN=… PENPOT_SERVICE_EMAIL=… PENPOT_SERVICE_PASSWORD=… \
 *        npx tsx scripts/demo-arthaus.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compileDesignTokens } from "@avant-garde/brand-md";
import { DesignSurfaceAdapter } from "../src/adapter.js";
import { createSurface, exportSurface } from "../src/surface.js";

const here = dirname(fileURLToPath(import.meta.url));
const designMdPath = join(here, "../../brand-md/examples/arthaus/DESIGN.md");
const designMd = readFileSync(designMdPath, "utf8");

// DS3: DESIGN.md → DTCG tokens
const tokens = compileDesignTokens(designMd) as unknown as Record<string, unknown> & {
  global?: Record<string, Record<string, { $value?: string }>>;
};
const colorSet = (tokens.global?.colors ?? tokens.global?.color ?? {}) as Record<string, { $value?: string }>;
const color = (name: string, fallback: string) => {
  const v = colorSet[name]?.$value;
  return typeof v === "string" && v.startsWith("#") ? v : fallback;
};

const paper = color("background", "#F5F2ED");
const ink = color("ink", color("text", "#1F1E1C"));
const accent = color("bronze", color("gold", "#8C6A3F"));

const adapter = new DesignSurfaceAdapter({
  baseUrl: process.env.PENPOT_URL ?? "http://localhost:9001",
  accessToken: process.env.PENPOT_ACCESS_TOKEN!,
  serviceAccount: {
    email: process.env.PENPOT_SERVICE_EMAIL!,
    password: process.env.PENPOT_SERVICE_PASSWORD!,
  },
});

const team = await adapter.provisionTenantTeam("arthaus");
const project = await adapter.ensureProject(team.id, "Design Surfaces");

const { surface } = await createSurface(adapter, {
  tenantId: "arthaus",
  teamId: team.id,
  projectId: project.id,
  kind: "social.post",
  boundTo: { type: "social.post", id: "demo-001" },
  brandLineage: { designMdVersion: 1, tokensVersion: 1 },
  createdBy: "agent",
  spec: {
    fileName: "arthaus-demo-post-001",
    pageName: "Instagram Post",
    board: { name: "IG 1080", width: 1080, height: 1080, background: { fillColor: paper } },
    tokens,
    libraryColors: [
      { name: "Paper", color: paper },
      { name: "Ink", color: ink },
      { name: "Bronze", color: accent },
    ],
    elements: [
      { type: "rect", name: "rule", x: 80, y: 96, width: 72, height: 6, fills: [{ fillColor: accent }] },
      {
        type: "text", name: "eyebrow", x: 80, y: 140, width: 920, height: 40,
        characters: "ARTHAUS — NEW ARRIVALS", fontFamily: "Work Sans", fontSize: "26",
        fontWeight: "600", fills: [{ fillColor: accent }],
      },
      {
        type: "text", name: "headline", x: 80, y: 220, width: 920, height: 340,
        characters: "The gallery wall,\ncurated for\nyour space",
        fontFamily: "Lora", fontSize: "92", fontWeight: "700", lineHeight: "1.15",
        fills: [{ fillColor: ink }],
      },
      { type: "rect", name: "footerband", x: 0, y: 872, width: 1080, height: 208, fills: [{ fillColor: ink }] },
      {
        type: "text", name: "cta", x: 80, y: 940, width: 920, height: 60,
        characters: "Explore gallery-wall bundles → myarthaus.com",
        fontFamily: "Work Sans", fontSize: "34", fills: [{ fillColor: paper }],
      },
    ],
  },
});

console.log("surface:", JSON.stringify({ ...surface, exports: undefined }, null, 2));

const artifact = await exportSurface(adapter, {
  fileId: surface.penpot.fileId,
  pageId: surface.penpot.pageId,
  format: "png",
  scale: 1,
});

const out = join(here, "../arthaus-demo-post.png");
writeFileSync(out, artifact.data);
console.log(`exported ${artifact.data.length} bytes → ${out} (sha256 ${artifact.sha256.slice(0, 12)}…)`);
console.log(`open in Penpot: ${process.env.PENPOT_URL ?? "http://localhost:9001"}/#/workspace?team-id=${team.id}&file-id=${surface.penpot.fileId}&page-id=${surface.penpot.pageId}`);
