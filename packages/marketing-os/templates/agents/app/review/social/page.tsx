/**
 * The social month sheet — every post group planned for a month
 * (spec 26 ⟨BUILD⟩ 2).
 *
 * A contact sheet, not a room: scan the month, see where the register drifts,
 * then open the group that needs discussion. Per D7 the sheet carries note
 * COUNTS only (one grouped query, never a per-card lookup) — composing a note
 * stays in the room, where the whole group is visible.
 */

import { loadCalendar } from "@/lib/social/console-data";
import { socialReviewLink, ttlRemaining, verifyLink } from "@/lib/social/review-links";
import { groupKey, groupPosts, postThumbnailUrl } from "@/lib/social/projection";
import { parsePost, postPath } from "@/lib/social/artifacts";
import { socialRepo } from "@/lib/social/repo";
import { countNotes } from "@/lib/review/notes";
import { runWithTenant } from "@/lib/tenant-context";
import type { SocialPost } from "@/lib/social/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const SOCIAL_PACK_ID = "social-media";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function one(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function Gate({ headline, sub }: { headline: string; sub: string }) {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.15rem", marginBottom: "0.5rem" }}>{headline}</h1>
      <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{sub}</p>
    </main>
  );
}

export default async function SocialMonthSheet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const shop = one(sp.shop) ?? process.env.SHOPIFY_STORE_URL ?? "";
  const month = one(sp.month) ?? "";
  const token = one(sp.t);
  const exp = one(sp.e);

  if (!shop || !MONTH_RE.test(month)) {
    return <Gate headline="This link is incomplete" sub="It is missing the store or the month. Ask for a fresh link." />;
  }
  const verdict = verifyLink("sheet", shop, month, token, exp);
  if (verdict === "expired") {
    return (
      <Gate
        headline="This review link has expired"
        sub="Review links are time-limited on purpose. Ask whoever shared it for a new one."
      />
    );
  }
  if (verdict !== "ok") {
    return <Gate headline="This link isn’t valid" sub="Check you copied the whole URL, or ask for a fresh link." />;
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const publicUrl = (process.env.MOS_AGENTS_PUBLIC_URL ?? "").replace(/\/$/, "");
  const ttl = ttlRemaining(exp);

  const { groups, counts, unreadable } = await runWithTenant({ shop, storeSlug }, async () => {
    // Read from the CALENDAR (the month's plan), then the artifacts it points
    // at — files are truth, so the sheet shows what would actually ship.
    const calendar = await loadCalendar(shop, month);
    const ids = [...new Set((calendar?.slots ?? []).map((s) => s.postId).filter((v): v is string => !!v))];
    const posts: SocialPost[] = [];
    let bad = 0;
    for (const id of ids) {
      try {
        const raw = await socialRepo.readFile(postPath(id));
        if (raw === null) continue;
        posts.push(parsePost(raw));
      } catch {
        bad++;
      }
    }
    const grouped = groupPosts(posts);
    return {
      groups: grouped,
      counts: await countNotes(SOCIAL_PACK_ID, grouped.map((g) => g.key)),
      unreadable: bad,
    };
  });

  return (
    <main style={{ maxWidth: 1200, margin: "2.5rem auto 5rem", padding: "0 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ marginBottom: "1.75rem" }}>
        <p style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6, margin: 0 }}>
          Social · month sheet
        </p>
        <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0 0" }}>{month}</h1>
      </header>

      {unreadable > 0 && (
        <p role="alert" style={{ color: "#a11", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
          {unreadable} post(s) planned this month could not be read and are not shown.
        </p>
      )}

      {groups.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          Nothing is planned for {month} yet — or the month&rsquo;s calendar has no posts attached to its slots.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {groups.map(({ key, posts }) => {
            const lead = posts[0]!;
            const src = postThumbnailUrl(lead, publicUrl);
            const n = counts.get(key);
            const when = posts.find((p) => p.scheduledAt)?.scheduledAt;
            return (
              <a
                key={key}
                href={socialReviewLink(shop, key, ttl).url}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 8,
                  overflow: "hidden",
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block", background: "#f4f2ef" }} />
                ) : (
                  <div style={{ aspectRatio: "1 / 1", background: "#f4f2ef", display: "grid", placeItems: "center", fontSize: "0.8rem", opacity: 0.6 }}>
                    No creative yet
                  </div>
                )}
                <div style={{ padding: "0.7rem 0.85rem" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                    {when ? new Date(when).toLocaleDateString() : "unscheduled"}
                    {posts.length > 1 ? ` · ${posts.length} variants` : ` · ${lead.channel}`}
                  </div>
                  <div style={{ fontSize: "0.88rem", marginTop: "0.3rem", lineHeight: 1.4 }}>
                    {(lead.copy.split("\n").find((l) => l.trim()) ?? key).slice(0, 90)}
                  </div>
                  <div style={{ fontSize: "0.75rem", marginTop: "0.45rem", opacity: 0.7 }}>
                    {lead.status}
                    {n && n.total > 0 ? ` · ${n.open} open / ${n.total} note${n.total === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: "0.75rem", opacity: 0.55, marginTop: "2.5rem" }}>
        This link works for about {ttl} more day{ttl === 1 ? "" : "s"}. Notes are left inside a group.
      </p>
    </main>
  );
}
