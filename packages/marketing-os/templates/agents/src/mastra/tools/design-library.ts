/**
 * Publish the store's design library into its Penpot team (spec 30 §2).
 *
 * Repo → Penpot, one way. The store commits `design/library/library.json`; this
 * compiles it and imports it into the tenant's own team as a shared library, so
 * a designer opens the Design Studio and finds the brand's colours, type styles
 * and components in the asset panel rather than a blank palette.
 *
 * ## Why publishing is a tool and not a deploy step (D3)
 *
 * A deploy-time publish would let an unrelated platform release change how the
 * store's posts look. Publishing is a decision about the brand, so it is taken
 * deliberately and reported, and the drift check exists to make "we forgot" a
 * visible state instead of a silent one.
 *
 * ## Drift is reported, never repaired
 *
 * The published file records the digest of the source it was built from. A
 * later check compares repo against live and SAYS what it finds. It never
 * re-publishes on its own: a system that silently re-syncs teaches people the
 * repo does not matter, which is the opposite of the property this lane is for.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getTenant } from "../../../lib/tenant-context";
import {
  getDesignSurfaceAdapter,
  isDesignSurfacesConfigured,
  NOT_CONFIGURED_NOTE,
} from "../../../lib/design-surfaces/config";
import { getTenantTeam } from "../../../lib/design-surfaces/tenancy";
import {
  composeLibraryFile,
  sourceDigest,
  validateLibrary,
  type LibrarySource,
} from "../../../lib/design-surfaces/library";
import { socialRepo } from "../../../lib/social/repo";

/** Where a store keeps its design library source (spec 30 §1). */
export const LIBRARY_PATH = "design/library/library.json";
/** What the publish step leaves behind, so drift is checkable. */
export const LIBRARY_LOCK_PATH = "design/library/published.json";

interface PublishedRecord {
  digest: string;
  version: string;
  fileId: string;
  name: string;
  publishedAt: string;
}

async function readSource(): Promise<{ source?: LibrarySource; note?: string }> {
  const raw = await socialRepo.readFile(LIBRARY_PATH);
  if (raw === null) {
    return {
      note:
        `This store has no ${LIBRARY_PATH}. A design library is optional — surfaces compose from ` +
        `DESIGN.md tokens without one — but until it exists the brand's craft (type scale, the ` +
        `caption band, the credit lockup) lives in platform code rather than in this repo.`,
    };
  }
  try {
    return { source: JSON.parse(raw) as LibrarySource };
  } catch (e) {
    return { note: `${LIBRARY_PATH} is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const publishDesignLibrary = createTool({
  id: "publish_design_library",
  description:
    "Publish the store's DESIGN LIBRARY from its repo into the Design Studio as a shared library — the brand's named colours, type styles and components (caption band, credit lockup) that composed surfaces are built from. " +
    "The repo is the source of truth: this reads design/library/library.json, compiles it, and imports it. It never reads design back OUT of the Studio, so a library edited only on the canvas is not a source and will be reported as drift. " +
    "Publishing is a deliberate decision about how the brand looks, not a side effect of a deploy — say what changed and why when you run it. " +
    "Refuses a library with duplicate asset names or a component whose contents escape its bounds: Penpot resolves assets by NAME, so a duplicate makes every reference to it ambiguous and the wrong one still exports cleanly. " +
    "Use check_design_library first to see whether the live library already matches the repo.",
  inputSchema: z.object({
    note: z
      .string()
      .optional()
      .describe("Why this publish is happening — recorded with the published record"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    note: z.string(),
    fileId: z.string().optional(),
    version: z.string().optional(),
    digest: z.string().optional(),
    assets: z
      .object({ colors: z.number(), typographies: z.number(), components: z.number() })
      .optional(),
  }),
  execute: async (input: { note?: string }) => {
    if (!isDesignSurfacesConfigured()) return { ok: false, note: NOT_CONFIGURED_NOTE };
    const { shop } = getTenant();
    try {
      const { source, note } = await readSource();
      if (!source) return { ok: false, note: note! };

      const problems = validateLibrary(source);
      if (problems.length > 0) {
        return {
          ok: false,
          note:
            `${LIBRARY_PATH} is not publishable — fix these and run again:\n` +
            problems.map((p) => `- ${p.field}: ${p.detail}`).join("\n"),
        };
      }

      const bytes = await composeLibraryFile(source);
      const home = await getTenantTeam(shop);
      const adapter = getDesignSurfaceAdapter();
      const fileId = await adapter.importBinfile(home.projectId, source.name, bytes);

      const record: PublishedRecord = {
        digest: sourceDigest(source),
        version: source.version,
        fileId,
        name: source.name,
        publishedAt: new Date().toISOString(),
      };
      // The lock lands in the REPO, so "what is live" is reviewable in a pull
      // request like everything else. Never allowed to fail the publish: the
      // library is already in Penpot by this point, and losing the record is a
      // drift-reporting problem, not a reason to pretend the publish failed.
      let recorded = true;
      try {
        await socialRepo.writeFile(LIBRARY_LOCK_PATH, `${JSON.stringify(record, null, 2)}\n`);
      } catch (e) {
        recorded = false;
        console.error("[design-library] could not write the published record:", e instanceof Error ? e.message : e);
      }

      const assets = {
        colors: source.colors?.length ?? 0,
        typographies: source.typographies?.length ?? 0,
        components: source.components?.length ?? 0,
      };
      return {
        ok: true,
        fileId,
        version: source.version,
        digest: record.digest,
        assets,
        note:
          `Published "${source.name}" v${source.version} — ${assets.colors} colours, ` +
          `${assets.typographies} type styles, ${assets.components} components.` +
          (input.note ? ` (${input.note})` : "") +
          (recorded
            ? ""
            : ` NOTE: the published record could not be written to ${LIBRARY_LOCK_PATH}, so drift ` +
              `checks will report this library as never published until it is.`) +
          ` To use it on a canvas, add it as a shared library to the file in the Design Studio.`,
      };
    } catch (e) {
      return { ok: false, note: `Design library publish failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});

export const checkDesignLibrary = createTool({
  id: "check_design_library",
  description:
    "Compare the store's design library SOURCE (design/library/library.json) against what was last published to the Design Studio. " +
    "Answers whether the live library still matches the repo. It only reports — it never republishes, because a system that silently re-syncs teaches people the repo does not matter. " +
    "Run this before composing if a surface looks wrong, and before publishing so you know what the publish will change.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    hasLibrary: z.boolean(),
    published: z.boolean(),
    inSync: z.boolean(),
    note: z.string(),
    sourceVersion: z.string().optional(),
    publishedVersion: z.string().optional(),
  }),
  execute: async () => {
    const { source, note } = await readSource();
    if (!source) return { hasLibrary: false, published: false, inSync: false, note: note! };

    const raw = await socialRepo.readFile(LIBRARY_LOCK_PATH);
    if (raw === null) {
      return {
        hasLibrary: true,
        published: false,
        inSync: false,
        sourceVersion: source.version,
        note: `"${source.name}" v${source.version} exists in the repo but has never been published. Run publish_design_library.`,
      };
    }
    let record: PublishedRecord;
    try {
      record = JSON.parse(raw) as PublishedRecord;
    } catch {
      return {
        hasLibrary: true,
        published: false,
        inSync: false,
        sourceVersion: source.version,
        note: `${LIBRARY_LOCK_PATH} is unreadable, so what is live cannot be established. Republish to restore the record.`,
      };
    }

    const digest = sourceDigest(source);
    const inSync = digest === record.digest;
    return {
      hasLibrary: true,
      published: true,
      inSync,
      sourceVersion: source.version,
      publishedVersion: record.version,
      note: inSync
        ? `In sync: "${source.name}" v${source.version} matches what is published.`
        : `DRIFT: the repo has v${source.version} (${digest}) and the Studio has v${record.version} ` +
          `(${record.digest}), published ${record.publishedAt}. Surfaces composed now use the PUBLISHED ` +
          `one. Publish to close the gap — this check will not do it for you.`,
    };
  },
});

export const designLibraryTools = {
  publish_design_library: publishDesignLibrary,
  check_design_library: checkDesignLibrary,
};
