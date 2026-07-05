import Link from "next/link";
import { createShopifyClient } from "@/lib/shopify";
import {
  PageHeader,
  StatTile,
  SectionCard,
  Chip,
  EmptyState,
} from "@/components/primitives";

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface PrItem {
  number: number;
  title: string;
  url: string;
  merged_at?: string | null;
  state?: string;
}

async function getOrderCount(): Promise<number | null> {
  try {
    const shopify = createShopifyClient();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const data = await shopify.rest<{ count: number }>(
      `orders/count.json?status=any&created_at_min=${encodeURIComponent(since)}`
    );
    return data.count;
  } catch {
    return null;
  }
}

async function getPrs(state: "open" | "closed"): Promise<PrItem[] | null> {
  if (!GITHUB_REPO || !GITHUB_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=${state}&labels=marketing-os&per_page=8&sort=updated&direction=desc`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` }, next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const prs = await res.json();
    if (!Array.isArray(prs)) return null;
    return prs.map((pr: PrItem & { html_url: string }) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      merged_at: pr.merged_at,
      state: pr.state,
    }));
  } catch {
    return null;
  }
}

export default async function Overview() {
  const [orderCount, openPrs, closedPrs] = await Promise.all([
    getOrderCount(),
    getPrs("open"),
    getPrs("closed"),
  ]);

  const merged = (closedPrs ?? []).filter((pr) => pr.merged_at);

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Marketing OS"
          title="Overview"
          sub="Your store, your agents, and what needs your attention."
        />

        {/* By the numbers */}
        <div className="animate-enter-2 mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Orders"
            value={orderCount}
            note={orderCount !== null ? "Last 7 days" : "Store connection unavailable"}
          />
          <StatTile
            label="Needs review"
            value={openPrs ? openPrs.length : null}
            note={
              openPrs === null
                ? "Connect GitHub to track changes"
                : openPrs.length === 0
                  ? "Nothing waiting on you"
                  : "Agent changes awaiting review"
            }
          />
          <StatTile
            label="Published"
            value={closedPrs === null ? null : merged.length}
            note={closedPrs === null ? "Connect GitHub to track changes" : "Recent agent changes, live"}
          />
          <StatTile
            label="Playbooks"
            value={3}
            note="Ready to run"
          />
        </div>

        {/* The two panels that earn the page */}
        <div className="animate-enter-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard
            title="Needs your review"
            action={
              openPrs && openPrs.length > 0 ? (
                <a
                  href={`https://github.com/${GITHUB_REPO}/pulls`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="arrow-link text-sm"
                >
                  View all
                </a>
              ) : undefined
            }
          >
            {openPrs === null ? (
              <p className="text-sm text-ink-2">
                Connect GitHub to see agent changes here. Every storefront change your
                agents propose lands as a reviewable pull request.
              </p>
            ) : openPrs.length === 0 ? (
              <EmptyState
                headline={
                  <>
                    Nothing waiting. Ask your agent for a change — it arrives here,{" "}
                    <span className="italic">reviewed before it ships.</span>
                  </>
                }
                action={
                  <Link href="/chat" className="arrow-link text-[15px]">
                    Start in chat
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {openPrs.map((pr) => (
                  <li key={pr.number}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-baseline gap-4 py-3 transition-colors duration-[160ms] hover:text-gold"
                    >
                      <span className="tnum shrink-0 text-xs text-ink-3">#{pr.number}</span>
                      <span className="flex-1 text-[15px] leading-snug">{pr.title}</span>
                      <Chip variant="attention">Needs review</Chip>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Recent activity">
            {closedPrs === null ? (
              <p className="text-sm text-ink-2">
                Once GitHub is connected, published agent changes appear here — in practice.
              </p>
            ) : merged.length === 0 ? (
              <EmptyState
                headline={
                  <>
                    Every action your agents take lands here —{" "}
                    <span className="italic">in practice.</span>
                  </>
                }
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {merged.slice(0, 6).map((pr) => (
                  <li key={pr.number}>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-baseline gap-4 py-3 transition-colors duration-[160ms] hover:text-gold"
                    >
                      <span className="tnum shrink-0 text-xs text-ink-3">
                        {pr.merged_at
                          ? new Date(pr.merged_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </span>
                      <span className="flex-1 text-[15px] leading-snug">{pr.title}</span>
                      <Chip variant="filled">In practice</Chip>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
