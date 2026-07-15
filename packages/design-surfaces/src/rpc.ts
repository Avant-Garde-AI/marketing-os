/**
 * Penpot RPC client — spec 23 §1/§8.
 *
 * The RPC API is officially "internal" (no stability guarantee). Everything
 * this file touches is part of the SAFE SET named in spec 23 §1 and exercised
 * by the canary suite (test/canary.test.ts) — the honest inventory of our
 * exposure. Never add a call here without adding it to the canary suite.
 */

import type { PenpotConfig } from "./types.js";

export class PenpotRpcError extends Error {
  constructor(
    public readonly command: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`penpot rpc ${command} failed: HTTP ${status} ${body.slice(0, 300)}`);
    this.name = "PenpotRpcError";
  }
}

/** Extract the terminal event's data payload from a buffered SSE body. */
function parseSseResult<T>(command: string, body: string): T {
  const events = body
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      return { event, data };
    })
    .filter((e) => e.data.length > 0);

  const errorEvent = events.find((e) => e.event === "error");
  if (errorEvent) throw new PenpotRpcError(command, 200, errorEvent.data);
  const terminal = [...events].reverse().find((e) => e.event === "end") ?? events.at(-1);
  if (!terminal) throw new PenpotRpcError(command, 200, `empty SSE stream: ${body.slice(0, 200)}`);
  return JSON.parse(terminal.data) as T;
}

export class PenpotClient {
  constructor(private readonly config: PenpotConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Token ${this.config.accessToken}` };
  }

  /** JSON-in/JSON-out RPC command call (Accept: application/json spares us transit). */
  async rpc<T = unknown>(command: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/rpc/command/${command}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    if (!res.ok) throw new PenpotRpcError(command, res.status, text);
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      return parseSseResult<T>(command, text);
    }
    return text.length ? (JSON.parse(text) as T) : (undefined as T);
  }

  /** Multipart RPC call — used only by import-binfile (binary .penpot upload). */
  async rpcMultipart<T = unknown>(
    command: string,
    fields: Record<string, string>,
    file: { name: string; data: Uint8Array; contentType?: string },
  ): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set(
      "file",
      new Blob([file.data], { type: file.contentType ?? "application/octet-stream" }),
      file.name,
    );
    const res = await fetch(`${this.baseUrl}/api/rpc/command/${command}`, {
      method: "POST",
      headers: { ...this.authHeaders(), Accept: "application/json" },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new PenpotRpcError(command, res.status, text);
    // Long-running commands (import-binfile) respond as an SSE progress
    // stream; the terminal `end` event carries the JSON result. Errors arrive
    // as an `error` event.
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      return parseSseResult<T>(command, text);
    }
    return text.length ? (JSON.parse(text) as T) : (undefined as T);
  }

  /** Authenticated GET of an instance asset URL (export-binfile downloads). */
  async fetchAsset(uri: string): Promise<Response> {
    const res = await fetch(uri, { headers: this.authHeaders() });
    if (!res.ok) throw new PenpotRpcError("fetch-asset", res.status, await res.text());
    return res;
  }

  // ── Session lane (exporter protocol) ────────────────────────────────────

  private sessionToken: string | undefined;
  private profileId: string | undefined;

  /** Mint (and cache) a service-account session via login-with-password. */
  private async getSession(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;
    const sa = this.config.serviceAccount;
    if (!sa) throw new Error("exportObject requires config.serviceAccount (session-based exporter auth)");
    const res = await fetch(`${this.baseUrl}/api/rpc/command/login-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: sa.email, password: sa.password }),
    });
    if (!res.ok) throw new PenpotRpcError("login-with-password", res.status, await res.text());
    const cookie = res.headers.get("set-cookie") ?? "";
    const match = cookie.match(/auth-token=([^;]+)/);
    if (!match) throw new Error("login-with-password returned no auth-token cookie");
    this.sessionToken = match[1];
    return this.sessionToken as string;
  }

  private async getProfileId(): Promise<string> {
    if (this.profileId) return this.profileId;
    const profile = await this.rpc<{ id: string }>("get-profile");
    this.profileId = profile.id;
    return this.profileId;
  }

  /**
   * Server-side render via the exporter (/api/export, UNDOCUMENTED —
   * penpot/penpot#4978; protocol reverse-engineered and pinned by the canary
   * suite). Transit-encoded export-shapes command, session-cookie auth,
   * result is a pointer to a downloadable asset.
   */
  async exportObject(params: {
    fileId: string;
    pageId: string;
    objectId: string;
    type: "png" | "jpeg" | "webp" | "svg" | "pdf";
    scale?: number;
    suffix?: string;
  }): Promise<Uint8Array> {
    const [session, profileId] = await Promise.all([this.getSession(), this.getProfileId()]);
    // Minimal transit-JSON writer for this one fixed payload shape.
    const payload = JSON.stringify([
      "^ ",
      "~:cmd", "~:export-shapes",
      "~:wait", true,
      "~:profile-id", `~u${profileId}`,
      "~:exports", [[
        "^ ",
        "~:type", `~:${params.type}`,
        "~:suffix", params.suffix ?? "",
        "~:scale", params.scale ?? 1,
        "~:name", "surface",
        "~:is-wasm", false,
        "~:file-id", `~u${params.fileId}`,
        "~:page-id", `~u${params.pageId}`,
        "~:object-id", `~u${params.objectId}`,
      ]],
    ]);
    const res = await fetch(`${this.baseUrl}/api/export`, {
      method: "POST",
      headers: {
        Cookie: `auth-token=${session}`,
        "Content-Type": "application/transit+json",
      },
      body: payload,
    });
    const text = await res.text();
    if (!res.ok) {
      this.sessionToken = undefined; // session may have expired; re-mint next call
      throw new PenpotRpcError("export", res.status, text);
    }
    const pointer = JSON.parse(text) as Record<string, unknown>;
    const uriBox = pointer["~:uri"] as Record<string, string> | string | undefined;
    const uri = typeof uriBox === "string" ? uriBox : uriBox?.["~#uri"];
    if (!uri) throw new PenpotRpcError("export", 200, `no asset uri in export result: ${text.slice(0, 200)}`);
    // The exporter builds asset URIs from ITS view of the public URI, which in
    // containerized deployments is the internal frontend host — rewrite to ours.
    const externalUri = new URL(new URL(uri).pathname + new URL(uri).search, this.baseUrl).toString();
    const asset = await fetch(externalUri, { headers: { Cookie: `auth-token=${session}` } });
    if (!asset.ok) throw new PenpotRpcError("export-download", asset.status, await asset.text());
    return new Uint8Array(await asset.arrayBuffer());
  }
}
