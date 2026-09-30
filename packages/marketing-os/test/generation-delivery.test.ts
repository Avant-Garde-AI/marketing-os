import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readGenerationInput } from "../templates/agents/lib/social/generation-input";
import { generationDeliveryPath, generationDeliverySchema, loadGenerationDelivery, renderGenerationScene } from "../templates/agents/lib/social/generation-delivery";
import { socialGenerationReviewLink, socialReviewLink } from "../templates/agents/lib/social/review-links";
import { GET } from "../templates/agents/app/api/social/generation/render/[id]/route";

const routeRepo = vi.hoisted(() => ({ readFile: vi.fn() }));
// Generated runtimes provide their own DB/repo adapter. The public-route test
// must prove auth blocks it, without importing an actual database driver.
vi.mock("../templates/agents/lib/social/repo", () => ({ socialRepo: routeRepo }));

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const shop = "arthaus-website.myshopify.com";
const artifactId = "collection-room-1";
const postId = "2026-10-instagram-02";

async function fixture() {
  const assets = await Promise.all(["#b32727", "#27b327", "#2727b3"].map(async (color, i) => {
    const bytes = await sharp({ create: { width: 1100, height: 1400, channels: 3, background: color } }).jpeg().toBuffer();
    const sourceSha256 = sha(bytes);
    return { bytes, source: { sourceRef: `artwork-${i + 1}`, verificationRef: `receipt-${i + 1}`,
      sourceSha256, sourcePath: `social/production/sources/${sourceSha256}.jpeg.b64`, width: 1100, height: 1400 } };
  }));
  const plan = { id: artifactId, postId, slotId: "slot-2", recipeId: "collection-scene", mechanic: "collection-scene",
    scene: "real-home", sources: assets.map(item => item.source), prompt: "Empty gallery room, no artwork", caption: "Original caption",
    transform: { kind: "contain-pad", width: 1080, height: 1350, background: "#f4f3ee" } };
  const files: Record<string, string> = { [`social/production/jobs/${artifactId}.json`]: JSON.stringify(plan) };
  assets.forEach(({ bytes, source }) => { files[source.sourcePath] = bytes.toString("base64"); });
  const repo = { readFile: async (path: string) => files[path] ?? null } as Parameters<typeof readGenerationInput>[0];
  const input = await readGenerationInput(repo, artifactId);
  const background = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#f4f3ee" } }).jpeg().toBuffer();
  const quads = [0.06, 0.38, 0.70].map((x) => [[x, 0.30], [x + 0.24, 0.30], [x + 0.24, 0.65], [x, 0.65]]);
  const receipt = { schemaVersion: 1, artifactId, postId, inputHash: input.inputHash, caption: "Amended caption",
    scene: { backgroundSha256: sha(background), placements: assets.map((item, i) => ({
      sourceRef: item.source.sourceRef, quad: quads[i], mat: "#ffffff",
    })) } };
  files[generationDeliveryPath(artifactId)] = JSON.stringify(receipt);
  const job = { artifactId, postId, inputHash: input.inputHash, mechanic: "collection-scene" as const, state: "succeeded",
    imageUrl: "https://cdn.higgsfield.ai/scene.jpg", sourcePreviewUrl: socialGenerationReviewLink(shop, artifactId, input.inputHash).url };
  return { repo, files, assets, input, background, receipt, job };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("generation delivery receipt", () => {
  it("binds one placement to an explicitly single-artwork scene plan", async () => {
    const { repo, files, receipt, job, background } = await fixture();
    const planPath = `social/production/jobs/${artifactId}.json`;
    const plan = JSON.parse(files[planPath]!);
    files[planPath] = JSON.stringify({ ...plan, sceneComposition: "single-artwork", sources: [plan.sources[0]] });
    const input = await readGenerationInput(repo, artifactId);
    const singleReceipt = { ...receipt, inputHash: input.inputHash,
      scene: { ...receipt.scene, placements: [receipt.scene.placements[0]] } };
    files[generationDeliveryPath(artifactId)] = JSON.stringify(singleReceipt);
    const boundJob = { ...job, inputHash: input.inputHash };
    expect((await loadGenerationDelivery(repo, boundJob))?.scene?.placements).toHaveLength(1);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(background)));
    const rendered = await renderGenerationScene(repo, boundJob, generationDeliverySchema.parse(singleReceipt));
    const meta = await sharp(rendered).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    files[generationDeliveryPath(artifactId)] = JSON.stringify({ ...singleReceipt, scene: receipt.scene });
    await expect(loadGenerationDelivery(repo, boundJob)).rejects.toThrow(/placements do not match/);
  });

  it("derives the hosted git repo only from the signed source preview binding", async () => {
    vi.stubEnv("MARKETING_OS_MODE", "hosted");
    vi.stubEnv("ACTIONS_GATE_SECRET", "delivery-test-secret");
    vi.stubEnv("MOS_AGENTS_PUBLIC_URL", "https://store.example");
    vi.resetModules();
    const [{ runWithTenant }, delivery] = await Promise.all([
      import("../templates/agents/lib/tenant-context"),
      import("../templates/agents/lib/social/generation-delivery"),
    ]);
    const preview = socialGenerationReviewLink(shop, artifactId, "a".repeat(64), "Arthaus-Inc/marketplace").url;
    const bound = { artifactId, postId, inputHash: "a".repeat(64), mechanic: "collection-scene" as const, sourcePreviewUrl: preview };
    expect(await runWithTenant({ shop, storeSlug: "arthaus-website" }, async () => delivery.generationDeliveryRepoFromPreview(bound)))
      .toBe("Arthaus-Inc/marketplace");
    const tampered = new URL(preview); tampered.searchParams.set("repo", "other/store");
    await expect(runWithTenant({ shop, storeSlug: "arthaus-website" }, async () =>
      delivery.generationDeliveryRepoFromPreview({ ...bound, sourcePreviewUrl: tampered.toString() })))
      .rejects.toThrow(/not bound/);
  });

  it("returns null only when absent and binds a present caption amendment to the job and current input", async () => {
    const { repo, files, receipt, job } = await fixture();
    expect(await loadGenerationDelivery(repo, job)).toEqual(receipt);
    delete files[generationDeliveryPath(artifactId)];
    expect(await loadGenerationDelivery(repo, job)).toBeNull();
  });

  it("rejects tampered receipt fields, source bytes, and placement source identity", async () => {
    const { repo, files, receipt, job, assets } = await fixture();
    const path = generationDeliveryPath(artifactId);
    for (const change of [{ inputHash: "b".repeat(64) }, { postId: "other" }, { artifactId: "other" }]) {
      files[path] = JSON.stringify({ ...receipt, ...change });
      await expect(loadGenerationDelivery(repo, job)).rejects.toThrow(/does not match/);
    }
    files[path] = JSON.stringify({ ...receipt, scene: { ...receipt.scene,
      placements: receipt.scene.placements.map((item, i) => i === 1 ? { ...item, sourceRef: "wrong-artwork" } : item) } });
    await expect(loadGenerationDelivery(repo, job)).rejects.toThrow(/placements do not match/);
    files[path] = JSON.stringify(receipt);
    const sourcePath = assets[2]!.source.sourcePath;
    files[sourcePath] = Buffer.from("changed").toString("base64");
    await expect(loadGenerationDelivery(repo, job)).rejects.toThrow(/Source hash mismatch/);
  });

  it("allows a loop caption-only receipt but rejects scene fields on a loop", async () => {
    const { repo, files, receipt, job, assets } = await fixture();
    const loopId = "caption-only-loop";
    files[`social/production/jobs/${loopId}.json`] = JSON.stringify({
      id: loopId, postId, slotId: "slot-1", recipeId: "artwork-loop", mechanic: "artwork-loop",
      sources: [assets[0]!.source], prompt: "Subtle paint movement", caption: "Original caption",
      transform: { kind: "contain-pad", width: 1080, height: 1920, background: "#f4f3ee" },
    });
    const loopInput = await readGenerationInput(repo, loopId);
    const loopJob = { ...job, artifactId: loopId, inputHash: loopInput.inputHash, mechanic: "artwork-loop" as const };
    files[generationDeliveryPath(loopId)] = JSON.stringify({ schemaVersion: 1, artifactId: loopId, postId,
      inputHash: loopInput.inputHash, caption: "Amended loop caption" });
    expect((await loadGenerationDelivery(repo, loopJob))?.caption).toBe("Amended loop caption");
    files[generationDeliveryPath(loopId)] = JSON.stringify({ schemaVersion: 1, artifactId: loopId, postId,
      inputHash: loopInput.inputHash, caption: "Amended loop caption", scene: receipt.scene });
    await expect(loadGenerationDelivery(repo, loopJob)).rejects.toThrow(/broker job/);
  });
});

describe("signed scene render", () => {
  it("fetches only the exact allowlisted background and checks its hash before compositing", async () => {
    const { repo, receipt, job, background } = await fixture();
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(new Uint8Array(background), { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await renderGenerationScene(repo, job, generationDeliverySchema.parse(receipt));
    const meta = await sharp(result).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, "jpeg"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].hostname).toBe("cdn.higgsfield.ai");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
    await expect(renderGenerationScene(repo, { ...job, imageUrl: "https://cdn.higgsfield.ai.evil.example/scene.jpg" }, generationDeliverySchema.parse(receipt)))
      .rejects.toThrow(/Untrusted/);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(renderGenerationScene(repo, job, generationDeliverySchema.parse({ ...receipt, scene: { ...receipt.scene, backgroundSha256: "b".repeat(64) } })))
      .rejects.toThrow(/hash mismatch/);
  // Includes real 1080x1350 projection plus source preparation; shared CI CPU
  // contention can exceed Vitest's 5s unit-test default without a hung render.
  }, 15_000);

  it("refuses invalid post-room tokens before broker or repo access", async () => {
    vi.stubEnv("ACTIONS_GATE_SECRET", "generation-test-secret");
    vi.stubEnv("SHOPIFY_STORE_URL", shop);
    const good = new URL(socialReviewLink(shop, postId).url);
    const bad = new URL(good); bad.searchParams.set("shop", "other.myshopify.com");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await GET(new NextRequest(bad), { params: Promise.resolve({ id: postId }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch).not.toHaveBeenCalled();
    expect(routeRepo.readFile).not.toHaveBeenCalled();
  });
});
