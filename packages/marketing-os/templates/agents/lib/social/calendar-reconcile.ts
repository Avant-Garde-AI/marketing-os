/** Rebuild the calendar's read model from dated file truth; never changes or approves a post. */
import { socialRepo } from "./repo";
import { parsePost } from "./artifacts";
import { syncPostIndex } from "./index-sync";
import { withSocialPostLock } from "./publish-lock";
import { postMonth } from "./projection";
export async function reconcileSocialCalendar(shop: string, month: string) {
  const report = { indexed: 0, failures: [] as string[] };
  try {
    const paths = (await socialRepo.list(`social/posts/${month}-`)).filter(p => p.endsWith("/post.md"));
    for (const path of paths.slice(0, 62)) {
      const id = path.split("/")[2];
      await withSocialPostLock(id, async () => {
        const raw = await socialRepo.readFile(path);
        if (!raw) return;
        const post = parsePost(raw);
        if (postMonth(post) !== month || !(post.plannedAt || post.scheduledAt || post.platform?.publishedAt)) return;
        if (post.id !== id) throw new Error("Artifact ID differs from calendar path");
        const result = await syncPostIndex(shop, post);
        if (result.ok) report.indexed++;
        else report.failures.push(`${id}: ${result.reason}`);
      }).catch(() => report.failures.push(`${id}: calendar refresh unavailable`));
    }
    if (paths.length > 62) report.failures.push("Some dated posts need another calendar refresh");
  } catch { report.failures.push("Social calendar could not be refreshed from source files"); }
  return report;
}
