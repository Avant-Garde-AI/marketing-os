import type { Metadata } from "next";
import { runWithTenant } from "@/lib/tenant-context";
import { loadCampaignDetail } from "@/lib/email/console-data";
import { listNotes } from "@/lib/email/review-notes";
import { emailPreviewLink, emailSheetLink, ttlRemaining, verifyLink } from "@/lib/email/review-links";
import { EmailFrame, ReviewNotes } from "@/components/review/email-review";

/**
 * The review room (spec 25) — one campaign, everything a reviewer needs to
 * judge it, at a URL you can paste to someone who has never logged into the
 * console.
 *
 * WHY THIS EXISTS SEPARATELY from /email/campaigns/[id]: that page is the
 * operator's view and sits behind Supabase auth. Review is a different job
 * done by different people — often people without console accounts — and the
 * raw /api/email/preview route gives them the email with no subject line, no
 * send date, no reason. This page is the email WITH its context.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: approve. A valid token proves someone has
 * the link; it says nothing about who they are. Approval keeps its own path
 * through Slack, where the click carries a real user id into the audit trail.
 * The room shows approval STATE and stops there.
 *
 * Public by token, exempt from the console's auth middleware — same posture as
 * /api/email/preview/, /brand/ and the design-surface exports.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campaign review",
  // A review link travels through Slack and email. Keep it out of indexes.
  robots: { index: false, follow: false },
};

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function when(at: string | null | undefined): string | null {
  if (!at) return null;
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A dead end a human can act on, rather than a JSON blob. */
function Gate({ headline, sub }: { headline: string; sub: string }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-8">
      <div className="max-w-[440px] text-center">
        <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-ink-3">
          Campaign review
        </div>
        <h1 className="font-display text-[26px] leading-snug">{headline}</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

export default async function EmailReviewPage({ params, searchParams }: Params) {
  const { id } = await params;
  const sp = await searchParams;
  const shop = one(sp.shop) ?? process.env.SHOPIFY_STORE_URL ?? "";
  const token = one(sp.t);
  const exp = one(sp.e);

  if (!shop) {
    return <Gate headline="This link is incomplete." sub="It's missing the store it belongs to. Ask for a fresh review link." />;
  }

  const verdict = verifyLink("review", shop, id, token, exp);
  if (verdict === "expired") {
    return (
      <Gate
        headline="This review link has expired."
        sub="Review links are deliberately short-lived so they can't outlive the campaign they point at. Ask for a fresh one — it takes a second to mint."
      />
    );
  }
  if (verdict !== "ok") {
    return (
      <Gate
        headline="This link isn't valid."
        sub="It may have been truncated on its way to you — links break when they wrap in chat. Try copying the whole URL, or ask for a new one."
      />
    );
  }

  const storeSlug = shop.replace(/\.myshopify\.com$/, "");
  const { detail, notes } = await runWithTenant({ shop, storeSlug }, async () => ({
    detail: await loadCampaignDetail(id),
    notes: await listNotes(id),
  }));

  if (!detail) {
    return <Gate headline="No campaign lives here." sub="It may have been renamed or removed since this link was made." />;
  }

  const { row, artifact, audit, pending } = detail;
  const subject = artifact?.subject ?? row?.subject ?? `Campaign ${id}`;
  const status = row?.status ?? artifact?.status ?? "proposed";
  const archetype = row?.archetype ?? artifact?.archetype ?? null;
  const scheduledAt = row?.scheduledAt ?? artifact?.scheduledAt ?? null;
  const month = row?.calendarMonth ?? (scheduledAt ?? "").slice(0, 7);

  // Inherit the remaining life of THIS link rather than minting a fresh one —
  // otherwise the room becomes a token-refresh oracle and the expiry is theatre.
  const ttl = ttlRemaining(exp);
  const preview = emailPreviewLink(shop, id, ttl);
  const sheet = month ? emailSheetLink(shop, month, ttl) : null;

  const slots = (artifact?.sections ?? []).map((s) => s.slot).filter(Boolean);
  const sent = status === "sent" || status === "measured";

  return (
    <div className="px-6 py-10 md:px-8">
      <div className="mx-auto max-w-[860px]">
        {/* Masthead */}
        <div className="mb-8 border-b border-hairline pb-6">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-ink-3">
            <span>Campaign review</span>
            {archetype && <span>· {archetype}</span>}
            <span className="rounded-none border border-hairline px-2 py-0.5">{status}</span>
          </div>
          <h1 className="font-display text-[30px] leading-[1.15]">{subject}</h1>
          {artifact?.previewText && (
            <p className="mt-2 text-[15px] text-ink-2">{artifact.previewText}</p>
          )}
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13.5px] text-ink-2">
            {when(scheduledAt) && (
              <span>
                <span className="text-ink-3">{sent ? "Sent" : "Sends"} </span>
                {when(scheduledAt)}
              </span>
            )}
            {sheet && (
              <a href={sheet.url} className="arrow-link text-[13.5px]">
                See the whole month
              </a>
            )}
          </div>
        </div>

        {/* Where it is in the gate — state only, never a control. */}
        {pending.length > 0 ? (
          <div className="mb-8 border border-gold-line bg-gold-quiet px-5 py-4">
            {pending.map((p) => (
              <p key={p.id} className="text-[14px] leading-relaxed">
                <span className="font-medium">Waiting for approval in Slack.</span> {p.summary}
              </p>
            ))}
          </div>
        ) : (
          !sent && (
            <div className="mb-8 border border-hairline bg-raised px-5 py-4 text-[14px] leading-relaxed text-ink-2">
              Nothing has been staged or sent. This campaign goes nowhere until
              someone approves it in Slack — notes left here shape it first.
            </div>
          )
        )}

        {/* The email itself */}
        <section className="mb-10">
          <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-3">
            The email
          </h2>
          <EmailFrame src={preview.url} subject={subject} />
          <p className="mt-2 text-[11.5px] text-ink-3">
            Rendered from the campaign&apos;s own artifacts — what the ESP will
            receive, before the ESP has it. This link stops working{" "}
            {new Date(preview.expiresAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
            .
          </p>
        </section>

        {/* Why — the reviewer's real question */}
        {(artifact?.body || (artifact?.provenance.length ?? 0) > 0) && (
          <section className="mb-10">
            <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Why this campaign
            </h2>
            {artifact?.body && (
              <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-2">
                {artifact.body}
              </div>
            )}
            {artifact && artifact.provenance.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-hairline pt-4">
                {artifact.provenance.map((p, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-[13.5px]">
                    <span className="w-14 shrink-0 text-[10px] uppercase tracking-[0.14em] text-ink-3">
                      {p.origin}
                    </span>
                    <span className="text-ink-2">{p.claim}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Audience — the other thing reviewers check */}
        {(artifact?.audience.included.length ?? 0) > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Who receives it
            </h2>
            <ul className="space-y-2.5">
              {artifact!.audience.included.map((a, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[14px]">
                  <span className="min-w-0 flex-1">
                    {/* A bare id is unreviewable — say so rather than printing
                        the code and letting the reader assume it means
                        something. */}
                    {a.name ? (
                      <span>{a.name}</span>
                    ) : (
                      <span className="text-ink-2">
                        Unresolved {a.type} <span className="font-mono text-[12.5px]">{a.id}</span>
                      </span>
                    )}
                    <span className="ml-2 text-[11.5px] uppercase tracking-[0.12em] text-ink-3">
                      {a.type}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-[13px] text-ink-2">
                      {a.estimatedSize != null ? `~${a.estimatedSize.toLocaleString()}` : "size unknown"}
                    </span>
                    {a.sizeAsOf && (
                      <span className="block text-[11px] text-ink-3">as of {a.sizeAsOf}</span>
                    )}
                  </span>
                </li>
              ))}
              {(() => {
                const sized = artifact!.audience.included.filter((a) => a.estimatedSize != null);
                if (sized.length < 2) return null;
                const total = sized.reduce((n, a) => n + (a.estimatedSize ?? 0), 0);
                return (
                  <li className="border-t border-hairline pt-2 text-[13px] text-ink-2">
                    <span className="tnum">~{total.toLocaleString()}</span> across {sized.length} audiences
                    <span className="text-ink-3"> — before overlap and exclusions</span>
                  </li>
                );
              })()}
              {artifact!.audience.excluded.length > 0 && (
                <li className="border-t border-hairline pt-2 text-[13px] text-ink-3">
                  Excluding:{" "}
                  {artifact!.audience.excluded
                    .map((a) => a.name ?? a.key ?? a.id)
                    .filter(Boolean)
                    .join(", ")}
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Notes */}
        <section className="mb-10">
          <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-3">Notes</h2>
          <ReviewNotes
            campaignId={id}
            shop={shop}
            token={token ?? ""}
            exp={exp ?? ""}
            initial={notes}
            slots={slots}
          />
        </section>

        {/* What has actually happened to it */}
        {audit.length > 0 && (
          <section className="border-t border-hairline pt-6">
            <h2 className="mb-3 text-[10px] uppercase tracking-[0.14em] text-ink-3">Record</h2>
            <ul className="space-y-2">
              {audit.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 text-[13.5px]">
                  <span className="tnum w-32 shrink-0 text-[12px] text-ink-3">
                    {a.at
                      ? new Date(a.at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })
                      : ""}
                  </span>
                  <span className="text-ink-2">
                    {a.kind} — {a.outcome} · {a.actor}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
