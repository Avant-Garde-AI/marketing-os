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
import { readInstagramOutcomes, InstagramReadRejected } from "../observations";

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
    signal: AbortSignal.timeout(20_000),
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

/** Always resolve the live connected account; approval never relies on a deployment label. */
export async function instagramIdentity(tokens: ChannelTokenSource): Promise<{ id: string; username: string }> {
  const token = await tokens.accessToken("instagram");
  const me = await graph<{ user_id?: string | number; id?: string; username?: string }>("/me", {
    params: { fields: "user_id,username", access_token: token },
  });
  const id = me.user_id ?? me.id;
  if (!id || !me.username) throw new Error("Instagram account identity unavailable");
  return { id: String(id), username: me.username };
}

async function verifiedDestination(tokens: ChannelTokenSource, post: SocialPost, token: string): Promise<string> {
  if (!post.channelAccount) return igResolveUserId(token);
  const identity = await instagramIdentity(tokens);
  if (identity.id !== post.channelAccount.id || identity.username !== post.channelAccount.username)
    throw new Error("Instagram destination changed since approval");
  return identity.id;
}

/** Readback only. The recorded destination must match the live connected account. */
export async function instagramPostOutcomes(post: SocialPost, tokens: ChannelTokenSource, now = new Date()) {
  const base = new URL(GRAPH_BASE());
  if (base.protocol !== "https:" || !["graph.instagram.com", "graph.facebook.com"].includes(base.hostname) || base.username || base.password)
    throw new Error("Instagram readback requires an official Graph API host");
  if (post.channel !== "instagram" || !["published", "measured"].includes(post.status) || !post.platform?.id || !/^\d+$/.test(post.platform.id))
    throw new Error("Outcome readback requires a published Instagram post");
  if (!post.channelAccount) throw new Error("Outcome readback requires a recorded Instagram destination");
  const identity = await instagramIdentity(tokens);
  if (identity.id !== post.channelAccount.id || identity.username !== post.channelAccount.username)
    throw new Error("Instagram destination differs from this post");
  const token = await tokens.accessToken("instagram");
  return readInstagramOutcomes(post, async (path, params) => {
    const url = new URL(`${GRAPH_BASE()}${path}`);
    for (const [name, parameter] of Object.entries(params)) url.searchParams.set(name, parameter);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new InstagramReadRejected();
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) throw new InstagramReadRejected();
    return body;
  }, now);
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

async function igWaitForContainer(accessToken: string, containerId: string, attempts = POLL_ATTEMPTS): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
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
    `Instagram container ${containerId} not FINISHED after ${attempts} checks — media processing is incomplete`,
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

/** Create all inert children and the inert carousel parent in approved order. */
export async function igCreateCarouselContainer(
  accessToken: string, userId: string, input: { imageUrls: string[]; caption: string },
): Promise<string> {
  if (input.imageUrls.length < 2 || input.imageUrls.length > 10) throw new Error("Instagram carousel requires 2..10 slides");
  const children: string[] = [];
  for (const imageUrl of input.imageUrls) {
    const child = await graph<{ id: string }>(`/${userId}/media`, {
      method: "POST", params: { image_url: imageUrl, is_carousel_item: "true", access_token: accessToken },
    });
    if (!child.id) throw new Error("Instagram returned no child container id");
    await igWaitForContainer(accessToken, child.id);
    children.push(child.id);
  }
  const parent = await graph<{ id: string }>(`/${userId}/media`, {
    method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), caption: input.caption, access_token: accessToken },
  });
  if (!parent.id) throw new Error("Instagram returned no carousel container id");
  return parent.id;
}

/** Reel container creation is inert; only the gate's adapter calls media_publish. */
export async function igCreateReelContainer(accessToken: string, userId: string, input: { videoUrl: string; caption: string; coverUrl: string }) {
  const result = await graph<{ id: string }>(`/${userId}/media`, { method: "POST", params: {
    media_type: "REELS", video_url: input.videoUrl, caption: input.caption,
    cover_url: input.coverUrl, share_to_feed: "true", access_token: accessToken,
  } });
  if (!result.id) throw new Error("Instagram returned no Reel container id");
  return result.id;
}

export function createInstagramAdapter(tokens: ChannelTokenSource): SocialChannelAdapter {
  return {
    channel: "instagram",
    async publishVideo(post, videoUrl) {
      const receipt = post.renderedVideo;
      if (!receipt || receipt.video.url !== videoUrl || receipt.video.mimeType !== "video/mp4" ||
          receipt.video.width !== 1080 || receipt.video.height !== 1920 ||
          receipt.video.durationMs < 3000 || receipt.video.durationMs > 120000)
        throw new Error("Instagram Reel must match the reviewed 1080 × 1920 MP4");
      if ([...post.copy].length > 2200) throw new Error("Instagram caption exceeds 2,200 characters");
      const token = await tokens.accessToken("instagram");
      const userId = await verifiedDestination(tokens, post, token);
      const container = await igCreateReelContainer(token, userId, { videoUrl, caption: post.copy, coverUrl: receipt.poster.url });
      await igWaitForContainer(token, container, 40);
      const platformId = await igPublishContainer(token, userId, container);
      return { platformId, permalink: await igPermalink(token, platformId) };
    },
    async publishSequence(post, assetUrls) {
      if (!post.renderedSequence || JSON.stringify(assetUrls) !== JSON.stringify(post.renderedSequence.slides.map((slide) => slide.url))) {
        throw new Error("Instagram ordered assets must match the reviewed rendered sequence");
      }
      if (assetUrls.length === 1) return this.publish(post, assetUrls[0]);
      const token = await tokens.accessToken("instagram");
      const userId = await verifiedDestination(tokens, post, token);
      const containerId = await igCreateCarouselContainer(token, userId, { imageUrls: assetUrls, caption: post.copy });
      await igWaitForContainer(token, containerId);
      const platformId = await igPublishContainer(token, userId, containerId);
      return { platformId, permalink: await igPermalink(token, platformId) };
    },
    async publish(post: SocialPost, assetUrl: string): Promise<{ platformId: string; permalink: string }> {
      const token = await tokens.accessToken("instagram");
      const userId = await verifiedDestination(tokens, post, token);
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
