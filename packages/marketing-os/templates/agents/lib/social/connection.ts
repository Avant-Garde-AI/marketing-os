/** Reconnect an existing Instagram destination through the platform's credential broker. */
import type { SocialRepo } from "./types";
import { parsePost } from "./artifacts";
export interface InstagramDestination { id: string; username: string }
export async function existingInstagramDestination(repo: SocialRepo): Promise<InstagramDestination> {
  const paths = (await repo.list("social/posts/")).filter(path => path.endsWith("/post.md"));
  if (paths.length > 200) throw new Error("Use a configured Instagram account for this larger post archive");
  const accounts = new Map<string, InstagramDestination>();
  for (let i = 0; i < paths.length; i += 5) {
    await Promise.all(paths.slice(i, i + 5).map(async path => {
      const raw = await repo.readFile(path); if (!raw) return;
      const post = parsePost(raw);
      if (post.channel === "instagram" && post.channelAccount) accounts.set(post.channelAccount.id, post.channelAccount);
    }));
  }
  if (accounts.size === 1) return [...accounts.values()][0];
  if (accounts.size > 1) throw new Error("Multiple Instagram destinations are bound; reconnect from the platform operator flow");
  const id = process.env.SOCIAL_IG_USER_ID ?? process.env.ARTHAUS_IG_USER_ID;
  const username = process.env.SOCIAL_IG_USERNAME;
  if (id && /^\d+$/.test(id) && username) return { id, username };
  throw new Error("No existing Instagram destination is bound; configure the account before reconnecting");
}
/** No token in a URL, error response, log or returned object. */
export async function verifyInstagramReplacement(token: string, expected: InstagramDestination): Promise<InstagramDestination> {
  if (!/^[A-Za-z0-9._~-]{30,8192}$/.test(token)) throw new Error("Enter a valid Instagram Login publishing token");
  const configured = process.env.SOCIAL_IG_GRAPH_BASE ?? "https://graph.instagram.com/v23.0";
  const base = new URL(configured);
  if (base.protocol !== "https:" || base.hostname !== "graph.instagram.com" || base.username || base.password || base.port || base.search || base.hash || !/^\/v\d+\.\d+\/?$/.test(base.pathname))
    throw new Error("Reconnect requires the configured Instagram Login API");
  const read = async (path: string, query = "") => {
    const response = await fetch(`${base.toString().replace(/\/$/, "")}/${path}${query}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error) throw new Error("Instagram rejected this token. Generate a fresh token for the existing account with publishing permission.");
    return body;
  };
  const profile = await read("me", "?fields=user_id,username");
  const id = String(profile?.user_id ?? profile?.id ?? "");
  const username = typeof profile?.username === "string" ? profile.username : "";
  if (id !== expected.id || username.toLowerCase() !== expected.username.toLowerCase())
    throw new Error(`This token does not belong to the existing @${expected.username} destination. Nothing was saved.`);
  const permissions = await read("me/permissions");
  if (!Array.isArray(permissions?.data) || !permissions.data.some((p: any) => p.permission === "instagram_business_content_publish" && p.status === "granted"))
    throw new Error("The token is missing Instagram business content publishing permission. Nothing was saved.");
  return { id, username };
}
