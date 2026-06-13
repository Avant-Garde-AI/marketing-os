/**
 * Release baseline persistence — the previous release's passing-case set, used
 * by the gate to detect previously-fixed cases that re-fail (PRD §7).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GateBaseline } from "./gate.js";

export async function readBaseline(path: string): Promise<GateBaseline | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as GateBaseline;
    if (Array.isArray(parsed.passedCases) && typeof parsed.version === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeBaseline(path: string, baseline: GateBaseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
}
