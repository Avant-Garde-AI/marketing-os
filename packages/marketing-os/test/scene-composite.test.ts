import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compositeArtworkScene, type SceneCompositeInput } from "../templates/agents/lib/social/scene-composite";

async function solid(color: string, width = 120, height = 180) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}
async function fixture(): Promise<SceneCompositeInput> {
  return {
    background: await solid("#103080", 800, 1000),
    sources: [
      { ref: "red", bytes: await solid("#ed261a") },
      { ref: "green", bytes: await solid("#1bb527") },
      { ref: "yellow", bytes: await solid("#eed015") },
    ],
    placements: [
      { sourceRef: "red", quad: [[0.05, 0.12], [0.27, 0.10], [0.28, 0.48], [0.04, 0.49]], mat: "#f4f0e8" },
      { sourceRef: "green", quad: [[0.38, 0.16], [0.62, 0.15], [0.63, 0.49], [0.37, 0.50]], mat: "#f4f0e8" },
      { sourceRef: "yellow", quad: [[0.73, 0.11], [0.96, 0.13], [0.95, 0.50], [0.72, 0.49]], mat: "#f4f0e8" },
    ],
  };
}
async function pixel(bytes: Buffer, x: number, y: number) {
  return [...await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer()];
}

describe("artwork scene compositor", () => {
  it("places one full artwork only when single-artwork composition is explicit", async () => {
    const input = await fixture();
    input.sources = [input.sources[0]!];
    input.placements = [input.placements[0]!];
    await expect(compositeArtworkScene(input)).rejects.toThrow(/exactly 3/);
    input.composition = "single-artwork";
    const output = await compositeArtworkScene(input);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    const artwork = await pixel(output, 170, 390), outside = await pixel(output, 540, 1050);
    expect(artwork[0]).toBeGreaterThan(artwork[1]! * 2);
    expect(outside[2]).toBeGreaterThan(outside[0]! * 3);
    input.sources = [input.sources[0]!, { ref: "other", bytes: input.sources[0]!.bytes }];
    await expect(compositeArtworkScene(input)).rejects.toThrow(/exactly 1/);
  });

  it("projects all three artworks and leaves the outside background untouched", async () => {
    const output = await compositeArtworkScene(await fixture());
    const meta = await sharp(output).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1350]);
    const red = await pixel(output, 170, 390), green = await pixel(output, 540, 420);
    const yellow = await pixel(output, 900, 400), outside = await pixel(output, 540, 1050);
    expect(red[0]).toBeGreaterThan(red[1]! * 2);
    expect(green[1]).toBeGreaterThan(green[0]! * 2);
    expect(yellow[0]).toBeGreaterThan(180);
    expect(yellow[1]).toBeGreaterThan(130);
    expect(outside[2]).toBeGreaterThan(outside[0]! * 3);
  });

  it("contains the entire portrait artwork inside a wide mat rather than cropping it", async () => {
    const input = await fixture();
    const portrait = await sharp({ create: { width: 80, height: 200, channels: 3, background: "#777777" } })
      .composite([
        { input: await solid("#eb1818", 80, 30), left: 0, top: 0 },
        { input: await solid("#1dcb2b", 80, 30), left: 0, top: 170 },
      ]).png().toBuffer();
    input.sources[0]!.bytes = portrait;
    input.placements[0]!.quad = [[0.04, 0.12], [0.30, 0.12], [0.30, 0.29], [0.04, 0.29]];
    const output = await compositeArtworkScene(input);
    const top = await pixel(output, 180, 174), bottom = await pixel(output, 180, 377);
    const sideMat = await pixel(output, 66, 270);
    expect(top[0]).toBeGreaterThan(top[1]! * 2);
    expect(bottom[1]).toBeGreaterThan(bottom[0]! * 2);
    expect(sideMat[0]).toBeGreaterThan(210);
    expect(sideMat[1]).toBeGreaterThan(205);
    expect(sideMat[2]).toBeGreaterThan(195);
  });

  it("rejects degenerate, misordered, overlapping, and out-of-bounds placements", async () => {
    const input = await fixture();
    const original = input.placements[0]!.quad;
    for (const quad of [
      [[0.1, 0.1], [0.1, 0.1], [0.2, 0.3], [0.1, 0.3]],
      [[0.05, 0.1], [0.3, 0.4], [0.3, 0.1], [0.05, 0.4]],
      [[-0.05, 0.1], [0.3, 0.1], [0.3, 0.4], [0.05, 0.4]],
    ]) {
      input.placements[0]!.quad = quad as unknown as typeof original;
      await expect(compositeArtworkScene(input)).rejects.toThrow(/Invalid scene placement quad/);
    }
    input.placements[0]!.quad = original;
    input.placements[1]!.quad = original;
    await expect(compositeArtworkScene(input)).rejects.toThrow(/overlap/);
    input.placements[1]!.quad = [[0.38, 0.16], [0.62, 0.15], [0.63, 0.49], [0.37, 0.50]];
    input.background = await solid("#103080", 1000, 1000);
    await expect(compositeArtworkScene(input)).rejects.toThrow(/4:5/);
  });
});
