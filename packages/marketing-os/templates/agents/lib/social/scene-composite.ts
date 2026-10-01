/** Deterministic artwork placement into explicitly reviewed scene openings. */
import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
type Point = readonly [number, number];
type Quad = readonly [Point, Point, Point, Point];

export interface SceneSource { ref: string; bytes: Buffer }
export interface ScenePlacement { sourceRef: string; quad: Quad; mat: string; /** Explicit cover removes added mats by cropping edges; omission preserves the full source. */ fit?: "contain" | "cover" }
export interface SceneCompositeInput { background: Buffer; sources: SceneSource[]; placements: ScenePlacement[]; composition?: "single-artwork" }

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}
function quadIsValid(q: unknown): q is Quad {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(p => Array.isArray(p) && p.length === 2 &&
      p.every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1))) return false;
  const p = q as unknown as Quad;
  // TL, TR, BR, BL with positive winding and a useful planar opening.
  if (p[1][0] - p[0][0] < 0.03 || p[2][0] - p[3][0] < 0.03 ||
      p[3][1] - p[0][1] < 0.03 || p[2][1] - p[1][1] < 0.03) return false;
  if (p.some((v, i) => cross(v, p[(i + 1) % 4], p[(i + 2) % 4]) < 0.0005)) return false;
  const area = Math.abs(p.reduce((sum, v, i) => sum + v[0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * v[1], 0)) / 2;
  return area >= 0.005;
}
function projections(q: Quad, axis: Point): [number, number] {
  const values = q.map(p => p[0] * axis[0] + p[1] * axis[1]);
  return [Math.min(...values), Math.max(...values)];
}
function overlaps(a: Quad, b: Quad): boolean {
  for (const q of [a, b]) for (let i = 0; i < 4; i++) {
    const edge: Point = [q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]];
    const axis: Point = [-edge[1], edge[0]];
    const [a0, a1] = projections(a, axis), [b0, b1] = projections(b, axis);
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
function distance(a: Point, b: Point): number { return Math.hypot((a[0] - b[0]) * WIDTH, (a[1] - b[1]) * HEIGHT); }

/** Unit-square to destination-quad homography, in output pixel coordinates. */
function homography(q: Quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q.map(p => [p[0] * WIDTH, p[1] * HEIGHT] as Point);
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) throw new Error("Degenerate scene placement");
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return { a, b, c: x0, d, e, f: y0, g, h };
}
function sample(raw: Uint8Array, width: number, height: number, u: number, v: number, into: Uint8Array, offset: number) {
  const x = Math.min(width - 1, Math.max(0, u * (width - 1)));
  const y = Math.min(height - 1, Math.max(0, v * (height - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = raw[(y0 * width + x0) * 3 + c]!, b = raw[(y0 * width + x1) * 3 + c]!;
    const d = raw[(y1 * width + x0) * 3 + c]!, e = raw[(y1 * width + x1) * 3 + c]!;
    into[offset + c] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy);
  }
  into[offset + 3] = 255;
}

async function checkedImage(bytes: Buffer, label: string) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) throw new Error(`${label} bytes invalid`);
  const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (meta.format !== "jpeg" && meta.format !== "png" || !meta.width || !meta.height ||
      meta.width * meta.height > MAX_INPUT_PIXELS || (meta.orientation ?? 1) !== 1 || meta.pages && meta.pages !== 1)
    throw new Error(`${label} image invalid`);
  return meta;
}

export async function compositeArtworkScene(input: SceneCompositeInput): Promise<Buffer> {
  const count = input.composition === "single-artwork" ? 1 : 3;
  if (input.sources?.length !== count || input.placements?.length !== count)
    throw new Error(`Scene requires exactly ${count} artwork${count === 1 ? "" : "s"} and placement${count === 1 ? "" : "s"}`);
  const refs = new Set(input.sources.map(s => s.ref));
  if (refs.size !== count || [...refs].some(ref => !ref || ref.length > 200)) throw new Error("Scene artwork references must be distinct");
  const placed = new Set(input.placements.map(p => p.sourceRef));
  if (placed.size !== count || [...refs].some(ref => !placed.has(ref))) throw new Error("Scene placements must use each artwork once");
  for (const p of input.placements) {
    if (!quadIsValid(p.quad)) throw new Error("Invalid scene placement quad");
    if (!/^#[0-9a-fA-F]{6}$/.test(p.mat)) throw new Error("Invalid scene mat color");
    if (p.fit !== undefined && p.fit !== "contain" && p.fit !== "cover") throw new Error("Invalid scene artwork fit");
  }
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++)
    if (overlaps(input.placements[i]!.quad, input.placements[j]!.quad)) throw new Error("Scene placements overlap");
  const backgroundMeta = await checkedImage(input.background, "Background");
  if (Math.abs(backgroundMeta.width! / backgroundMeta.height! - WIDTH / HEIGHT) > 0.001)
    throw new Error("Scene background must be 4:5 without cropping");
  const sourceMap = new Map(input.sources.map(s => [s.ref, s.bytes]));
  const layers: { input: Buffer; left: number; top: number }[] = [];
  for (const placement of input.placements) {
    const source = sourceMap.get(placement.sourceRef)!;
    await checkedImage(source, "Artwork");
    const q = placement.quad;
    const matWidth = Math.min(1536, Math.max(128, Math.ceil(Math.max(distance(q[0], q[1]), distance(q[3], q[2])))));
    const matHeight = Math.min(1536, Math.max(128, Math.ceil(Math.max(distance(q[0], q[3]), distance(q[1], q[2])))));
    const { data: mat } = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
      .flatten({ background: placement.mat }).resize(matWidth, matHeight, { fit: placement.fit ?? "contain", position: "centre", background: placement.mat })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const left = Math.max(0, Math.floor(Math.min(...q.map(p => p[0] * WIDTH))));
    const top = Math.max(0, Math.floor(Math.min(...q.map(p => p[1] * HEIGHT))));
    const right = Math.min(WIDTH, Math.ceil(Math.max(...q.map(p => p[0] * WIDTH))));
    const bottom = Math.min(HEIGHT, Math.ceil(Math.max(...q.map(p => p[1] * HEIGHT))));
    const layerWidth = right - left, layerHeight = bottom - top;
    const layer = Buffer.alloc(layerWidth * layerHeight * 4);
    const H = homography(q);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const px = x + 0.5, py = y + 0.5;
      const A = H.a - px * H.g, B = H.b - px * H.h, C = px - H.c;
      const D = H.d - py * H.g, E = H.e - py * H.h, F = py - H.f;
      const det = A * E - B * D;
      if (Math.abs(det) < 1e-9) continue;
      const u = (C * E - B * F) / det, v = (A * F - C * D) / det;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      sample(mat, matWidth, matHeight, u, v, layer, ((y - top) * layerWidth + x - left) * 4);
    }
    layers.push({ input: await sharp(layer, { raw: { width: layerWidth, height: layerHeight, channels: 4 } }).png().toBuffer(), left, top });
  }
  return sharp(input.background, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(WIDTH, HEIGHT, { fit: "fill" }).composite(layers).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
}
