import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader, Chip, SectionCard, EmptyState } from "@/components/primitives";
import { getTenant } from "@/lib/tenant-context";
import { loadPost } from "@/lib/social/console-data";

/**
 * Social post detail (spec 24 §6): the post spec as the human reads it — the
 * copy, the why (rationale prose + provenance-tagged claims), the assets, and
 * — when the SM1 pipeline has bound a Design Surface — the door into the
 * embedded Design Studio. Read-only in SM0.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (status === "published" || status === "measured") return "filled";
  if (status === "approved" || status === "asset_ready" || status === "scheduled")
    return "attention";
  return "outline";
}

/** owner claims read as decisions, data claims as evidence, agent as proposal. */
function originVariant(origin: string): "filled" | "outline" | "attention" {
  if (origin === "owner") return "filled";
  if (origin === "data") return "attention";
  return "outline";
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function SocialPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next delivers route params already URL-decoded; loadPost rejects bad ids.
  const { id } = await params;
  const { shop } = getTenant();
  const detail = await loadPost(shop, id);

  if (!detail) {
    return (
      <div className="px-8 py-10">
        <div className="mx-auto max-w-[860px]">
          <PageHeader eyebrow="Social" title="Post not found" />
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  No post lives at this address<span className="italic"> — anymore, or yet.</span>
                </>
              }
              action={
                <Link href="/social" className="arrow-link text-[15px]">
                  Back to the calendar
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const { post, studioPath } = detail;
  const month = post.scheduledAt?.slice(0, 7);
  const when = post.scheduledAt
    ? new Date(post.scheduledAt).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[860px]">
        <div className="animate-enter mb-2">
          <Link
            href={month ? `/social?month=${month}` : "/social"}
            className="text-[13px] text-ink-3 transition-colors duration-[160ms] hover:text-gold"
          >
            ← Back to the calendar
          </Link>
        </div>

        <PageHeader
          eyebrow="Social — Post"
          title={
            <>
              {titleCase(post.channel)}
              {when && <span className="italic">, {when}</span>}
            </>
          }
          sub={`Post ${post.id}`}
        />

        {/* Status line */}
        <div className="animate-enter-2 mb-6 flex flex-wrap items-center gap-2">
          <Chip variant={statusVariant(post.status)}>{post.status.replace(/_/g, " ")}</Chip>
          {post.copyFormulaRef && <Chip variant="outline">formula: {post.copyFormulaRef}</Chip>}
          <a
            href={post.targetLink}
            target="_blank"
            rel="noreferrer"
            className="arrow-link ml-1 text-[13.5px]"
          >
            {post.targetLink}
          </a>
        </div>

        <div className="animate-enter-2 space-y-6">
          {/* The copy — the artifact itself, quoted */}
          <SectionCard title="The copy">
            <blockquote className="whitespace-pre-wrap border-l-2 border-gold pl-4 font-display text-[17px] leading-relaxed">
              {post.copy}
            </blockquote>
          </SectionCard>

          {/* The why — rationale prose + provenance-tagged claims */}
          <SectionCard title="Why this post">
            {post.body ? (
              <div className="text-[14.5px] leading-relaxed text-ink-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-ink-3">No rationale recorded.</p>
            )}
            {post.provenance.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-hairline pt-4">
                {post.provenance.map((p, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-[13.5px]">
                    <Chip variant={originVariant(p.origin)}>{p.origin}</Chip>
                    <span className="text-ink-2">{p.claim}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* The creative */}
          <SectionCard
            title="Creative"
            action={
              studioPath ? (
                <Link href={studioPath} className="arrow-link text-[14px]">
                  Open in Studio
                </Link>
              ) : undefined
            }
          >
            {post.assetRefs.length > 0 ? (
              <ul className="space-y-1.5">
                {post.assetRefs.map((ref) => (
                  <li key={ref} className="tnum text-[13.5px] text-ink-2">
                    {ref}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">
                No assets yet — the asset pipeline composes this post&apos;s creative on a
                Design Surface and its exports land here.
              </p>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
