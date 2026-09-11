/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
/**
 * Colour claims, checked against the work's actual pixels.
 *
 * THE BUG THIS EXISTS FOR. Ten Arthaus posts shipped; five described the
 * artwork they linked to, and all five were wrong. "Bold black and white
 * stripes" for a print of teal, magenta and orange arcs. "Soft swaths of dusty
 * rose, sage and pale yellow" for a black-ink line drawing on cream. "Warm
 * terracotta and ochre" for a deep-teal botanical. Nothing caught them, because
 * `checkPostClaims` validates entities, handles and link hosts — things it can
 * compare against a list — and a sentence about colour had nothing to be
 * compared against.
 *
 * A palette does. Extract the dominant colours from the image bytes, name the
 * colour words in the copy, and refuse the ones that are nowhere near anything
 * in the work. That turns the most common fabrication in this domain from an
 * unverifiable assertion into a failed comparison.
 *
 * ## What this does NOT do, stated so nobody trusts it further than it goes
 *
 * It checks COLOUR and nothing else. "Tight geometry", "a gentle abstract
 * mood", "a sun-drenched landscape" are claims about subject and composition,
 * and this module is blind to all of them — one of the five real fabrications
 * (a graphite portrait described as "warm, earthy tones and tight geometry")
 * passes here, because its colour words happen to be true and its subject claim
 * is the part that is wrong. Catching four of five is worth having; believing
 * it catches five is worse than not having it.
 *
 * It also cannot tell you a colour word is MISSING. Describing a teal work
 * without mentioning teal is not an error.
 *
 * ## Why ΔE and not "is this hex in the list"
 *
 * Nobody writes hex codes in a caption. A reader calls #025C65 "deep teal" and
 * would also accept "petrol" or "dark green-blue"; the question is never
 * equality but proximity. ΔE76 in CIE Lab is the cheapest metric where a
 * numeric distance corresponds roughly to what an eye calls "a different
 * colour", which is exactly the judgement being automated.
 */

/** One dominant colour of a work, with how much of the image it covers. */
export interface PaletteColor {
  /** "#RRGGBB". */
  hex: string;
  /** Fraction of the image, 0–1. */
  share: number;
}

export interface ColorClaimProblem {
  id: "unsupported-color-claim";
  /** The colour word as written in the copy. */
  word: string;
  /** Closest palette colour, and how far away it is. */
  nearestHex: string;
  deltaE: number;
  detail: string;
}

export interface ColorClaimOptions {
  /**
   * Maximum ΔE76 for a named colour to count as present.
   *
   * 32 is deliberately generous. This guard refuses a human's writing, so its
   * failure mode matters more than its hit rate: a false refusal makes a
   * correct caption unwritable and teaches people to route around the guard,
   * while a miss leaves us exactly where we already were. Tuned against the
   * real corpus — it refuses every one of the four colour fabrications while
   * accepting "cream", "teal" and "orange" on the works that are those colours.
   */
  tolerance?: number;
  /**
   * Minimum share for a palette entry to justify a claim. A colour occupying
   * 1% of an image is present in it but is not what the work looks like, and
   * allowing it would let any claim be justified by a stray region.
   */
  minShare?: number;
}

const DEFAULT_TOLERANCE = 32;
const DEFAULT_MIN_SHARE = 0.03;

/**
 * Lab chroma at or above which a colour word is a claim about SATURATION and
 * not merely about a hue family. Below it ("slate", "taupe", "sage") the word
 * is already describing something muted, and the chroma gate would refuse
 * accurate copy about a muted work.
 */
const CHROMATIC_CLAIM = 24;

/**
 * Colour words a caption might plausibly use, with a representative value.
 *
 * Longer names come first so "dusty rose" and "pale yellow" match before
 * "rose" and "yellow" — a caption saying "dusty rose" has made a more specific
 * claim than "rose", and checking the looser one would let the specific claim
 * through on a technicality.
 */
const NAMED_COLORS: [string, string][] = [
  ["dusty rose", "#C48793"],
  ["pale yellow", "#F3E5A0"],
  ["deep indigo", "#2E2A6B"],
  ["burnt orange", "#CC5500"],
  ["forest green", "#1B4D2E"],
  ["navy blue", "#1B2A4A"],
  ["blush pink", "#E8B4B8"],
  ["off white", "#F2EFE9"],
  ["jet black", "#0B0B0B"],
  ["charcoal", "#36454F"],
  ["graphite", "#4A4A4A"],
  ["terracotta", "#C4836A"],
  ["turquoise", "#40C4C4"],
  ["magenta", "#CB327F"],
  ["lavender", "#B9A6D6"],
  ["burgundy", "#6B1F2E"],
  ["mustard", "#D4A017"],
  ["crimson", "#9E1B32"],
  ["emerald", "#2E8B57"],
  ["indigo", "#3A2E7A"],
  ["maroon", "#6E1F2B"],
  ["violet", "#7B66C5"],
  ["scarlet", "#C21E28"],
  ["copper", "#B36A3E"],
  ["bronze", "#B07D4F"],
  ["silver", "#BFC1C2"],
  ["cobalt", "#204FA0"],
  ["petrol", "#0B4F5C"],
  ["ochre", "#CC7722"],
  ["cream", "#F1EAD5"],
  ["ivory", "#F4F0E2"],
  ["beige", "#D9CBB3"],
  ["taupe", "#8B7D6B"],
  ["olive", "#6B6651"],
  ["coral", "#E26952"],
  ["peach", "#F0B08A"],
  ["amber", "#D79A2B"],
  ["lilac", "#C0A8D8"],
  ["mauve", "#9B7B96"],
  ["slate", "#5A6672"],
  ["black", "#141414"],
  ["white", "#F7F5F1"],
  ["grey", "#8A8A8A"],
  ["gray", "#8A8A8A"],
  ["brown", "#6B4A32"],
  ["green", "#3F7A45"],
  ["blue", "#2F5FA8"],
  ["teal", "#0E6E70"],
  ["sage", "#A8B5A0"],
  ["rust", "#A34428"],
  ["pink", "#E08BA8"],
  ["red", "#B22234"],
  ["orange", "#E08234"],
  ["yellow", "#E8C441"],
  ["purple", "#6A4C93"],
  ["gold", "#C9A227"],
  ["tan", "#C8A578"],
];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB → CIE Lab (D65). */
function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab chroma (C*) — how saturated a colour is, independent of lightness. */
export function chroma(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [, a, b] = rgbToLab(rgb);
  return Math.sqrt(a * a + b * b);
}

/** ΔE76 — Euclidean distance in Lab. */
export function deltaE(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Modifiers that shift what a colour word claims.
 *
 * Without these, "pale green" is checked as plain green — a fully saturated
 * mid-green — and refused on a work that is genuinely a pale grey-green. The
 * modifier is doing real semantic work in the sentence, so ignoring it makes
 * the guard reject accurate copy, which is the one failure mode that would
 * discredit it. `[lightnessDelta, chromaScale]`, applied in Lab.
 */
const MODIFIERS: [string, [number, number]][] = [
  ["pale", [18, 0.5]],
  ["light", [16, 0.7]],
  ["soft", [10, 0.6]],
  ["muted", [0, 0.5]],
  ["dusty", [4, 0.5]],
  ["washed", [14, 0.45]],
  ["deep", [-18, 1.05]],
  ["dark", [-20, 0.95]],
  ["rich", [-8, 1.15]],
  ["bright", [6, 1.3]],
  ["vivid", [2, 1.35]],
  ["warm", [2, 1.05]],
  ["cool", [2, 0.95]],
];

function labToHex([L, a, b]: [number, number, number]): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883];
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.204 + z * 1.057;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return "#" + [enc(R), enc(G), enc(B)].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
}

/** Apply a modifier to a reference colour, in Lab. */
function applyModifier(hex: string, mod: [number, number]): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [L, a, b] = rgbToLab(rgb);
  const [dL, scale] = mod;
  return labToHex([Math.max(0, Math.min(100, L + dL)), a * scale, b * scale]);
}

/** Colour words present in a piece of copy, longest name first. */
export function colorWordsIn(copy: string): string[] {
  return colorClaimsIn(copy).map((c) => c.phrase);
}

export interface ColorClaim {
  /** As written, including any modifier — "pale green". */
  phrase: string;
  /** The vocabulary entry matched. */
  word: string;
  /** Reference colour after the modifier is applied. */
  hex: string;
}

/** Colour claims in copy, with modifiers folded into the reference colour. */
export function colorClaimsIn(copy: string): ColorClaim[] {
  const text = copy.toLowerCase();
  const found: ColorClaim[] = [];
  const claimed: [number, number][] = [];
  const byName = new Map(NAMED_COLORS);
  const mods = new Map(MODIFIERS);
  for (const [name] of NAMED_COLORS) {
    const re = new RegExp(`(?<![a-z])${name.replace(/\s+/g, "[\\s-]+")}(?![a-z])`, "g");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // A longer name already covering this span wins — "dusty rose" beats the
      // "rose" inside it, so the specific claim is the one checked.
      if (claimed.some(([s, e]) => start >= s && end <= e)) continue;
      claimed.push([start, end]);
      const before = text.slice(Math.max(0, start - 14), start);
      const modMatch = /([a-z]+)[\s-]+$/.exec(before);
      const modName = modMatch?.[1] ?? "";
      const mod = mods.get(modName);
      const base = byName.get(name)!;
      found.push({
        phrase: mod ? `${modName} ${name}` : name,
        word: name,
        hex: mod ? applyModifier(base, mod) : base,
      });
    }
  }
  return found;
}

/**
 * Colour claims in `copy` that the work's palette does not support.
 *
 * An empty palette returns no problems: "we could not extract a palette" must
 * not present as "every colour claim is fine", but it equally cannot refuse a
 * caption on the strength of evidence we do not have. The caller decides what
 * an absent palette means — `checkPostClaims` treats it as unchecked and says
 * so, which is the honest reading.
 */
export function checkColorClaims(
  copy: string,
  palette: PaletteColor[],
  opts: ColorClaimOptions = {},
): ColorClaimProblem[] {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const minShare = opts.minShare ?? DEFAULT_MIN_SHARE;
  const dominant = palette.filter((p) => p.share >= minShare);
  if (dominant.length === 0) return [];

  const problems: ColorClaimProblem[] = [];
  for (const claim of colorClaimsIn(copy)) {
    const { phrase: word, hex: ref } = claim;
    let nearestHex = dominant[0]!.hex;
    let best = Number.POSITIVE_INFINITY;
    for (const p of dominant) {
      const d = deltaE(ref, p.hex);
      if (d < best) {
        best = d;
        nearestHex = p.hex;
      }
    }
    // Chroma gate. ΔE alone is too forgiving on a near-neutral work: in Lab,
    // a muted colour sits close to a mid grey, so a cream-and-ink drawing will
    // happily "support" dusty rose, sage and half the muted spectrum. If the
    // copy claims a SATURATED colour and nothing in the work carries comparable
    // saturation, the work is simply not that colourful, whatever ΔE says.
    const claimChroma = chroma(ref);
    const paletteChroma = Math.max(...dominant.map((p) => chroma(p.hex)));
    const tooDrab = claimChroma >= CHROMATIC_CLAIM && paletteChroma < claimChroma * 0.5;

    if (best > tolerance || tooDrab) {
      problems.push({
        id: "unsupported-color-claim",
        word,
        nearestHex,
        deltaE: Math.round(best),
        detail: tooDrab
          ? `the copy says "${word}", but the work is close to neutral — its most saturated colour ` +
            `is ${nearestHex}, well short of what "${word}" claims. Describe the work as it is, or ` +
            `drop the colour.`
          : `the copy says "${word}", and nothing in the work is close to it — the nearest dominant ` +
            `colour is ${nearestHex} (ΔE ${Math.round(best)}). Describe what the work actually looks ` +
            `like, or drop the colour.`,
      });
    }
  }
  return problems;
}
