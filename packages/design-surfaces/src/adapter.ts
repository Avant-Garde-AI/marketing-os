/**
 * The Design Surface adapter — the safe RPC set (spec 23 §1) plus tenant
 * provisioning (spec 23 §7). Consuming packs and the platform talk to this,
 * never to Penpot directly.
 */

import { PenpotClient } from "./rpc.js";
import type { PenpotConfig } from "./types.js";

export interface PenpotTeam {
  id: string;
  name: string;
  defaultProjectId?: string;
}

export interface PenpotProject {
  id: string;
  name: string;
  teamId: string;
}

export interface PenpotFileRef {
  id: string;
  name: string;
  projectId: string;
}

interface RawTeam {
  id: string;
  name: string;
  defaultProjectId?: string;
  "default-project-id"?: string;
}

/** import-binfile result → file uuid. Accepts transit strings ("~u<uuid>"),
 * plain uuid strings, or {id} objects — whichever shape the version returns. */
function extractFileId(result: unknown): string | undefined {
  const candidates = Array.isArray(result) ? result : [result];
  for (const c of candidates) {
    if (typeof c === "string") {
      const s = c.startsWith("~u") ? c.slice(2) : c;
      if (/^[0-9a-f-]{36}$/i.test(s)) return s;
    } else if (c && typeof c === "object" && "id" in c && typeof (c as { id: unknown }).id === "string") {
      const s = (c as { id: string }).id;
      return s.startsWith("~u") ? s.slice(2) : s;
    }
  }
  return undefined;
}

export class DesignSurfaceAdapter {
  readonly client: PenpotClient;

  constructor(config: PenpotConfig) {
    this.client = new PenpotClient(config);
  }

  // ── Teams (tenant boundary, spec 23 §3) ────────────────────────────────

  async getTeams(): Promise<PenpotTeam[]> {
    const teams = await this.client.rpc<RawTeam[]>("get-teams");
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      defaultProjectId: t.defaultProjectId ?? t["default-project-id"],
    }));
  }

  async createTeam(name: string): Promise<PenpotTeam> {
    const t = await this.client.rpc<RawTeam>("create-team", { name });
    return { id: t.id, name: t.name, defaultProjectId: t.defaultProjectId ?? t["default-project-id"] };
  }

  /** Idempotent tenant provisioning: team `tenant-{slug}` + member invitations. */
  async provisionTenantTeam(
    slug: string,
    invitations: { email: string; role: "admin" | "editor" | "viewer" }[] = [],
  ): Promise<PenpotTeam> {
    const name = `tenant-${slug}`;
    const existing = (await this.getTeams()).find((t) => t.name === name);
    const team = existing ?? (await this.createTeam(name));
    for (const inv of invitations) {
      await this.client.rpc("create-team-invitations", {
        teamId: team.id,
        emails: [inv.email],
        role: inv.role,
      });
    }
    return team;
  }

  // ── Projects & files ───────────────────────────────────────────────────

  async createProject(teamId: string, name: string): Promise<PenpotProject> {
    const p = await this.client.rpc<{ id: string; name: string; teamId?: string; "team-id"?: string }>(
      "create-project",
      { teamId, name },
    );
    return { id: p.id, name: p.name, teamId: p.teamId ?? p["team-id"] ?? teamId };
  }

  async getProjects(teamId: string): Promise<PenpotProject[]> {
    const ps = await this.client.rpc<{ id: string; name: string }[]>("get-projects", { teamId });
    return ps.map((p) => ({ id: p.id, name: p.name, teamId }));
  }

  /** Idempotent by name within the team. */
  async ensureProject(teamId: string, name: string): Promise<PenpotProject> {
    const existing = (await this.getProjects(teamId)).find((p) => p.name === name);
    return existing ?? (await this.createProject(teamId, name));
  }

  async getProjectFiles(projectId: string): Promise<PenpotFileRef[]> {
    const fs = await this.client.rpc<{ id: string; name: string }[]>("get-project-files", { projectId });
    return fs.map((f) => ({ id: f.id, name: f.name, projectId }));
  }

  async duplicateFile(fileId: string, name?: string): Promise<PenpotFileRef> {
    const f = await this.client.rpc<{ id: string; name: string; projectId?: string; "project-id"?: string }>(
      "duplicate-file",
      name ? { fileId, name } : { fileId },
    );
    return { id: f.id, name: f.name, projectId: f.projectId ?? f["project-id"] ?? "" };
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.client.rpc("delete-file", { id: fileId });
  }

  // ── Binfile lane (spec 23 §4 Lane 1) ───────────────────────────────────

  /** Import a composed .penpot (binfile-v3 zip) into a project. Returns the new file id. */
  async importBinfile(projectId: string, name: string, penpotZip: Uint8Array): Promise<string> {
    // NB: multipart form fields are NOT camelCase-negotiated like JSON bodies —
    // the backend schema wants kebab-case names here. The SSE terminal event's
    // payload is transit-encoded: an array of `~u`-prefixed uuid strings.
    const result = await this.client.rpcMultipart<unknown>(
      "import-binfile",
      { "project-id": projectId, name, version: "3" },
      { name: `${name}.penpot`, data: penpotZip, contentType: "application/zip" },
    );
    const fileId = extractFileId(result);
    if (!fileId) throw new Error(`import-binfile returned no file id: ${JSON.stringify(result).slice(0, 200)}`);
    return fileId;
  }

  /**
   * Snapshot a file as .penpot bytes (eject-portability, spec 23 OQ2).
   * The command streams SSE progress; the terminal event carries an asset URI
   * to download. `includeLibraries` and `embedAssets` are mutually exclusive —
   * we embed assets for a self-contained snapshot.
   */
  async exportBinfile(fileId: string): Promise<Uint8Array> {
    const result = await this.client.rpc<Record<string, string>>("export-binfile", {
      fileId,
      includeLibraries: false,
      embedAssets: true,
    });
    const uri = result["~#uri"] ?? result.uri;
    if (!uri) throw new Error(`export-binfile returned no download uri: ${JSON.stringify(result).slice(0, 200)}`);
    const res = await this.client.fetchAsset(uri);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── File introspection (for export targets) ────────────────────────────

  /**
   * Returns page ids and the root frames (boards) per page, with board NAMES
   * (WS2-R1 — per-board export addresses boards by name, so names must
   * round-trip compose → import → structure). The get-file response's
   * `objects` map carries each shape's `name` alongside type/parent; no extra
   * RPC is needed — this only widens what we read from the same safe-set call.
   * `boardIds` is kept alongside `boards` for existing callers.
   *
   * `revn` is the file's revision number — Penpot bumps it on every edit, so
   * it is the cheap edit-detection signal (spec 23 `edited` fallback): record
   * it at approval time, re-read it before acting on the approval, and any
   * canvas edit in between shows as a bump even when nothing else you read
   * changed.
   */
  async getFileStructure(fileId: string): Promise<{
    revn: number;
    pages: { id: string; name: string; boardIds: string[]; boards: { id: string; name: string }[] }[];
  }> {
    const file = await this.client.rpc<{
      revn?: number;
      data?: {
        pagesIndex?: Record<
          string,
          { id: string; name: string; objects?: Record<string, { id: string; name?: string; type?: string; parentId?: string; "parent-id"?: string; frameId?: string }> }
        >;
        pages?: string[];
      };
    }>("get-file", { id: fileId });
    const idx = file.data?.pagesIndex ?? {};
    const order = file.data?.pages ?? Object.keys(idx);
    const ROOT = "00000000-0000-0000-0000-000000000000";
    const pages = order
      .map((pid) => idx[pid])
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => {
        const objects = p.objects ?? {};
        const boards = Object.values(objects)
          .filter((o) => {
            const parent = (o.parentId ?? o["parent-id"]) as string | undefined;
            return o.type === "frame" && o.id !== ROOT && parent === ROOT;
          })
          .map((o) => ({ id: o.id, name: o.name ?? "" }));
        return { id: p.id, name: p.name, boardIds: boards.map((b) => b.id), boards };
      });
    return { revn: file.revn ?? 0, pages };
  }
}
