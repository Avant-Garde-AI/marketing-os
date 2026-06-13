// @ts-nocheck
/**
 * Real signed-URL uploader — requests signed PUT URLs from the knowledge plane's
 * ingestion endpoint, uploads each screenshot, and returns a bundle whose refs
 * point at the uploaded objects. Loaded only on a live run.
 */
import { readFile } from "node:fs/promises";

export function createSignedUrlUploader(config) {
  const issuer = process.env.CAPTURE_BUNDLE_UPLOAD_URL ?? "";
  const apiKey = process.env.CAPTURE_BUNDLE_UPLOAD_KEY ?? "";

  return {
    upload: async (bundle) => {
      if (!issuer) throw new Error("CAPTURE_BUNDLE_UPLOAD_URL not set — cannot upload capture bundle.");

      const issue = await fetch(issuer, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ manifest: bundle.manifest, files: Object.keys(bundle.screenshots) }),
      });
      if (!issue.ok) throw new Error(`signed-url issuance ${issue.status}: ${await issue.text()}`);
      const { base, urls } = await issue.json(); // { base: "gs://...", urls: { name: signedPutUrl } }

      const screenshots = {};
      for (const [name, localPath] of Object.entries(bundle.screenshots)) {
        const put = urls?.[name];
        if (!put) continue;
        const body = await readFile(localPath);
        const res = await fetch(put, { method: "PUT", body });
        if (!res.ok) throw new Error(`upload ${name} failed: ${res.status}`);
        screenshots[name] = `${base}/${name}`;
      }
      return { ...bundle, location: base, screenshots };
    },
  };
}
