/**
 * Catalogue reads from the store's own artwork system (Arthaus AMS), for
 * campaigns whose story is the catalogue itself: the Sunday new-artists drop
 * and the Friday traction send (email/strategy.md, "The Sunday programme").
 *
 * Read-only, and only offered when the deployment sets AMS_INTERNAL_URL (the
 * service base, e.g. https://…/artwork-ms) and AMS_INTERNAL_API_KEY: a store
 * without them simply does not list these tools. The key never leaves
 * this server; tools return catalogue facts, never credentials.
 */

const AMS_BASE = (process.env.AMS_INTERNAL_URL ?? "").replace(/\/$/, "");
/** Public, cacheable artwork preview — the same image the PDP is built from. */
const PREVIEW_BASE = (process.env.AMS_PREVIEW_URL ?? AMS_BASE).replace(/\/$/, "");
const TIMEOUT_MS = 60_000;
/** Previews are ~500 px JPEGs; anything far larger is not a preview. */
const MAX_IMAGE_BYTES = 3_000_000;

export function catalogAvailable(): boolean {
  return Boolean(AMS_BASE && process.env.AMS_INTERNAL_API_KEY);
}

async function ams(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.AMS_INTERNAL_API_KEY;
  if (!key || !AMS_BASE) throw new Error("this store has no catalogue connection (AMS_INTERNAL_URL / AMS_INTERNAL_API_KEY are not set)");
  const res = await fetch(`${AMS_BASE}/api/internal${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: string } | null;
  if (!res.ok || !body) throw new Error(`catalogue ${path} failed (${res.status}): ${body?.error ?? "no body"}`);
  return body.data ?? body;
}

export const previewUrl = (artworkId: number | string) => `${PREVIEW_BASE}/api/internal/artworks/${artworkId}/preview`;

interface NewArtistWork { artworkId: number; name: string; handle: string; url: string }
interface NewArtist { works?: NewArtistWork[]; [k: string]: unknown }

/** Artists whose first work went live in the last `days`, with what an email needs to introduce them. */
export async function newArtists(input: { days?: number; minLive?: number }) {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 7), 1), 90);
  const minLive = Math.min(Math.max(Math.trunc(input.minLive ?? 3), 1), 100);
  const artists = (await ams(`/catalog/new-artists?days=${days}&minLive=${minLive}`)) as NewArtist[];
  return {
    days,
    minLive,
    artists: artists.map((a) => ({
      ...a,
      // imagery_resolve takes this as artworkUrl; artwork_image_read shows it.
      works: (a.works ?? []).map((w) => ({ ...w, previewUrl: previewUrl(w.artworkId) })),
    })),
  };
}

/** Which artist each product handle belongs to, and when that artist went live. */
export async function handleArtists(input: { handles?: string[] }) {
  const handles = [...new Set((input.handles ?? []).map(String).filter(Boolean))].slice(0, 2000);
  if (!handles.length) return { artists: [] };
  return { artists: await ams("/catalog/handle-artists", { method: "POST", body: JSON.stringify({ handles }) }) };
}

/** The artwork itself, so a writer can describe what is actually there. */
export async function artworkImage(input: { artworkId?: number | string }): Promise<{ mimeType: string; data: string }> {
  const id = String(input.artworkId ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("artworkId must be the numeric AMS artwork id (works[].artworkId)");
  const res = await fetch(previewUrl(id), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`no preview for artwork ${id} (${res.status})`);
  const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!mimeType.startsWith("image/")) throw new Error(`artwork ${id} preview is not an image (${mimeType})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`artwork ${id} preview is ${bytes.byteLength} bytes — too large to show`);
  return { mimeType, data: Buffer.from(bytes).toString("base64") };
}
