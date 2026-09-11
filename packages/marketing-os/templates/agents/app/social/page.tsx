import Link from "next/link";
import { PageHeader, Chip, EmptyState } from "@/components/primitives";
import { CopyLink } from "@/components/copy-link";
import { getTenant } from "@/lib/tenant-context";
import { listCalendarMonths, loadCalendar } from "@/lib/social/console-data";
import { socialSheetLink } from "@/lib/social/review-links";
import { postMonth } from "@/lib/social/projection";
import { listPostIds, parsePost, postPath } from "@/lib/social/artifacts";
import { socialRepo } from "@/lib/social/repo";
import type { SocialPost } from "@/lib/social/types";

/**
 * Social — the worklist.
 *
 * This page used to render its own month grid, which made two calendars for
 * one business: /calendar already reads mos_calendar_items across every
 * channel, and social has written into it since SM2. Two grids of the same
 * month is not redundancy, it is a question about which one is right — and the
 * cross-channel one is, because a month of social only makes sense next to the
 * email going out around it.
 *
 * So this mirrors /email instead: the staged work as a list, each item with its
 * status and a door into its detail, plus one shareable link per month. Email
 * arrived at that shape by use, and social's workflow is the same shape —
 * things get staged, someone reads them, someone approves.
 *
 * Files are truth: the calendar names the slots, the post artifacts say what
 * would actually ship, and this reads both rather than a projection that could
 * drift from either.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const PLAN_PROMPT =
  "Plan next month's social calendar from our strategy and show me the proposal.";

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The day a post is FOR — scheduled if it has a time, else the slot it fills. */
function dayLabel(scheduledAt: string | null | undefined, fallbackSlot: string | null): string {
  const iso = (scheduledAt ?? "").slice(0, 10) || fallbackSlot || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** First line of the copy — what someone scanning the month actually needs. */
function headline(post: SocialPost): string {
  const first = (post.copy ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return first || `Post ${post.id}`;
}

/** Same three-state reading as email: done, in motion, still a draft. */
function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (status === "published") return "filled";
  if (status === "approved" || status === "scheduled" || status === "asset_ready") return "attention";
  return "outline";
}

interface Row {
  post: SocialPost;
  slot: string | null;
  pillar: string | null;
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { shop } = getTenant();

  // Enumerate POSTS, then enrich from the calendar — never the other way round.
  // Walking the calendar means a post nobody scheduled does not exist as far as
  // this page is concerned: four composed posts with design surfaces sat
  // invisible for a week because their month had no calendar file, and a fifth
  // was orphaned by a slot that never referenced it. A post is a real artifact
  // whether or not anything points at it, and a worklist that hides work is
  // worse than no worklist.
  const ids = await listPostIds(socialRepo);
  const posts: SocialPost[] = [];
  for (const id of ids) {
    try {
      const raw = await socialRepo.readFile(postPath(id));
      if (raw !== null) posts.push(parsePost(raw));
    } catch {
      // A post that will not parse is the detail page's problem to explain.
      // Dropping it beats failing the whole list over one bad artifact.
    }
  }

  const requested = Array.isArray(sp.month) ? sp.month[0] : sp.month;

  const byMonth = new Map<string, Row[]>();
  for (const post of posts) {
    const month = postMonth(post);
    if (requested && MONTH_RE.test(requested) && month !== requested) continue;
    const rows = byMonth.get(month) ?? [];
    rows.push({ post, slot: null, pillar: null });
    byMonth.set(month, rows);
  }

  // The calendar contributes the slot and its pillar where it references a
  // post. A post it does not mention keeps a null slot and shows as
  // unscheduled, which is a true statement about it rather than a disappearance.
  for (const month of byMonth.keys()) {
    if (!MONTH_RE.test(month)) continue;
    const calendar = await loadCalendar(shop, month);
    if (!calendar) continue;
    const slotByPost = new Map(
      calendar.slots.filter((s) => s.postId).map((s) => [s.postId!, s]),
    );
    for (const row of byMonth.get(month) ?? []) {
      const slot = slotByPost.get(row.post.id);
      if (slot) {
        row.slot = slot.slot;
        row.pillar = slot.pillar ?? null;
      }
    }
  }

  for (const [month, rows] of byMonth) {
    rows.sort(
      (a, b) =>
        (a.slot ?? a.post.scheduledAt ?? a.post.id).localeCompare(
          b.slot ?? b.post.scheduledAt ?? b.post.id,
        ),
    );
    if (!rows.length) byMonth.delete(month);
  }

  const staged = [...byMonth.keys()];

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Social"
          title={
            <>
              Posts, <span className="italic">accounted for.</span>
            </>
          }
          sub="Every staged post with its pillar, its channel, and its record — planned in chat, reviewed by you, published on approval."
        />

        {staged.length === 0 ? (
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  Nothing staged yet. Ask your marketing agent to plan{" "}
                  <span className="italic">a month of social.</span>
                </>
              }
              sub="The agent lays out slots from your social strategy — cadence per channel, pillars rotated by weight — then writes the posts that fill them."
              action={
                <Link href={`/chat?prompt=${encodeURIComponent(PLAN_PROMPT)}`} className="arrow-link text-[15px]">
                  Plan a month
                </Link>
              }
            />
          </div>
        ) : (
          <div className="animate-enter-2 space-y-8">
            {staged.map((month) => (
              <section key={month}>
                <div className="mb-3 flex items-baseline gap-4">
                  <h2 className="font-display text-[20px]">{monthLabel(month)}</h2>
                  <Link href={`/calendar?month=${month}`} className="arrow-link text-[13px]">
                    On the calendar
                  </Link>
                  <a
                    href={socialSheetLink(shop, month).url}
                    target="_blank"
                    rel="noreferrer"
                    className="arrow-link text-[13px]"
                  >
                    Open the review sheet
                  </a>
                </div>
                {/* One link for the whole month. Per-post links are the right
                    shape for discussing one post and the wrong one for
                    circulating a month — that was the lesson from email. */}
                <div className="mb-3">
                  <CopyLink
                    url={socialSheetLink(shop, month).url}
                    label={`Share ${monthLabel(month)} for review`}
                  />
                </div>
                <ul className="divide-y divide-hairline border border-hairline bg-raised">
                  {byMonth.get(month)!.map(({ post, slot, pillar }) => (
                    <li key={post.id}>
                      <Link
                        href={`/social/posts/${encodeURIComponent(post.id)}`}
                        className="group flex items-baseline gap-4 px-5 py-3.5 transition-colors duration-[160ms] hover:bg-gold-quiet/60"
                      >
                        <span className="tnum w-20 shrink-0 text-xs text-ink-3">
                          {dayLabel(post.scheduledAt, slot)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-snug">{headline(post)}</span>
                          <span className="mt-0.5 block text-[12px] text-ink-3">
                            {post.channel}
                            {pillar ? ` · ${pillar}` : ""}
                          </span>
                        </span>
                        <Chip variant={statusVariant(post.status)}>{post.status}</Chip>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
