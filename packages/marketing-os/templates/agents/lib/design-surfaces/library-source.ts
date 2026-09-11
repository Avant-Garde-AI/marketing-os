/**
 * Read the store's design library from its own repo, for composing (spec 30 §3).
 *
 * ONE SOURCE, TWO CONSUMERS. `publish_design_library` compiles this same file
 * into a Penpot shared library so a designer finds the brand in the asset
 * panel; this reads it so the compose lane builds surfaces from the same
 * definitions. A single edit to `library.json` therefore reaches both — which
 * is the whole point of moving the craft out of platform TypeScript.
 *
 * ## What this is NOT
 *
 * It is not a live instance link. Penpot's builder API exposes no way to place
 * an INSTANCE of a shared-library component into a generated file — only the
 * internal shape attributes, which this deliberately does not forge. So a
 * composed surface MATERIALISES the component's parts rather than referencing
 * it, and editing the library does not retro-change files already composed.
 *
 * That limit matches spec 30 §8's last failure mode anyway: a library edit
 * reaching already-approved surfaces would retroactively change work somebody
 * signed off. Future composes pick up the change; published surfaces keep what
 * was approved.
 */

import { socialRepo } from "@/lib/social/repo";
import type { LibrarySource } from "./library";
import type { ResolveComponent, ResolvedComponent, SurfaceStyle, TextStyle } from "@/lib/social/archetype-surface";

export const LIBRARY_PATH = "design/library/library.json";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: LibrarySource | null } | null = null;

/**
 * The store's library, or null when it has none.
 *
 * Null is a normal state, not an error: a store composes perfectly well from
 * DESIGN.md tokens alone, and the library is the upgrade. Cached briefly so a
 * three-slide carousel does not read the same file three times.
 */
export async function loadLibrary(): Promise<LibrarySource | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value: LibrarySource | null = null;
  try {
    const raw = await socialRepo.readFile(LIBRARY_PATH);
    if (raw !== null) value = JSON.parse(raw) as LibrarySource;
  } catch (e) {
    // A malformed library must not take down composing. It IS worth shouting
    // about, because the surfaces that follow will silently look unbranded.
    console.error(`[design-library] ${LIBRARY_PATH} could not be read:`, e instanceof Error ? e.message : e);
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Look up a component by name, for `specFromArchetype`. */
export function componentResolver(library: LibrarySource | null): ResolveComponent {
  const byName = new Map((library?.components ?? []).map((c) => [c.name, c]));
  return (ref: string): ResolvedComponent | null => {
    const c = byName.get(ref);
    if (!c) return null;
    return {
      name: c.name,
      width: c.width,
      height: c.height,
      elements: c.elements as ResolvedComponent["elements"],
    };
  };
}

/** Named typography → the role style compose uses. */
function toTextStyle(t: NonNullable<LibrarySource["typographies"]>[number], color: string): TextStyle {
  return {
    fontFamily: t.fontFamily,
    ...(t.fontId ? { fontId: t.fontId } : {}),
    fontSize: t.fontSize,
    ...(t.fontWeight ? { fontWeight: t.fontWeight } : {}),
    ...(t.fontStyle ? { fontStyle: t.fontStyle } : {}),
    ...(t.lineHeight ? { lineHeight: t.lineHeight } : {}),
    color,
  };
}

/**
 * Build the compose style from the library, falling back to `base` per role.
 *
 * The library wins where it speaks and the token-derived style fills the rest,
 * so adding one typography to `library.json` improves exactly one role and
 * changes nothing else. An all-or-nothing swap would make the first commit to
 * a library a redesign.
 *
 * Roles map to library names by convention (`display/headline` →
 * `headline`), because a store should be able to name its styles for
 * designers rather than for the genome's slot vocabulary.
 */
export function surfaceStyleFromLibrary(library: LibrarySource | null, base: SurfaceStyle): SurfaceStyle {
  if (!library) return base;

  const colors = new Map((library.colors ?? []).map((c) => [c.name, c.color]));
  const ink = colors.get("charcoal") ?? colors.get("text") ?? base.defaultText.color ?? "#1A1A1A";
  const muted = colors.get("warm-gray") ?? colors.get("text-secondary") ?? ink;
  const ground = colors.get("warm-parchment") ?? colors.get("background");

  const byRole = new Map<string, TextStyle>();
  for (const t of library.typographies ?? []) {
    const role = t.name.includes("/") ? t.name.slice(t.name.lastIndexOf("/") + 1) : t.name;
    const isDisplay = t.name.startsWith("display/");
    byRole.set(role, toTextStyle(t, isDisplay ? ink : muted));
  }

  const roles: Record<string, TextStyle> = { ...(base.roles ?? {}) };
  for (const [role, style] of byRole) {
    roles[role] = { ...(roles[role] ?? {}), ...style, ...(roles[role]?.textAlign ? { textAlign: roles[role]!.textAlign } : {}) };
  }

  return {
    ...base,
    ...(ground ? { background: { fillColor: ground, fillOpacity: 1 }, bandColor: ground } : {}),
    roles,
  };
}
