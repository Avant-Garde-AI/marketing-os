import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generationCarouselPath, loadGenerationCarousel, listGenerationCarouselsForMonth,
  readPersistedCarouselImage } from "../templates/agents/lib/social/generation-carousel";
import { socialCarouselReviewLink, socialReviewLink, verifyCarouselReviewLink, verifyLink } from
  "../templates/agents/lib/social/review-links";
import { GET as renderSlide } from "../templates/agents/app/api/social/carousel/render/[id]/[index]/route";
import { POST as addCarouselNote } from "../templates/agents/app/api/social/carousel/review-notes/route";

const route = vi.hoisted(() => ({ readFile: vi.fn(), loadJob: vi.fn(), readInput: vi.fn(), loadDelivery: vi.fn(), addNote: vi.fn() }));
vi.mock("../templates/agents/lib/social/repo", () => ({ socialRepo: { readFile: route.readFile } }));
vi.mock("../templates/agents/lib/social/generation-review", () => ({ loadGenerationJobForPost: route.loadJob }));
vi.mock("../templates/agents/lib/social/generation-input", () => ({ readGenerationInput: route.readInput }));
vi.mock("../templates/agents/lib/social/generation-delivery", () => ({
  generationDeliveryRepoFromPreview: () => "Arthaus-Inc/marketplace",
  loadGenerationDelivery: route.loadDelivery,
  renderGenerationScene: vi.fn(),
}));
vi.mock("../templates/agents/lib/review/notes", () => ({ addNote: route.addNote }));

const shop = "arthaus-website.myshopify.com";
const repoName = "Arthaus-Inc/marketplace";
const parent = "2026-10-instagram-moroccan-carousel";
const slides = [1, 2, 3].map((n) => ({
  artifactId: `moroccan-carousel-v1-slide-${n}`,
  postId: `2026-10-instagram-moroccan-slide-${n}`,
  inputHash: String(n).repeat(64),
  artistCredit: `Artist ${n}`,
}));
function manifest() { return { schemaVersion: 1, parentPostId: parent, caption: "Three worlds, one story.", slides: slides.map(s => ({ ...s })) }; }
function repo(files: Record<string, string>) {
  return { readFile: async (path: string) => files[path] ?? null,
    list: async (prefix: string) => Object.keys(files).filter(path => path.startsWith(prefix)) } as Parameters<typeof loadGenerationCarousel>[0];
}

describe("generation carousel", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("keeps three bound slides in the authored order and excludes malformed parents", async () => {
    const good = generationCarouselPath(parent);
    const files = { [good]: JSON.stringify(manifest()),
      "social/production/carousels/2026-10-instagram-bad.json": "{" };
    const loaded = await loadGenerationCarousel(repo(files), parent);
    expect(loaded?.slides.map(s => s.artifactId)).toEqual(slides.map(s => s.artifactId));
    const month = await listGenerationCarouselsForMonth(repo(files), "2026-10");
    expect(month.manifests.map(m => m.parentPostId)).toEqual([parent]);
    expect(month.invalid).toEqual(["2026-10-instagram-bad"]);
    expect(await loadGenerationCarousel(repo({}), parent)).toBeNull(); // legacy standalone review remains valid
  });

  it("rejects duplicate children and a swapped or altered input binding", async () => {
    const bad = manifest();
    bad.slides[1] = { ...bad.slides[1]!, artifactId: bad.slides[0]!.artifactId };
    await expect(loadGenerationCarousel(repo({ [generationCarouselPath(parent)]: JSON.stringify(bad) }), parent))
      .rejects.toThrow();
    const wrongParent = { ...manifest(), parentPostId: "2026-10-instagram-other-carousel" };
    await expect(loadGenerationCarousel(repo({ [generationCarouselPath(parent)]: JSON.stringify(wrongParent) }), parent))
      .rejects.toThrow(/parent ID mismatch/);
    const crossMonth = manifest();
    crossMonth.slides[2] = { ...crossMonth.slides[2]!, postId: "2026-11-instagram-moroccan-slide-3" };
    await expect(loadGenerationCarousel(repo({ [generationCarouselPath(parent)]: JSON.stringify(crossMonth) }), parent))
      .rejects.toThrow();
  });

  it("accepts only a repo-bound parent token, never a child or ordinary post token", () => {
    vi.stubEnv("ACTIONS_GATE_SECRET", "carousel-test-secret");
    const url = new URL(socialCarouselReviewLink(shop, parent, repoName).url);
    const t = url.searchParams.get("t"), e = url.searchParams.get("e");
    expect(verifyCarouselReviewLink(shop, parent, repoName, t, e)).toBe("ok");
    expect(verifyCarouselReviewLink(shop, slides[0]!.postId, repoName, t, e)).toBe("invalid");
    expect(verifyCarouselReviewLink(shop, parent, "Other/store", t, e)).toBe("invalid");
    expect(verifyCarouselReviewLink("other.myshopify.com", parent, repoName, t, e)).toBe("invalid");
    expect(verifyLink("review", shop, slides[0]!.postId, t, e)).toBe("invalid");
    const ordinary = new URL(socialReviewLink(shop, parent).url);
    expect(verifyCarouselReviewLink(shop, parent, repoName, ordinary.searchParams.get("t"), ordinary.searchParams.get("e"))).toBe("invalid");
  });

  it("verifies persisted final JPEG bytes, hash, dimensions and content-addressed path", async () => {
    const bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `social/production/renders/${sha256}.jpeg.b64`;
    const slide = { ...slides[0]!, finalImage: { sha256, path } };
    expect(await readPersistedCarouselImage(repo({ [path]: bytes.toString("base64") }), slide)).toEqual(bytes);
    await expect(readPersistedCarouselImage(repo({ [path]: Buffer.from("tampered").toString("base64") }), slide)).rejects.toThrow(/hash mismatch/);
    const square = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer();
    const squareHash = createHash("sha256").update(square).digest("hex");
    await expect(readPersistedCarouselImage(repo({ [`social/production/renders/${squareHash}.jpeg.b64`]: square.toString("base64") }),
      { ...slide, finalImage: { sha256: squareHash, path: `social/production/renders/${squareHash}.jpeg.b64` } }))
      .rejects.toThrow(/dimensions invalid/);
  });

  it("serves only a manifest member to the signed parent and rejects a mismatched child job", async () => {
    vi.stubEnv("ACTIONS_GATE_SECRET", "carousel-route-secret");
    vi.stubEnv("SHOPIFY_STORE_URL", shop);
    const bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `social/production/renders/${sha256}.jpeg.b64`;
    const item = { ...manifest(), slides: manifest().slides.map((slide, index) =>
      index === 0 ? { ...slide, finalImage: { sha256, path } } : slide) };
    const files: Record<string, string> = { [generationCarouselPath(parent)]: JSON.stringify(item), [path]: bytes.toString("base64") };
    route.readFile.mockImplementation(async (p: string) => files[p] ?? null);
    route.readInput.mockResolvedValue({ inputHash: slides[0]!.inputHash,
      plan: { postId: slides[0]!.postId, mechanic: "collection-scene", sceneComposition: "single-artwork" } });
    route.loadDelivery.mockResolvedValue({ scene: { placements: [{}] } });
    route.loadJob.mockResolvedValue({ artifactId: slides[0]!.artifactId, postId: slides[0]!.postId,
      inputHash: slides[0]!.inputHash, mechanic: "collection-scene", state: "succeeded", imageUrl: "https://cdn.higgsfield.ai/scene.jpg" });
    const url = new URL(socialCarouselReviewLink(shop, parent, repoName).url);
    const request = (index: string, href = url.toString()) => renderSlide(new NextRequest(href),
      { params: Promise.resolve({ id: parent, index }) });
    expect((await request("1")).status).toBe(200);
    expect((await request("4")).status).toBe(404);
    expect((await request("1", socialReviewLink(shop, slides[0]!.postId).url)).status).toBe(404);
    route.loadJob.mockResolvedValueOnce({ artifactId: "other", postId: slides[0]!.postId,
      inputHash: slides[0]!.inputHash, mechanic: "collection-scene", state: "succeeded", imageUrl: "https://cdn.higgsfield.ai/scene.jpg" });
    expect((await request("1")).status).toBe(404);
  });

  it("allows notes only for the signed parent and its three manifest members", async () => {
    vi.stubEnv("ACTIONS_GATE_SECRET", "carousel-note-secret");
    vi.stubEnv("SHOPIFY_STORE_URL", shop);
    route.readFile.mockImplementation(async (p: string) => p === generationCarouselPath(parent) ? JSON.stringify(manifest()) : null);
    route.addNote.mockResolvedValue({ id: "note-1", body: "Adjust slide two" });
    const parentLink = new URL(socialCarouselReviewLink(shop, parent, repoName).url);
    const send = (slot: string | null, token = parentLink.searchParams.get("t")) => addCarouselNote(new NextRequest("https://console.example/api/social/carousel/review-notes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        groupKey: parent, shop, repo: repoName, t: token, e: parentLink.searchParams.get("e"),
        author: "Reviewer", body: "Adjust slide two", slot,
      }),
    }));
    expect((await send(slides[1]!.postId)).status).toBe(200);
    expect(route.addNote).toHaveBeenCalledWith(expect.objectContaining({ itemId: parent, slot: slides[1]!.postId }));
    route.addNote.mockClear();
    expect((await send("2026-10-instagram-other-slide")).status).toBe(400);
    expect((await send(slides[0]!.postId, new URL(socialReviewLink(shop, slides[0]!.postId).url).searchParams.get("t"))).status).toBe(403);
    expect(route.addNote).not.toHaveBeenCalled();
  });
});
