import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGenerationInput } from "../templates/agents/lib/social/generation-input";
import { generationInputPath } from "../templates/agents/lib/social/generation-input";
import { socialGenerationReviewLink, verifyLink } from "../templates/agents/lib/social/review-links";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const id = "passion-flower-loop-pilot";
const shop = "arthaus-website.myshopify.com";

async function fixture() {
  const bytes = await sharp({ create: { width: 1220, height: 1920, channels: 3, background: "#765a9a" } }).jpeg().toBuffer();
  const sourceHash = sha(bytes);
  const sourcePath = `social/production/sources/${sourceHash}.jpeg.b64`;
  const plan = {
    id, postId: "post-1", slotId: "2026-10-instagram-01", recipeId: "artwork-loop",
    mechanic: "artwork-loop", sources: [{ sourceRef: "ams:artworks/17866/flat?maxEdge=1920",
      verificationRef: "social/production/SOURCE-VERIFICATION-2026-09-28.md#passion-flower",
      sourceSha256: sourceHash, sourcePath, width: 1220, height: 1920 }],
    prompt: "Sway the existing leaves", caption: "Passion Flower, imagined in motion.",
    transform: { kind: "contain-pad", width: 1080, height: 1920, background: "#f4f3ee" },
  };
  const files: Record<string, string> = { [generationInputPath(id)]: JSON.stringify(plan), [sourcePath]: bytes.toString("base64") };
  const repo = { readFile: async (path: string) => files[path] ?? null } as Parameters<typeof readGenerationInput>[0];
  return { bytes, plan, files, repo, sourcePath };
}

describe("generation input", () => {
  it("verifies source and returns a deterministic complete-artwork fit", async () => {
    const { repo, bytes } = await fixture();
    const first = await readGenerationInput(repo, id);
    const again = await readGenerationInput(repo, id);
    expect(first.inputHash).toBe(again.inputHash);
    expect(first.plan.sources[0]?.sourceSha256).toBe(sha(bytes));
    expect(first.prepared).toMatchObject({ width: 1080, height: 1920, mimeType: "image/jpeg" });
    expect(first.prepared.sha256).toBe(sha(Buffer.from(first.base64, "base64")));
    const meta = await sharp(Buffer.from(first.base64, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  });

  it("rejects changed bytes, false dimensions, malformed encoding and plan drift", async () => {
    const { repo, files, plan, sourcePath } = await fixture();
    const original = files[sourcePath]!;
    files[sourcePath] = Buffer.from("different").toString("base64");
    await expect(readGenerationInput(repo, id)).rejects.toThrow(/Source hash mismatch/);
    files[sourcePath] = `${original}\n`;
    await expect(readGenerationInput(repo, id)).rejects.toThrow(/Verified source bytes unavailable/);
    files[sourcePath] = original;
    files[generationInputPath(id)] = JSON.stringify({ ...plan, sources: [{ ...plan.sources[0], width: 1300 }] });
    await expect(readGenerationInput(repo, id)).rejects.toThrow(/dimensions disagree/);
    files[generationInputPath(id)] = JSON.stringify({ ...plan, id: "other" });
    await expect(readGenerationInput(repo, id)).rejects.toThrow(/Only the artwork-loop pilot/);
  });

  it("changes the bound input hash when copy or fitting treatment changes", async () => {
    const { repo, files, plan } = await fixture();
    const original = (await readGenerationInput(repo, id)).inputHash;
    files[generationInputPath(id)] = JSON.stringify({ ...plan, caption: "New caption" });
    expect((await readGenerationInput(repo, id)).inputHash).not.toBe(original);
    files[generationInputPath(id)] = JSON.stringify({ ...plan, transform: { ...plan.transform, background: "#ffffff" } });
    expect((await readGenerationInput(repo, id)).inputHash).not.toBe(original);
  });
});

describe("generation review link", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("signs the hosted repo as well as shop, plan and input hash", () => {
    vi.stubEnv("ACTIONS_GATE_SECRET", "test-review-secret");
    const link = new URL(socialGenerationReviewLink(shop, id, "a".repeat(64), "Arthaus-Inc/marketplace").url);
    const token = link.searchParams.get("t"); const day = link.searchParams.get("e");
    expect(verifyLink("review", shop, `generation:${id}:${"a".repeat(64)}:Arthaus-Inc/marketplace`, token, day)).toBe("ok");
    expect(verifyLink("review", shop, `generation:${id}:${"b".repeat(64)}:Arthaus-Inc/marketplace`, token, day)).toBe("invalid");
    expect(verifyLink("review", shop, `generation:${id}:${"a".repeat(64)}:other/store`, token, day)).toBe("invalid");
    expect(verifyLink("review", "other.myshopify.com", `generation:${id}:${"a".repeat(64)}:Arthaus-Inc/marketplace`, token, day)).toBe("invalid");
    expect(link.searchParams.get("repo")).toBe("Arthaus-Inc/marketplace");
  });
});
