import { createHash } from "node:crypto";
import type { StoreRepo } from "../skill-kit";

export function imageDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function socialAssetPath(digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid image digest");
  return `social/assets/${digest}.jpeg.b64`;
}

/** Content addressed bytes are tenant scoped. The route verifies the full hash on every read. */
export async function saveSocialImage(repo: StoreRepo, shop: string, bytes: Uint8Array, base: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Invalid tenant shop");
  const publicBase = new URL(base);
  if (publicBase.protocol !== "https:" || publicBase.username || publicBase.password || publicBase.search || publicBase.hash)
    throw new Error("Immutable social assets require a public HTTPS deployment URL");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Social asset must be a JPEG");
  const sha256 = imageDigest(bytes);
  const path = socialAssetPath(sha256);
  const prior = await repo.readFile(path);
  if (prior && imageDigest(Buffer.from(prior, "base64")) !== sha256) throw new Error("Stored image digest mismatch");
  if (!prior) await repo.writeFile(path, Buffer.from(bytes).toString("base64"));
  return { sha256, url: `${base.replace(/\/$/, "")}/api/social/assets/${shop}/${sha256}.jpeg` };
}

export async function readSocialImage(repo: StoreRepo, digest: string): Promise<Uint8Array | null> {
  const raw = await repo.readFile(socialAssetPath(digest));
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  if (imageDigest(bytes) !== digest || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Stored image digest mismatch");
  return bytes;
}
