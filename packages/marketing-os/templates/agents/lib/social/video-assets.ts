/** Public content-addressed MP4 bytes. No credentials or provider URLs in this endpoint. */
import { createHash } from "node:crypto";
import type { StoreRepo } from "../skill-kit";
import { validateSocialAssetBase } from "../storyboard/assets";
const MAX_BYTES = 8 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function socialVideoPath(sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid video digest");
  return `social/assets/${sha256}.mp4.b64`;
}
export async function readSocialVideo(repo: StoreRepo, sha256: string): Promise<Buffer | null> {
  const encoded = await repo.readFile(socialVideoPath(sha256));
  if (encoded === null) return null;
  if (!encoded || encoded.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("Video bytes unavailable");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length > MAX_BYTES ||
      bytes.toString("ascii", 4, 8) !== "ftyp" || hash(bytes) !== sha256) throw new Error("Video digest mismatch");
  return bytes;
}
export async function saveSocialVideo(repo: StoreRepo, shop: string, bytes: Buffer, base: string) {
  validateSocialAssetBase(base);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || bytes.length > MAX_BYTES ||
      bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("Invalid video asset");
  const sha256 = hash(bytes);
  const prior = await readSocialVideo(repo, sha256);
  if (!prior) await repo.writeFile(socialVideoPath(sha256), bytes.toString("base64"));
  return { sha256, url: `${base.replace(/\/$/, "")}/api/social/assets/${shop}/${sha256}.mp4` };
}
