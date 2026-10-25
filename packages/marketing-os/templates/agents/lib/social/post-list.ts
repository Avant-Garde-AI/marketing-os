/** Bounded concurrent reads for the post board. Git remains truth; no shared tenant cache. */
import { listPostIds, parsePost, postPath } from "./artifacts";
import type { SocialPost } from "./types";

export async function loadSocialPostList(repo: {
  list(prefix: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
}) {
  const ids = await listPostIds(repo);
  const rows: Array<SocialPost | null> = ids.map(() => null);
  let next = 0, unreadable = 0;
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (next < ids.length) {
      const index = next++;
      try {
        const raw = await repo.readFile(postPath(ids[index]!));
        if (raw !== null) rows[index] = parsePost(raw);
      } catch { unreadable++; }
    }
  }));
  return { posts: rows.filter((row): row is SocialPost => row !== null), unreadable };
}
