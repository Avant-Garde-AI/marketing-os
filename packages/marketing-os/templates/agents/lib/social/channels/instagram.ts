/**
 * Instagram channel adapter (spec 24 §4 D3 — direct platform APIs, SM2).
 *
 * The IG Content Publishing flow is two-step and the split is the safety
 * property: creating a media CONTAINER is inert (nothing appears anywhere),
 * only media_publish makes it live. The adapter runs container → status poll
 * → publish; scripts/verify-ig-publish.ts exercises exactly the container
 * path and stops before the irreversible step.
 *
 *   1. POST /{ig-user-id}/media          {image_url, caption} → {id: containerId}
 *   2. GET  /{container-id}?fields=status_code   poll until FINISHED
 *   3. POST /{ig-user-id}/media_publish  {creation_id}        → {id: mediaId}
 *   4. GET  /{media-id}?fields=permalink                       (best-effort)
 *
 * Graph host: the verified Arthaus token is an Instagram-Login long-lived
 * token — it works on graph.instagram.com (v23.0; /me returns user_id there).
 * Facebook-Login page-scoped tokens would use graph.facebook.com instead;
 * override via SOCIAL_IG_GRAPH_BASE when a tenant connects that way.
 *
 * Image format: IG requires a publicly fetchable JPEG for image_url — the
 * caller (register-actions assetUrl) requests format=jpeg from the
 * design-surface export route.
 *
 * Credentials — the per-tenant seam: the adapter takes a ChannelTokenSource
 * (./index.ts). v1 binds the env source (ARTHAUS_IG_ACCESS_TOKEN — the
 * single-tenant bootstrap); a Vault/provider_connections source (spec 12
 * broker pattern) drops in without touching this file. The user id resolves
 * from SOCIAL_IG_USER_ID / ARTHAUS_IG_USER_ID or live via /me.
 */

import type { SocialChannelAdapter, SocialPost } from "../types";
import type { ChannelTokenSource } from "./index";

const GRAPH_BASE = () =>
  (process.env.SOCIAL_IG_GRAPH_BASE ?? "https://graph.instagram.com/v23.0").replace(/\/$/, "");

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

async function graph<T>(
  path: string,
  init: { method?: "GET" | "POST"; params: Record<string, string> },
): Promise<T> {
  const url = new URL(`${GRAPH_BASE()}${path}`);
  const method = init.method ?? "GET";
  let body: URLSearchParams | undefined;
  if (method === "GET") {
    for (const [k, v] of Object.entries(init.params)) url.searchParams.set(k, v);
  } else {
    body = new URLSearchParams(init.params);
  }
  const res = await fetch(url, {
    method,
    ...(body ? { body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || json.error) {
    const e = json.error;
    throw new Error(
      `Instagram Graph ${method} ${path} failed (${res.status})${e ? `: ${e.message} [type=${e.type} code=${e.code}${e.error_subcode ? ` sub=${e.error_subcode}` : ""}]` : ""}`,
    );
  }
  return json;
}

/** Resolve the IG user id: env pin, else live /me lookup (Instagram-Login tokens). */
export async function igResolveUserId(accessToken: string): Promise<string> {
  const pinned = process.env.SOCIAL_IG_USER_ID ?? process.env.ARTHAUS_IG_USER_ID;
  if (pinned) return pinned;
  const me = await graph<{ user_id?: string | number; id?: string }>("/me", {
    params: { fields: "user_id,username", access_token: accessToken },
  });
  const id = me.user_id ?? me.id;
  if (!id) throw new Error("Instagram /me returned no user_id — check the token's scopes");
  return String(id);
}

/** Step 1 — create the (inert) media container. Nothing publishes here. */
export async function igCreateContainer(
  accessToken: string,
  userId: string,
  input: { imageUrl: string; caption: string },
): Promise<string> {
  const r = await graph<{ id: string }>(`/${userId}/media`, {
    method: "POST",
    params: { image_url: input.imageUrl, caption: input.caption, access_token: accessToken },
  });
  return r.id;
}

/** Step 2 — container status (FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED). */
export async function igContainerStatus(
  accessToken: string,
  containerId: string,
): Promise<{ statusCode: string; status?: string }> {
  const r = await graph<{ status_code?: string; status?: string }>(`/${containerId}`, {
    params: { fields: "status_code,status", access_token: accessToken },
  });
  return { statusCode: r.status_code ?? "UNKNOWN", ...(r.status ? { status: r.status } : {}) };
}

const POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 3000;

async function igWaitForContainer(accessToken: string, containerId: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const { statusCode, status } = await igContainerStatus(accessToken, containerId);
    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(`Instagram container ${containerId} ${statusCode}${status ? `: ${status}` : ""}`);
    }
    // IN_PROGRESS (or UNKNOWN — some image containers finish synchronously and
    // report no status_code field; retry resolves either way).
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
  }
  throw new Error(
    `Instagram container ${containerId} not FINISHED after ${POLL_ATTEMPTS} checks — image may be slow to fetch or invalid (must be a public JPEG)`,
  );
}

/** Step 3 — the irreversible one. */
async function igPublishContainer(
  accessToken: string,
  userId: string,
  containerId: string,
): Promise<string> {
  const r = await graph<{ id: string }>(`/${userId}/media_publish`, {
    method: "POST",
    params: { creation_id: containerId, access_token: accessToken },
  });
  return r.id;
}

async function igPermalink(accessToken: string, mediaId: string): Promise<string> {
  try {
    const r = await graph<{ permalink?: string }>(`/${mediaId}`, {
      params: { fields: "permalink", access_token: accessToken },
    });
    return r.permalink ?? "";
  } catch (e) {
    // Best-effort: the publish landed; a permalink lookup failure is not a
    // publish failure. The id is recorded either way.
    console.error("[social/instagram] permalink lookup failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

export function createInstagramAdapter(tokens: ChannelTokenSource): SocialChannelAdapter {
  return {
    channel: "instagram",
    async publish(post: SocialPost, assetUrl: string): Promise<{ platformId: string; permalink: string }> {
      const token = await tokens.accessToken("instagram");
      const userId = await igResolveUserId(token);
      const containerId = await igCreateContainer(token, userId, {
        imageUrl: assetUrl,
        caption: post.copy,
      });
      await igWaitForContainer(token, containerId);
      const mediaId = await igPublishContainer(token, userId, containerId);
      const permalink = await igPermalink(token, mediaId);
      return { platformId: mediaId, permalink };
    },
  };
}
