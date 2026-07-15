/**
 * CANARY CONFORMANCE SUITE — spec 23 §8.
 *
 * This suite is the honest inventory of everything we depend on in Penpot's
 * officially-internal API surface. It runs against a LIVE instance and MUST
 * pass on any candidate version before an upgrade is adopted (D4: we are
 * self-supported — this suite is the only early-warning system).
 *
 * Run: PENPOT_CANARY=1 PENPOT_URL=… PENPOT_ACCESS_TOKEN=… pnpm test:canary
 *
 * Named dependencies covered:
 *   1. access-token auth on /api/rpc/command/*
 *   2. JSON content negotiation (Accept: application/json)
 *   3. get-teams / create-team / create-team-invitations (tenant provisioning)
 *   4. create-project / get-projects / get-project-files
 *   5. import-binfile multipart (Lane 1 landing)
 *   6. get-file → data.pagesIndex structure (export targeting)
 *   7. POST /api/export (UNDOCUMENTED — penpot/penpot#4978)
 *   8. export-binfile (snapshots / eject)
 *   9. OpenAPI doc presence (api/main/doc/openapi.json) — drift detection aid
 */

import { describe, expect, it } from "vitest";
import { DesignSurfaceAdapter } from "../src/adapter.js";
import { createSurface, exportSurface } from "../src/surface.js";

const enabled = !!process.env.PENPOT_CANARY && !!process.env.PENPOT_ACCESS_TOKEN;
const d = describe.runIf(enabled);

const config = {
  baseUrl: process.env.PENPOT_URL ?? "http://localhost:9001",
  accessToken: process.env.PENPOT_ACCESS_TOKEN ?? "",
  serviceAccount:
    process.env.PENPOT_SERVICE_EMAIL && process.env.PENPOT_SERVICE_PASSWORD
      ? { email: process.env.PENPOT_SERVICE_EMAIL, password: process.env.PENPOT_SERVICE_PASSWORD }
      : undefined,
};

d("penpot canary (live)", () => {
  const adapter = new DesignSurfaceAdapter(config);
  const slug = `canary-${process.env.CANARY_RUN_ID ?? "local"}`;

  it("1+2+3: authenticates, speaks JSON, provisions a tenant team idempotently", async () => {
    const team1 = await adapter.provisionTenantTeam(slug);
    const team2 = await adapter.provisionTenantTeam(slug);
    expect(team1.id).toBe(team2.id);
    expect(team1.name).toBe(`tenant-${slug}`);
  });

  it("4: ensures a project idempotently", async () => {
    const team = await adapter.provisionTenantTeam(slug);
    const p1 = await adapter.ensureProject(team.id, "Design Surfaces");
    const p2 = await adapter.ensureProject(team.id, "Design Surfaces");
    expect(p1.id).toBe(p2.id);
  });

  it("5+6+7: composes → imports → introspects → exports a PNG (the Lane 1 chain)", async () => {
    const team = await adapter.provisionTenantTeam(slug);
    const project = await adapter.ensureProject(team.id, "Design Surfaces");
    const { surface } = await createSurface(adapter, {
      tenantId: slug,
      teamId: team.id,
      projectId: project.id,
      kind: "canary.check",
      boundTo: { type: "canary", id: "suite" },
      spec: {
        fileName: `canary-${Math.floor(Math.random() * 1e9)}`,
        board: { name: "board", width: 400, height: 400, background: { fillColor: "#F5F0E8" } },
        elements: [
          { type: "rect", x: 20, y: 20, width: 360, height: 100, fills: [{ fillColor: "#1A1A2E" }] },
          { type: "text", x: 30, y: 40, width: 340, height: 60, characters: "canary", fontSize: "32", fills: [{ fillColor: "#F5F0E8" }] },
        ],
        tokens: { global: { color: { canary: { $value: "#1A1A2E", $type: "color" } } } },
      },
    });
    expect(surface.penpot.fileId).toBeTruthy();
    expect(surface.penpot.pageId).toBeTruthy();

    const artifact = await exportSurface(adapter, {
      fileId: surface.penpot.fileId,
      pageId: surface.penpot.pageId,
      format: "png",
    });
    expect(artifact.data.length).toBeGreaterThan(500);
    // PNG magic
    expect(artifact.data[0]).toBe(0x89);
    expect(artifact.data[1]).toBe(0x50);
  });

  it("8: snapshots a file via export-binfile", async () => {
    const team = await adapter.provisionTenantTeam(slug);
    const project = await adapter.ensureProject(team.id, "Design Surfaces");
    const files = await adapter.getProjectFiles(project.id);
    expect(files.length).toBeGreaterThan(0);
    const snap = await adapter.exportBinfile(files[0].id);
    expect(snap.length).toBeGreaterThan(500);
    expect(snap[0]).toBe(0x50); // PK zip magic
  });

  it("9: serves the OpenAPI document (drift-detection aid)", async () => {
    const res = await fetch(`${config.baseUrl}/api/main/doc/openapi.json`);
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});
    for (const cmd of ["import-binfile", "export-binfile", "create-team", "create-project", "get-file"]) {
      expect(paths.some((p) => p.endsWith(cmd)), `openapi lists ${cmd}`).toBe(true);
    }
  });
});

describe("canary gate", () => {
  it(enabled ? "running live" : "skipped (set PENPOT_CANARY=1 + PENPOT_ACCESS_TOKEN)", () => {
    expect(true).toBe(true);
  });
});
