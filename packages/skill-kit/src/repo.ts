/**
 * The one store-repo seam every skill pack binds to (05 H6).
 *
 * Generalized from the social pack's `SocialRepo`: the hosted runtime binds it
 * to the tenant's store repo (GitHub contents API, local checkout, …); tests
 * bind it to an in-memory map. Paths are repo-relative
 * (e.g. "social/strategy.md", "email/campaigns/{id}/campaign.md").
 */
export interface StoreRepo {
  /** Returns the file's content, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /** Lists repo-relative paths under the given prefix. */
  list(prefix: string): Promise<string[]>;
}

/** In-memory StoreRepo for tests — the binding every pack's suite uses. */
export function createMemoryRepo(
  initial: Record<string, string> = {},
): StoreRepo & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async readFile(path) {
      return files.get(path) ?? null;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async list(prefix) {
      return [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
  };
}
