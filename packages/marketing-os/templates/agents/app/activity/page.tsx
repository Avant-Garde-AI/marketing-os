import Link from "next/link";
import { PageHeader, Chip, EmptyState, SectionCard } from "@/components/primitives";

/**
 * Activity — the hairline timeline (spec 13 §4). Agent work, day-grouped,
 * each entry linking out to its artifact. Status carried by wording + fill,
 * never traffic-light colors.
 */

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface Entry {
  ts: string;
  title: string;
  url: string;
  number: number;
  status: "In practice" | "Needs review" | "Closed";
}

async function getEntries(): Promise<Entry[] | null> {
  if (!GITHUB_REPO || !GITHUB_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=all&labels=marketing-os&per_page=30&sort=updated&direction=desc`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` }, next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const prs = await res.json();
    if (!Array.isArray(prs)) return null;
    return prs.map((pr) => ({
      ts: pr.merged_at ?? pr.updated_at ?? pr.created_at,
      title: pr.title as string,
      url: pr.html_url as string,
      number: pr.number as number,
      status: pr.merged_at ? "In practice" : pr.state === "open" ? "Needs review" : "Closed",
    }));
  } catch {
    return null;
  }
}

function groupByDay(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = new Date(e.ts).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return groups;
}

export default async function ActivityPage() {
  const entries = await getEntries();
  const groups = entries ? groupByDay(entries) : null;

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="In practice"
          title="Activity"
          sub="Everything your agents have shipped, proposed, or retired."
        />

        <div className="animate-enter-2">
          {entries === null ? (
            <SectionCard title="Not connected">
              <p className="text-sm text-ink-2">
                Connect GitHub to see agent activity. Every change lands as a
                reviewable record — nothing ships silently.
              </p>
            </SectionCard>
          ) : entries.length === 0 ? (
            <div className="border border-hairline bg-raised">
              <EmptyState
                headline={
                  <>
                    Nothing yet. Every action your agents take lands here —{" "}
                    <span className="italic">in practice.</span>
                  </>
                }
                action={
                  <Link href="/chat" className="arrow-link text-[15px]">
                    Ask for a change
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="space-y-10">
              {[...groups!.entries()].map(([day, items]) => (
                <section key={day}>
                  <h2 className="mb-3 font-body text-[13px] font-medium uppercase tracking-[0.1em] text-ink-3">
                    {day}
                  </h2>
                  <ul className="border-l border-hairline">
                    {items.map((e) => (
                      <li key={`${e.number}-${e.ts}`} className="relative pl-6">
                        <span className="absolute left-[-2.5px] top-[1.35rem] h-1 w-1 bg-gold" />
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-baseline gap-4 py-3.5 transition-colors duration-[160ms] hover:text-gold"
                        >
                          <span className="tnum shrink-0 text-xs text-ink-3">
                            {new Date(e.ts).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="flex-1 text-[15px] leading-snug">
                            {e.title}
                            <span className="tnum ml-2 text-xs text-ink-3">#{e.number}</span>
                          </span>
                          <Chip variant={e.status === "In practice" ? "filled" : e.status === "Needs review" ? "attention" : "outline"}>
                            {e.status}
                          </Chip>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
