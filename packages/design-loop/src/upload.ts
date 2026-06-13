/**
 * Capture-bundle upload (PRD §4.2). Bundles upload via signed URLs and are
 * passed to MCP tools BY REFERENCE, never inlined. The uploader rewrites a
 * bundle's `location` (and screenshot paths) to remote refs.
 */
import type { CaptureBundleRef } from "./types.js";

export interface BundleUploader {
  upload(bundle: CaptureBundleRef): Promise<CaptureBundleRef>;
}

/** Default — keeps local paths (no remote ingestion configured). */
export const localUploader: BundleUploader = {
  upload: async (bundle) => bundle,
};

/** Deterministic mock of signed-URL ingestion: rewrites refs to gs:// URLs. */
export function mockSignedUrlUploader(bucket = "mock-capture-bundles"): BundleUploader {
  return {
    upload: async (bundle) => {
      const key = bundle.manifest.page.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "root";
      const base = `gs://${bucket}/${bundle.manifest.themeRef}/${key}`;
      const screenshots: Record<string, string> = {};
      for (const [name] of Object.entries(bundle.screenshots)) {
        screenshots[name] = `${base}/${name.replace(/[:]/g, "_")}.png`;
      }
      return { ...bundle, location: base, screenshots };
    },
  };
}
