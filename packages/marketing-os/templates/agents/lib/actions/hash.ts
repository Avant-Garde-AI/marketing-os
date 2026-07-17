import { createHash } from "node:crypto";

/** Deterministic preview hash — the nonce's binding material (spec 20 §2).
 * JSON.stringify is stable enough here because callers pass literal object
 * shapes they control; anything order-sensitive (e.g. assembled HTML) should
 * be hashed as bytes by the caller and passed as a string field. */
export function hashPreview(material: unknown): string {
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
