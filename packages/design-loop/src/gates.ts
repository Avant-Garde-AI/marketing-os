/**
 * Deterministic gates — mechanical, not aspirational (PRD §3/§8/§9).
 *
 * These run every iteration over the capture bundle's structured observations.
 * They are rule-based and reproducible: the release gate and the dark-pattern
 * blocklist must never depend on a VLM. The dark-pattern gate is an
 * output-processor — a hit hard-fails regardless of any conversion lift.
 */
import type { BrandContext, CaptureBundleRef, Finding, GateResult } from "./types.js";

// ── Dark patterns (PRD §3/§8) ────────────────────────────────────────────────

/** Confirmshame / fabricated-urgency copy. Case-insensitive substring match. */
const CONFIRMSHAME_PATTERNS: RegExp[] = [
  /\bno,?\s+i\s+(don'?t|do not)\s+(want|like|care)\b/i,
  /\bi\s+don'?t\s+want\s+to\s+save\b/i,
  /\bno\s+thanks,?\s+i\s+(hate|don'?t\s+like)\b/i,
  /\bi'?d\s+rather\s+pay\s+full\s+price\b/i,
];

const FAKE_URGENCY_PATTERNS: RegExp[] = [
  /\bonly\s+\d+\s+left\s+in\s+stock\b/i,
  /\b\d+\s+people\s+are\s+(viewing|looking)\b/i,
  /\bselling\s+fast\b/i,
  /\bhurry[,!]?\s+(offer|sale)\s+ends\b/i,
  /\bcountdown\b/i,
];

/** DOM marker kinds the capture step flags as dark-pattern mechanics. */
const DARK_MARKER_KINDS = new Set(["countdown-timer", "stock-counter", "fake-viewers"]);

export function checkDarkPatterns(bundle: CaptureBundleRef): GateResult {
  const findings: Finding[] = [];
  const obs = bundle.observations;

  for (const marker of obs.markers) {
    if (DARK_MARKER_KINDS.has(marker.kind)) {
      findings.push({
        code: `dark-pattern/${marker.kind}`,
        message: `Dark-pattern mechanic detected: ${marker.kind}`,
        selector: marker.selector,
        severity: "error",
      });
    }
  }

  for (const text of obs.texts) {
    for (const re of CONFIRMSHAME_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code: "dark-pattern/confirmshame",
          message: `Confirmshaming copy: "${truncate(text)}"`,
          severity: "error",
        });
        break;
      }
    }
    for (const re of FAKE_URGENCY_PATTERNS) {
      if (re.test(text)) {
        findings.push({
          code: "dark-pattern/fake-urgency",
          message: `Fabricated scarcity/urgency copy: "${truncate(text)}"`,
          severity: "error",
        });
        break;
      }
    }
  }

  for (const input of obs.inputs) {
    if (input.checked && isUpsellInput(input.name, input.type)) {
      findings.push({
        code: "dark-pattern/pre-checked-upsell",
        message: `Pre-checked opt-in/upsell: "${input.name}"`,
        severity: "error",
      });
    }
  }

  return { passed: findings.length === 0, findings };
}

function isUpsellInput(name: string, type: string): boolean {
  if (type !== "checkbox") return false;
  return /(upsell|add[-_]?on|insurance|protection|subscribe|newsletter|gift[-_]?wrap|warranty)/i.test(name);
}

// ── Accessibility floor (PRD §9, WCAG) ───────────────────────────────────────

/** WCAG AA contrast minimums. */
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

export function checkA11y(bundle: CaptureBundleRef, wcag: "A" | "AA" | "AAA" = "AA"): GateResult {
  const findings: Finding[] = [];
  const obs = bundle.observations;

  const normalMin = wcag === "AAA" ? 7.0 : AA_NORMAL;
  const largeMin = wcag === "AAA" ? 4.5 : AA_LARGE;

  for (const c of obs.contrast) {
    const min = c.largeText ? largeMin : normalMin;
    if (c.ratio < min) {
      findings.push({
        code: "a11y/contrast",
        message: `Contrast ${c.ratio.toFixed(2)} below WCAG ${wcag} minimum ${min}`,
        selector: c.selector,
        severity: "error",
      });
    }
  }

  for (const img of obs.images) {
    if (!img.hasAlt) {
      findings.push({
        code: "a11y/img-alt",
        message: `Image missing alt text: ${img.src}`,
        severity: "error",
      });
    }
  }

  return { passed: findings.length === 0, findings };
}

// ── Token fidelity (PRD §2 §4) ───────────────────────────────────────────────

/**
 * Compare colors actually in use against the brand's declared color tokens.
 * Colors used on the page that aren't in the declared palette are drift.
 */
export function checkTokenFidelity(bundle: CaptureBundleRef, brand: BrandContext): GateResult {
  const findings: Finding[] = [];
  const declared = new Set(
    Object.values(brand.tokens).map((v) => normalizeColor(v)).filter((v): v is string => v !== null),
  );
  if (declared.size === 0) {
    // No declared palette to check against — pass with an info note.
    return { passed: true, findings: [{ code: "token-fidelity/no-palette", message: "No brand color tokens declared; fidelity check skipped", severity: "info" }] };
  }

  const usedColors = extractColors(bundle.tokens);
  for (const color of usedColors) {
    const norm = normalizeColor(color);
    if (norm && !declared.has(norm)) {
      findings.push({
        code: "token-fidelity/off-palette",
        message: `Color ${color} is not in the declared brand palette`,
        severity: "warn",
      });
    }
  }

  // Off-palette colors are warnings, not hard failures — passes unless a value
  // is explicitly tagged as a violation upstream.
  const hardFails = findings.filter((f) => f.severity === "error");
  return { passed: hardFails.length === 0, findings };
}

function extractColors(tokens: Record<string, unknown>): string[] {
  const out: string[] = [];
  const colors = tokens["colors"];
  if (Array.isArray(colors)) {
    for (const c of colors) if (typeof c === "string") out.push(c);
  } else if (colors && typeof colors === "object") {
    for (const v of Object.values(colors as Record<string, unknown>)) {
      if (typeof v === "string") out.push(v);
    }
  }
  return out;
}

function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex && hex[1]) {
    const h = hex[1];
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb && rgb[1]) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    const r = parts[0], g = parts[1], b = parts[2];
    if (r !== undefined && g !== undefined && b !== undefined) {
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }
  return null;
}

function toHex(n: string): string {
  const v = Math.max(0, Math.min(255, Number.parseInt(n, 10) || 0));
  return v.toString(16).padStart(2, "0");
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
