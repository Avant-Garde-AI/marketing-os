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

async function sceneFixture() {
  const sceneId = "three-artwork-room";
  const colors = ["#d00000", "#00d000", "#0000d0"];
  const assets = await Promise.all(colors.map(async (color, index) => {
    const bytes = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: color } }).jpeg().toBuffer();
    const sourceSha256 = sha(bytes);
    const sourcePath = `social/production/sources/${sourceSha256}.jpeg.b64`;
    return { bytes, source: { sourceRef: `ams:artworks/${index + 1}/flat`, verificationRef: `catalog://artwork/${index + 1}`,
      sourceSha256, sourcePath, width: 1200, height: 1500 } };
  }));
  const plan = {
    id: sceneId, postId: "post-scene", slotId: "2026-10-instagram-02", recipeId: "collection-scene",
    mechanic: "collection-scene", scene: "real-home", sources: assets.map(({ source }) => source),
    prompt: "An empty gallery wall with three clear artwork positions. No artwork in the generated environment.",
    caption: "Three artworks in a quiet room.",
    transform: { kind: "contain-pad", width: 1080, height: 1350, background: "#f4f3ee" },
  };
  const files: Record<string, string> = { [generationInputPath(sceneId)]: JSON.stringify(plan) };
  assets.forEach(({ bytes, source }) => { files[source.sourcePath] = bytes.toString("base64"); });
  const repo = { readFile: async (path: string) => files[path] ?? null } as Parameters<typeof readGenerationInput>[0];
  return { sceneId, assets, plan, files, repo };
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
    const priorFit = await sharp(bytes, { limitInputPixels: 20_000_000 }).resize(1080, 1920, {
      fit: "contain", background: "#f4f3ee",
    }).jpeg({ quality: 95 }).toBuffer();
    expect(first.base64).toBe(priorFit.toString("base64"));
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
    await expect(readGenerationInput(repo, id)).rejects.toThrow(/plan id does not match/);
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

describe("three-source collection scene input", () => {
  it("prepares one complete artwork on a 4:5 canvas only with explicit single-artwork composition", async () => {
    const { sceneId, repo, files, plan, assets } = await sceneFixture();
    const single = { ...plan, sceneComposition: "single-artwork", sources: [plan.sources[0]!] };
    files[generationInputPath(sceneId)] = JSON.stringify(single);
    const result = await readGenerationInput(repo, sceneId);
    const expected = await sharp(assets[0]!.bytes, { limitInputPixels: 20_000_000 })
      .resize(1080, 1350, { fit: "contain", background: "#f4f3ee" }).jpeg({ quality: 95 }).toBuffer();
    expect(result.base64).toBe(expected.toString("base64"));
    expect(result.prepared).toEqual({ sha256: sha(expected), width: 1080, height: 1350, mimeType: "image/jpeg" });
    files[generationInputPath(sceneId)] = JSON.stringify({ ...single, sources: plan.sources });
    await expect(readGenerationInput(repo, sceneId)).rejects.toThrow(/one source/);
  });

  it("verifies all sources and produces an ordered, fully contained review sheet", async () => {
    const { sceneId, repo, plan, assets } = await sceneFixture();
    const input = await readGenerationInput(repo, sceneId);
    expect(input.plan).toEqual(plan);
    expect(input.prepared).toEqual({ sha256: sha(Buffer.from(input.base64, "base64")), width: 1080,
      height: 1350, mimeType: "image/jpeg" });
    expect(input.inputHash).toBe(sha(Buffer.from(JSON.stringify({ plan: input.plan, prepared: input.prepared }))));
    const priorPanels = await Promise.all(assets.map(({ bytes }) => sharp(bytes, { limitInputPixels: 20_000_000 })
      .resize(336, 1350, { fit: "contain", background: "#f4f3ee" }).toBuffer()));
    const priorSheet = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#f4f3ee" } })
      .composite(priorPanels.map((panel, index) => ({ input: panel, left: 18 + index * 354, top: 0 })))
      .jpeg({ quality: 95 }).toBuffer();
    expect(input.base64).toBe(priorSheet.toString("base64"));
    const image = sharp(Buffer.from(input.base64, "base64"));
    const meta = await image.metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const red = pixel(186, 675), green = pixel(540, 675), blue = pixel(894, 675);
    expect(red[0]! > 180 && red[1]! < 80 && red[2]! < 80).toBe(true);
    expect(green[1]! > 180 && green[0]! < 80 && green[2]! < 80).toBe(true);
    expect(blue[2]! > 180 && blue[0]! < 80 && blue[1]! < 80).toBe(true);
    expect(pixel(186, 20).every((value) => value > 220)).toBe(true);
  });

  it("rejects changed or missing bytes and false dimensions for any source", async () => {
    const { sceneId, repo, files, plan, assets } = await sceneFixture();
    for (const { source } of assets) {
      const original = files[source.sourcePath]!;
      files[source.sourcePath] = Buffer.from("different").toString("base64");
      await expect(readGenerationInput(repo, sceneId)).rejects.toThrow(/Source hash mismatch/);
      files[source.sourcePath] = original + "\n";
      await expect(readGenerationInput(repo, sceneId)).rejects.toThrow(/Verified source bytes unavailable/);
      files[source.sourcePath] = original;
      files[generationInputPath(sceneId)] = JSON.stringify({ ...plan, sources: plan.sources.map((item) =>
        item.sourcePath === source.sourcePath ? { ...item, width: 1300 } : item) });
      await expect(readGenerationInput(repo, sceneId)).rejects.toThrow(/dimensions disagree/);
      files[generationInputPath(sceneId)] = JSON.stringify(plan);
    }
  });

  it("binds source order and copy to the input hash", async () => {
    const { sceneId, repo, files, plan } = await sceneFixture();
    const first = await readGenerationInput(repo, sceneId);
    files[generationInputPath(sceneId)] = JSON.stringify({ ...plan, sources: [...plan.sources].reverse() });
    const reordered = await readGenerationInput(repo, sceneId);
    expect(reordered.inputHash).not.toBe(first.inputHash);
    expect(reordered.prepared.sha256).not.toBe(first.prepared.sha256);
    files[generationInputPath(sceneId)] = JSON.stringify({ ...plan, caption: "New scene caption" });
    expect((await readGenerationInput(repo, sceneId)).inputHash).not.toBe(first.inputHash);
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
