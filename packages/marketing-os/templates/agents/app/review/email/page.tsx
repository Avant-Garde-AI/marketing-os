import type { Metadata } from "next";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns, parseCampaignArtifact, type CampaignArtifact } from "@/lib/email/console-data";
import { emailRepo } from "@/lib/email/repo";
import { countNotes } from "@/lib/email/review-notes";
import { heroImageUrl } from "@/lib/email/hero";
import { emailReviewLink, ttlRemaining, verifyLink } from "@/lib/email/review-links";

/**
 * The contact sheet (spec 25) — a month of email on one page.
 *
 * This is the link a planning session hands over: one URL for the whole month
 * instead of five, so a team scans the shape of the calendar (rhythm, mix of
 * archetypes, whether three sends in a row look identical) before anyone opens
 * a single campaign. Reviewing emails one at a time hides exactly the problems
 * that only show up in sequence.
 *
 * Public by token, same posture as the review room. Reads only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Email — month in review",
  robots: { index: false, follow: false },
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function one(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayLabel(at: string | null): string {
  if (!at) return "unscheduled";
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Gate({ headline, sub }: { headline: string; sub: string }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-8">
      <div className="max-w-[440px] text-center">
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-ink-3">
          Email — month in review
        </div>
        <h1 className="font-display text-[26px] leading-snug">{headline}</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

export default async function EmailSheetPage({
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
    return <Gate headline="This link is incomplete." sub="It's missing the store or the month. Ask for a fresh one." />;
  }

  const verdict = verifyLink("sheet", shop, month, token, exp);
  if (verdict === "expired") {
    return (
      <Gate
        headline="This link has expired."
        sub="Review links are short-lived by design so they can't outlive the campaigns they point at. Ask for a fresh one."
      />
    );
  }
  if (verdict !== "ok") {
    return (
      <Gate
        headline="This link isn't valid."
        sub="It may have been truncated on its way to you — links break when they wrap in chat. Try copying the whole URL."
      />
    );
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const ttl = ttlRemaining(exp);

  const cards = await runWithTenant({ shop, storeSlug }, async () => {
    const all = await listCampaigns();
    const inMonth = all
      .filter((c) => c.calendarMonth === month)
      .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999"));

    const counts = await countNotes(inMonth.map((c) => c.id));

    return Promise.all(
      inMonth.map(async (c) => {
        // The artifact carries the sections, and the sections carry the hero.
        let artifact: CampaignArtifact | null = null;
        try {
          const raw = await emailRepo.readFile(`email/campaigns/${c.id}/campaign.md`);
          artifact = raw === null ? null : parseCampaignArtifact(raw);
        } catch {
          artifact = null; // degrade to a text-only card
        }
        return {
          row: c,
          hero: heroImageUrl(artifact?.sections),
          previewText: artifact?.previewText ?? null,
          link: emailReviewLink(shop, c.id, ttl).url,
          notes: counts.get(c.id) ?? { total: 0, open: 0 },
        };
      }),
    );
  });

  return (
    <div className="px-6 py-10 md:px-8">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-8 border-b border-hairline pb-6">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-ink-3">
            Email — month in review
          </div>
          <h1 className="font-display text-[30px] leading-[1.15]">{monthLabel(month)}</h1>
          <p className="mt-2 text-[14.5px] text-ink-2">
            {cards.length} {cards.length === 1 ? "campaign" : "campaigns"}. Open any one to see
            it rendered and leave notes. Nothing here has been sent — approval happens in Slack.
          </p>
        </div>

        {cards.length === 0 ? (
          <p className="text-[14.5px] text-ink-2">Nothing planned for this month yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ row, hero, previewText, link, notes }) => (
              <li key={row.id} className="border border-hairline bg-raised">
                <a href={link} className="group block">
                  <div className="aspect-[4/3] overflow-hidden bg-[#f2efe9]">
                    {hero ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={hero}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[12px] text-ink-3">
                        no imagery yet
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="mb-1.5 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-3">
                      <span className="tnum">{dayLabel(row.scheduledAt)}</span>
                      <span>· {row.archetype}</span>
                      <span className="ml-auto">{row.status}</span>
                    </div>
                    <div className="font-display text-[16.5px] leading-snug">
                      {row.subject ?? row.id}
                    </div>
                    {previewText && (
                      <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{previewText}</p>
                    )}
                    {notes.total > 0 && (
                      <p className="mt-2 text-[12px] text-ink-3">
                        {notes.open > 0
                          ? `${notes.open} open ${notes.open === 1 ? "note" : "notes"}`
                          : `${notes.total} ${notes.total === 1 ? "note" : "notes"}, all handled`}
                      </p>
                    )}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
