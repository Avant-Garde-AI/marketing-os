/**
 * One-page capture for audits, through design-craft's Playwright adapter (an
 * optional dependency). Screenshots go to a temp dir, are read into memory, and
 * the dir is removed before returning.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brandKey } from "@avant-garde/design-craft";
import type { PageImages } from "./audit.js";

export async function capturePage(url: string, viewport: "desktop" | "mobile"): Promise<PageImages & { capturedAt: string }> {
  const { capturePages } = await import("@avant-garde/design-craft/capture");
  const dir = await mkdtemp(path.join(tmpdir(), "design-conversion-"));
  try {
    const { captures, failures } = await capturePages([{ brand: brandKey(url), category: "audit", type: "other", url }], { outDir: dir, viewports: [viewport], delayMs: 0 });
    const c = captures[0];
    if (!c) throw new Error(`capture failed: ${failures[0]?.error ?? "unknown error"}`);
    return { full: await readFile(c.path), ...(c.foldPath ? { fold: await readFile(c.foldPath) } : {}), mime: "image/png", capturedAt: c.capturedAt };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
