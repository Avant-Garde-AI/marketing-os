/**
 * Transports for the server core: newline-delimited stdio (local MCP clients such
 * as Claude Code) and stateless Streamable HTTP (one JSON response per POST, which
 * is what serverless hosts need). Both are thin: all behavior lives in `handle`.
 */
import { createInterface } from "node:readline";
import type { CallContext, DesignConversionServer } from "./server.js";

type Message = Parameters<DesignConversionServer["handle"]>[0];

async function dispatch(server: DesignConversionServer, body: unknown, ctx: CallContext) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => server.handle(m as Message, ctx)))).filter(Boolean);
    return out.length ? out : null;
  }
  return server.handle(body as Message, ctx);
}

/** Serve over stdin/stdout. Logs must go to stderr: stdout is the protocol. */
export function serveStdio(server: DesignConversionServer, ctx: CallContext = { principal: { kind: "local", id: "stdio" } }): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (x: unknown) => process.stdout.write(JSON.stringify(x) + "\n");
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const res = await dispatch(server, msg, ctx).catch((e) => ({ jsonrpc: "2.0", id: (msg as any)?.id ?? null, error: { code: -32603, message: (e as Error).message } }));
    if (res) write(res);
  });
  return new Promise((resolve) => rl.on("close", () => resolve()));
}

export interface HttpOptions {
  /**
   * Resolve the caller from the request (bearer token, header). Return null to
   * reject with 401. Omit for an unauthenticated local server.
   */
  authenticate?: (req: Request) => Promise<CallContext | null>;
  /** Extra response headers (CORS is added by default). */
  headers?: Record<string, string>;
  /** Max request body in bytes (default 12 MB: two base64 screenshots). */
  maxBodyBytes?: number;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
};

/** A Web-standard handler: `(Request) => Response`. Mount it in any runtime that speaks fetch. */
export function createHttpHandler(server: DesignConversionServer, opts: HttpOptions = {}) {
  const headers = { ...CORS, ...opts.headers };
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json", ...extra } });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    // Stateless: no server-initiated stream, so GET (SSE) is not offered.
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });
    const ctx = opts.authenticate ? await opts.authenticate(req) : {};
    if (!ctx) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <token>" } }, 401, { "www-authenticate": "Bearer" });
    const text = await req.text();
    if (text.length > (opts.maxBodyBytes ?? 12 * 1024 * 1024)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    const res = await dispatch(server, body, ctx);
    return res ? json(res) : new Response(null, { status: 202, headers });
  };
}
