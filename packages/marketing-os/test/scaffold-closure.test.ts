import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The scaffolded file set must be CLOSED under its own imports.
 *
 * The scaffold copies an explicit, hand-maintained list of files. A page added
 * to the template that imports a new component therefore compiles perfectly in
 * this repo and breaks only in a freshly scaffolded store — and the only thing
 * that noticed was the integration suite's `next build`, which takes 70
 * seconds, runs last, and reports one missing module at a time.
 *
 * It had been red for three commits when this was written, with NINE files
 * missing: app-shell, approvals, primitives, chat-panel, skills-admin and four
 * libs. New-store onboarding was broken that whole time.
 *
 * This test reads the same list the scaffolder uses and checks every `@/`
 * import in every copied file resolves inside the copied set. It fails in
 * milliseconds, names all of them at once, and points at the fix.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const scaffoldSrc = path.join(pkgRoot, "src/scaffold/index.ts");
const templateRoot = path.join(pkgRoot, "templates/agents");

/** Target-relative paths (under `agents/`) the scaffolder writes. */
function scaffoldedFiles(): string[] {
  const src = readFileSync(scaffoldSrc, "utf8");
  const out = new Set<string>();
  // `targetPath: path.join(targetDir, "agents/…")`, with or without newlines.
  for (const m of src.matchAll(/targetPath:\s*path\.join\(\s*targetDir,\s*"([^"]+)"/g)) {
    const p = m[1]!;
    if (p.startsWith("agents/")) out.add(p.slice("agents/".length));
  }
  return [...out].sort();
}

/** Does `@/x/y` resolve to something the scaffold also copies? */
function resolvesInSet(mod: string, copied: Set<string>): boolean {
  const base = mod.slice(2);
  return ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].some((ext) => copied.has(base + ext));
}

/** The template file backing a scaffolded path (plain or .hbs). */
function templateFileFor(rel: string): string | null {
  for (const candidate of [rel, `${rel}.hbs`]) {
    const full = path.join(templateRoot, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

describe("the scaffolded store builds", () => {
  const files = scaffoldedFiles();

  it("copies a plausible number of files", () => {
    // A guard on the parser, not the scaffold: if the regex stops matching,
    // every other assertion here passes vacuously and the suite goes quiet.
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no import that the scaffolded set cannot resolve", () => {
    const copied = new Set(files);
    const unresolved: string[] = [];

    for (const rel of files) {
      const file = templateFileFor(rel);
      if (!file) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+"(@\/[^"]+)"/g)) {
        const mod = m[1]!;
        if (resolvesInSet(mod, copied)) continue;
        const inTemplate = ["", ".ts", ".tsx"].some((ext) =>
          existsSync(path.join(templateRoot, mod.slice(2) + ext)),
        );
        unresolved.push(
          `${rel} imports ${mod}` +
            (inTemplate
              ? " — the file EXISTS in the template but the scaffold does not copy it; add it to src/scaffold/index.ts"
              : " — no such file in the template at all"),
        );
      }
    }

    expect(unresolved.sort()).toEqual([]);
  });
});
