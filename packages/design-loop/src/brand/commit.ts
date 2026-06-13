/**
 * Commit the Brand Conversion Document to the client repo (PRD §1 Phase A step 3,
 * §2). Material updates land as reviewed commits — never silent mutation.
 */
import { serializeBrandDesign } from "./serialize.js";
import type { BrandDesignDoc } from "./schema.js";

export interface CommitResult {
  path: string;
  bytes: number;
  ref?: string;
}

export interface Committer {
  commit(input: { path: string; content: string; message: string }): Promise<CommitResult>;
}

export const DEFAULT_BRAND_DESIGN_PATH = "docs/brand-design.md";

export async function commitBrandDesign(
  committer: Committer,
  doc: BrandDesignDoc,
  options: { path?: string; message?: string } = {},
): Promise<CommitResult> {
  const path = options.path ?? DEFAULT_BRAND_DESIGN_PATH;
  const content = serializeBrandDesign(doc);
  const message =
    options.message ??
    `chore(brand): update brand-design.md to ${doc.frontmatter.version}`;
  return committer.commit({ path, content, message });
}

/** In-memory committer for tests / dry runs — records what would be written. */
export function memoryCommitter(): Committer & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    commit: async ({ path, content }) => {
      written.set(path, content);
      return { path, bytes: content.length };
    },
  };
}
