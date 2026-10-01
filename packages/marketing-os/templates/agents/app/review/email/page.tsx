import type { Metadata } from "next";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns, parseCampaignArtifact, type CampaignArtifact } from "@/lib/email/console-data";
import { emailRepo } from "@/lib/email/repo";
import { countNotes } from "@/lib/email/review-notes";
import { heroImageUrl } from "@/lib/email/hero";
import { emailReviewLink, ttlRemaining, verifyLink } from "@/lib/email/review-links";
import { nextGateStep } from "@/lib/email/next-step";
import { SheetGrid, type SheetCard } from "@/components/review/sheet-grid";

/**
 * The contact sheet (spec 25) — a month of email on one page.
 *
 * This is the link a planning session hands over: one URL for the whole month
 * instead of five, so a team scans the shape of the calendar (rhythm, mix of
 * archetypes, whether three sends in a row look identical) before anyone opens
 * a single campaign. Reviewing emails one at a time hides exactly the problems
 * that only show up in sequence.
 *
 * Public by token, same posture as the review room. Reads, plus one request:
 * selected campaigns can have their next approval card sent to Slack.
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
          // The artifact is the truth; the index row lags it after an approval.
          status: artifact?.status ?? c.status,
          scheduledAt: artifact?.scheduledAt ?? c.scheduledAt,
          link: emailReviewLink(shop, c.id, ttl).url,
          notes: counts.get(c.id) ?? { total: 0, open: 0 },
        };
      }),
    );
  });

  const sheetCards: SheetCard[] = cards.map(({ row, hero, previewText, link, notes, status, scheduledAt }) => {
    const step = nextGateStep({ id: row.id, status, scheduledAt });
    return {
      id: row.id,
      link,
      hero,
      day: dayLabel(scheduledAt),
      archetype: row.archetype,
      status,
      subject: row.subject ?? row.id,
      previewText,
      notes,
      step: step.ok ? { ok: true, label: step.label } : { ok: false, reason: step.reason },
    };
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
            it rendered and leave notes. Select campaigns to send their approval cards to Slack —
            approving still happens there or in the console.
          </p>
        </div>

        {cards.length === 0 ? (
          <p className="text-[14.5px] text-ink-2">Nothing planned for this month yet.</p>
        ) : (
          <SheetGrid cards={sheetCards} shop={shop} month={month} token={token} exp={exp} />
        )}
      </div>
    </div>
  );
}
