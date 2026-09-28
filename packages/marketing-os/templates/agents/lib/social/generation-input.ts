/** Read-only, byte-verified input for the platform's governed generation Action. */
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { StoreRepo } from "../skill-kit";
import { generationPlanSchema } from "./generation-plan";

export function generationInputPath(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error("Invalid generation plan id");
  return `social/production/jobs/${id}.json`;
}
function digest(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export async function readGenerationInput(repo: StoreRepo, id: string) {
  const raw = await repo.readFile(generationInputPath(id));
  if (!raw || raw.length > 64_000) throw new Error("Generation plan unavailable or too large");
  const plan = generationPlanSchema.parse(JSON.parse(raw));
  if (plan.id !== id || plan.mechanic !== "artwork-loop") throw new Error("Only the artwork-loop pilot is currently executable");
  const source = plan.sources[0]!;
  const encoded = await repo.readFile(source.sourcePath);
  if (!encoded || encoded.length > 6_000_000 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Verified source bytes unavailable");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error("Source encoding is not canonical base64");
  if (digest(bytes) !== source.sourceSha256) throw new Error("Source hash mismatch; prepare a new review");
  const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
  if (meta.format !== "jpeg" || meta.width !== source.width || meta.height !== source.height ||
      (meta.orientation ?? 1) !== 1 || source.width < 1024 || source.height < 1024)
    throw new Error("Source format or dimensions disagree with its reviewed receipt");
  const fitted = await sharp(bytes, { limitInputPixels: 20_000_000 }).resize(plan.transform.width, plan.transform.height, {
    fit: "contain", background: plan.transform.background,
  }).jpeg({ quality: 95 }).toBuffer();
  const prepared = { sha256: digest(fitted), width: plan.transform.width, height: plan.transform.height, mimeType: "image/jpeg" as const };
  const inputHash = digest(JSON.stringify({ plan, prepared }));
  return { plan, prepared, inputHash, base64: fitted.toString("base64") };
}
