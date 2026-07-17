/**
 * Threads channel adapter (spec 24 §4 D3 — second launch channel, SM2).
 *
 * Same container → publish shape as Instagram, on graph.threads.net
 * (threads_content_publish scope):
 *
 *   1. POST /{threads-user-id}/threads         {media_type: IMAGE, image_url, text} → container
 *   2. GET  /{container-id}?fields=status      poll until FINISHED
 *   3. POST /{threads-user-id}/threads_publish {creation_id}                        → media id
 *   4. GET  /{media-id}?fields=permalink                                             (best-effort)
 *
 * Credentials ride the same ChannelTokenSource seam as Instagram (v1:
 * SOCIAL_THREADS_ACCESS_TOKEN / THREADS_ACCESS_TOKEN env bootstrap — a
 * Threads user token is NOT yet provisioned for Arthaus, so this adapter is
 * built and lightly tested; it errors clearly until the token lands. The
 * spec 12 Vault/provider_connections source replaces the env read later).
 */

import type { SocialChannelAdapter, SocialPost } from "../types";
import type { ChannelTokenSource } from "./index";

const GRAPH_BASE = () =>
  (process.env.SOCIAL_THREADS_GRAPH_BASE ?? "https://graph.threads.net/v1.0").replace(/\/$/, "");

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
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
      `Threads Graph ${method} ${path} failed (${res.status})${e ? `: ${e.message} [type=${e.type} code=${e.code}]` : ""}`,
    );
  }
  return json;
}

async function threadsResolveUserId(accessToken: string): Promise<string> {
  const pinned = process.env.SOCIAL_THREADS_USER_ID ?? process.env.THREADS_USER_ID;
  if (pinned) return pinned;
  const me = await graph<{ id?: string }>("/me", {
    params: { fields: "id,username", access_token: accessToken },
  });
  if (!me.id) throw new Error("Threads /me returned no id — check the token's scopes");
  return me.id;
}

const POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 3000;

async function threadsWaitForContainer(accessToken: string, containerId: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const r = await graph<{ status?: string; error_message?: string }>(`/${containerId}`, {
      params: { fields: "status,error_message", access_token: accessToken },
    });
    if (r.status === "FINISHED") return;
    if (r.status === "ERROR" || r.status === "EXPIRED") {
      throw new Error(
        `Threads container ${containerId} ${r.status}${r.error_message ? `: ${r.error_message}` : ""}`,
      );
    }
    await new Promise((res) => setTimeout(res, POLL_DELAY_MS));
  }
  throw new Error(`Threads container ${containerId} not FINISHED after ${POLL_ATTEMPTS} checks`);
}

export function createThreadsAdapter(tokens: ChannelTokenSource): SocialChannelAdapter {
  return {
    channel: "threads",
    async publish(post: SocialPost, assetUrl: string): Promise<{ platformId: string; permalink: string }> {
      const token = await tokens.accessToken("threads");
      const userId = await threadsResolveUserId(token);
      const container = await graph<{ id: string }>(`/${userId}/threads`, {
        method: "POST",
        params: {
          media_type: "IMAGE",
          image_url: assetUrl,
          text: post.copy,
          access_token: token,
        },
      });
      await threadsWaitForContainer(token, container.id);
      const published = await graph<{ id: string }>(`/${userId}/threads_publish`, {
        method: "POST",
        params: { creation_id: container.id, access_token: token },
      });
      let permalink = "";
      try {
        const media = await graph<{ permalink?: string }>(`/${published.id}`, {
          params: { fields: "permalink", access_token: token },
        });
        permalink = media.permalink ?? "";
      } catch (e) {
        console.error("[social/threads] permalink lookup failed:", e instanceof Error ? e.message : e);
      }
      return { platformId: published.id, permalink };
    },
  };
}
