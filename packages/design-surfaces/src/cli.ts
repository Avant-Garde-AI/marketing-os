#!/usr/bin/env node
/**
 * design-surfaces CLI — DS0 operational entrypoints.
 *
 *   design-surfaces bootstrap --url http://localhost:9001 --email svc@… --password …
 *   design-surfaces provision-tenant <slug> [--invite email:role …]
 *   design-surfaces demo <slug>          # compose → import → export a sample surface
 *
 * Config via env: PENPOT_URL, PENPOT_ACCESS_TOKEN.
 */

import { writeFileSync } from "node:fs";
import { DesignSurfaceAdapter } from "./adapter.js";
import { bootstrapServiceAccount } from "./provision.js";
import { createSurface, exportSurface } from "./surface.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function envConfig() {
  const baseUrl = process.env.PENPOT_URL ?? "http://localhost:9001";
  const accessToken = process.env.PENPOT_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("PENPOT_ACCESS_TOKEN is required (run `design-surfaces bootstrap` first)");
    process.exit(1);
  }
  const serviceAccount =
    process.env.PENPOT_SERVICE_EMAIL && process.env.PENPOT_SERVICE_PASSWORD
      ? { email: process.env.PENPOT_SERVICE_EMAIL, password: process.env.PENPOT_SERVICE_PASSWORD }
      : undefined;
  return { baseUrl, accessToken, serviceAccount };
}

const command = process.argv[2];

async function main() {
  switch (command) {
    case "bootstrap": {
      const result = await bootstrapServiceAccount({
        baseUrl: arg("url") ?? process.env.PENPOT_URL ?? "http://localhost:9001",
        email: arg("email") ?? "svc@marketing-os.local",
        password: arg("password") ?? (() => { throw new Error("--password required"); })(),
      });
      console.log(JSON.stringify(result, null, 2));
      console.error("\nStore accessToken as PENPOT_ACCESS_TOKEN (it is shown exactly once).");
      break;
    }
    case "provision-tenant": {
      const slug = process.argv[3];
      if (!slug) throw new Error("usage: design-surfaces provision-tenant <slug>");
      const invites = process.argv
        .filter((_, i) => process.argv[i - 1] === "--invite")
        .flatMap((s) => {
          const [email, role] = s.split(":");
          if (!email) return [];
          return [{ email, role: (role ?? "editor") as "admin" | "editor" | "viewer" }];
        });
      const adapter = new DesignSurfaceAdapter(envConfig());
      const team = await adapter.provisionTenantTeam(slug, invites);
      const project = await adapter.ensureProject(team.id, "Design Surfaces");
      console.log(JSON.stringify({ team, project }, null, 2));
      break;
    }
    case "demo": {
      const slug = process.argv[3] ?? "demo";
      const adapter = new DesignSurfaceAdapter(envConfig());
      const team = await adapter.provisionTenantTeam(slug);
      const project = await adapter.ensureProject(team.id, "Design Surfaces");
      const { surface } = await createSurface(adapter, {
        tenantId: slug,
        teamId: team.id,
        projectId: project.id,
        kind: "demo.sample",
        boundTo: { type: "demo", id: "cli" },
        spec: {
          fileName: `demo-surface`,
          board: { name: "Post 1080", width: 1080, height: 1080, background: { fillColor: "#F5F0E8" } },
          elements: [
            { type: "rect", x: 0, y: 780, width: 1080, height: 300, fills: [{ fillColor: "#1A1A2E" }] },
            {
              type: "text", x: 80, y: 120, width: 920, height: 240,
              characters: "Museum-grade art,\npersonally yours",
              fontFamily: "Source Serif Pro", fontSize: "72", fontWeight: "700",
              fills: [{ fillColor: "#1A1A2E" }],
            },
            {
              type: "text", x: 80, y: 850, width: 920, height: 80,
              characters: "New gallery-wall bundles — curated for your space",
              fontFamily: "Source Sans Pro", fontSize: "36",
              fills: [{ fillColor: "#F5F0E8" }],
            },
          ],
        },
      });
      const artifact = await exportSurface(adapter, {
        fileId: surface.penpot.fileId,
        pageId: surface.penpot.pageId,
      });
      const out = `demo-surface-${slug}.png`;
      writeFileSync(out, artifact.data);
      console.log(JSON.stringify({ surface: { ...surface, exports: [{ ...artifact, data: `<${artifact.data.length} bytes → ${out}>` }] } }, null, 2));
      break;
    }
    default:
      console.error("usage: design-surfaces <bootstrap|provision-tenant|demo> …");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
