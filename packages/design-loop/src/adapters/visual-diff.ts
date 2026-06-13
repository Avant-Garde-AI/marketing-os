// @ts-nocheck
/**
 * Real DiffProvider adapter — pixelmatch over the desktop full-page screenshots.
 * Loaded only on a live run.
 */
import { readFile } from "node:fs/promises";

export function createVisualDiff(_config) {
  return {
    compare: async ({ baseline, candidate }) => {
      const a = baseline.screenshots["desktop:full"];
      const b = candidate.screenshots["desktop:full"];
      if (!a || !b) return { mismatch: 0, changedPixels: 0, totalPixels: 0, regression: false };

      const { PNG } = await import("pngjs");
      const pixelmatch = (await import("pixelmatch")).default;
      const imgA = PNG.sync.read(await readFile(a));
      const imgB = PNG.sync.read(await readFile(b));
      const width = Math.min(imgA.width, imgB.width);
      const height = Math.min(imgA.height, imgB.height);
      const total = width * height;
      const changed = pixelmatch(imgA.data, imgB.data, null, width, height, { threshold: 0.1 });
      const mismatch = total > 0 ? changed / total : 0;
      // A large unexpected delta on a targeted change is treated as a regression.
      return { mismatch, changedPixels: changed, totalPixels: total, regression: mismatch > 0.6 };
    },
  };
}
