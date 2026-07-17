import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader, Chip, SectionCard, EmptyState } from "@/components/primitives";
import { loadCampaignDetail, type SectionView } from "@/lib/email/console-data";

/**
 * Email campaign detail (WS4-R3 / 02 §7): the campaign as the human reviews
 * it — subject + candidates, provenance-tagged claims, the section list with
 * board thumbnails, the audience with estimated sizes, the assembled HTML
 * preview in a sandboxed iframe, the status trail, and the Action gate's
 * records (audit + pending). Read-only: approval lives in Slack for MVP
 * (spec 20 §6 — the console shows state).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public base of this deployment — the env pattern the design-surface and
 * brand-soul tools use to mint hosted render links. */
const PUBLIC_URL = (
  process.env.MOS_AGENTS_PUBLIC_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

function statusVariant(status: string): "filled" | "outline" | "attention" {
  if (status === "sent" || status === "measured") return "filled";
  if (status === "approved" || status === "drafted" || status === "scheduled") return "attention";
  return "outline";
}

/** Provenance origin → chip register: owner claims read as decisions, data
 * claims as evidence, agent claims as proposal (the social detail precedent). */
function originVariant(origin: string): "filled" | "outline" | "attention" {
  if (origin === "owner") return "filled";
  if (origin === "data") return "attention";
  return "outline";
}

function when(at: string | null | undefined): string | null {
  if (!at) return null;
  return new Date(at).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** One-line summary of an html section's renderer-vocabulary blocks. */
function blockSummary(block: Record<string, unknown>): string {
  const type = typeof block.type === "string" ? block.type : "block";
  const text = ["text", "content", "label", "heading"]
    .map((k) => block[k])
    .find((v): v is string => typeof v === "string" && v.length > 0);
  return text ? `${type} — ${text.length > 80 ? `${text.slice(0, 77)}…` : text}` : type;
}

export default async function EmailCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadCampaignDetail(id);

  if (!detail) {
    return (
      <div className="px-8 py-10">
        <div className="mx-auto max-w-[900px]">
          <PageHeader eyebrow="Email" title="Campaign not found" />
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={
                <>
                  No campaign lives at this address<span className="italic"> — anymore, or yet.</span>
                </>
              }
              action={
                <Link href="/email" className="arrow-link text-[15px]">
                  Back to campaigns
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const { row, artifact, surfaces, studioPath, audit, pending } = detail;

  const subject = artifact?.subject ?? row?.subject ?? null;
  const status = row?.status ?? artifact?.status ?? "proposed";
  const archetype = row?.archetype ?? artifact?.archetype ?? null;
  const scheduledAt = row?.scheduledAt ?? artifact?.scheduledAt ?? null;
  const included = artifact?.audience.included.length
    ? artifact.audience.included
    : (row?.audienceRefs ?? []);
  const excluded = artifact?.audience.excluded ?? [];
  const candidates = (artifact?.subjectCandidates ?? []).filter((c) => c !== subject);

  // Assembled-HTML preview, served by the hosted preview route (02 §7 — this
  // deployment's guarded route, like /api/design-surfaces/export/[fileId];
  // built in the hosted-runtime workstream). Ours, not Klaviyo's render
  // endpoint, so previews work pre-draft.
  const previewSrc = `${PUBLIC_URL}/api/email/preview/${encodeURIComponent(id)}`;

  function sectionThumb(s: SectionView): { src: string; local: boolean } | null {
    // Klaviyo-hosted image once the draft Action uploaded it; else a live
    // render of the bound Design Surface board via this deployment's export
    // route. assetPath alone (repo-relative) isn't directly servable.
    if (s.imageUrl) return { src: s.imageUrl, local: false };
    if (s.surfaceId) {
      const link = surfaces.get(s.surfaceId);
      if (link) return { src: link.exportPath, local: true };
    }
    return null;
  }

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[900px]">
        <div className="animate-enter mb-2">
          <Link
            href="/email"
            className="text-[13px] text-ink-3 transition-colors duration-[160ms] hover:text-gold"
          >
            ← Back to campaigns
          </Link>
        </div>

        <PageHeader
          eyebrow="Email — Campaign"
          title={subject ?? `Campaign ${id}`}
          sub={`Campaign ${id}${archetype ? ` · ${archetype}` : ""}`}
        />

        {/* Status line */}
        <div className="animate-enter-2 mb-6 flex flex-wrap items-center gap-2">
          <Chip variant={statusVariant(status)}>{status}</Chip>
          {when(scheduledAt) && <Chip variant="outline">sends {when(scheduledAt)}</Chip>}
          {row?.skeletonRef && (
            <Chip variant="outline">
              skeleton: {row.skeletonRef}
              {row.skeletonVersion != null ? ` v${row.skeletonVersion}` : ""}
            </Chip>
          )}
          {artifact?.copyFormulaRef && (
            <Chip variant="outline">formula: {artifact.copyFormulaRef}</Chip>
          )}
          {studioPath && (
            <Link href={studioPath} className="arrow-link ml-1 text-[13.5px]">
              Open canvas
            </Link>
          )}
        </div>

        {/* Pending Action — waiting on Slack (spec 20 §6; console shows state). */}
        {pending.length > 0 && (
          <div className="animate-enter-2 mb-6 border border-gold-line bg-gold-quiet px-5 py-4">
            {pending.map((p) => (
              <p key={p.id} className="text-[14px] leading-relaxed">
                <span className="font-medium">Waiting for approval in Slack</span> —{" "}
                {p.summary}
                <span className="ml-2 text-[12px] text-ink-3">
                  {p.kind} · {p.risk} risk · proposed {when(p.createdAt)}
                </span>
              </p>
            ))}
          </div>
        )}

        <div className="animate-enter-2 space-y-6">
          {/* Subject + candidates */}
          <SectionCard title="Subject & preview">
            {subject ? (
              <blockquote className="border-l-2 border-gold pl-4">
                <div className="font-display text-[19px] leading-snug">{subject}</div>
                {artifact?.previewText && (
                  <div className="mt-1 text-[14px] text-ink-2">{artifact.previewText}</div>
                )}
              </blockquote>
            ) : (
              <p className="text-sm text-ink-3">No subject chosen yet.</p>
            )}
            {candidates.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-hairline pt-4">
                {candidates.map((c) => (
                  <li key={c} className="text-[14px] text-ink-2">
                    <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-ink-3">
                      candidate
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* The why — rationale prose + provenance-tagged claims */}
          {(artifact?.body || (artifact?.provenance.length ?? 0) > 0) && (
            <SectionCard title="Why this campaign">
              {artifact?.body ? (
                <div className="text-[14.5px] leading-relaxed text-ink-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.body}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-ink-3">No rationale recorded.</p>
              )}
              {artifact && artifact.provenance.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-hairline pt-4">
                  {artifact.provenance.map((p, i) => (
                    <li key={i} className="flex items-baseline gap-3 text-[13.5px]">
                      <Chip variant={originVariant(p.origin)}>{p.origin}</Chip>
                      <span className="text-ink-2">{p.claim}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}

          {/* Sections — surface boards as thumbnails, html as block summaries */}
          <SectionCard
            title="Sections"
            action={
              studioPath ? (
                <Link href={studioPath} className="arrow-link text-[14px]">
                  Open canvas
                </Link>
              ) : undefined
            }
          >
            {artifact && artifact.sections.length > 0 ? (
              <ul className="space-y-4">
                {artifact.sections.map((s, i) => {
                  const thumb = s.type === "surface" ? sectionThumb(s) : null;
                  const sectionStudio = s.surfaceId
                    ? (surfaces.get(s.surfaceId)?.studioPath ?? null)
                    : null;
                  return (
                    <li key={`${s.slot}-${i}`} className="border border-hairline p-4">
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                          {s.slot}
                        </span>
                        <span className="flex items-center gap-3">
                          <Chip variant="outline">{s.type}</Chip>
                          {sectionStudio && (
                            <Link href={sectionStudio} className="arrow-link text-[13px]">
                              Open canvas
                            </Link>
                          )}
                        </span>
                      </div>
                      {s.type === "surface" ? (
                        <>
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb.src}
                              alt={s.alt ?? s.slot}
                              className="max-h-56 border border-hairline object-contain"
                            />
                          ) : (
                            <p className="text-sm text-ink-2">
                              Board not exported yet — its render lands here.
                            </p>
                          )}
                          {s.alt && (
                            <p className="mt-2 text-[12.5px] text-ink-3">alt: {s.alt}</p>
                          )}
                        </>
                      ) : (
                        <ul className="space-y-1">
                          {(s.blocks ?? []).map((b, j) => (
                            <li key={j} className="text-[13.5px] text-ink-2">
                              {blockSummary(b)}
                            </li>
                          ))}
                          {(s.blocks ?? []).length === 0 && (
                            <li className="text-sm text-ink-3">No blocks.</li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">
                No sections yet — the campaign spec&apos;s sections (surface boards + copy
                blocks) appear here once composed.
              </p>
            )}
          </SectionCard>

          {/* Audience */}
          <SectionCard title="Audience">
            {included.length > 0 ? (
              <ul className="space-y-1.5">
                {included.map((a, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-[14px]">
                    <span className="flex-1">
                      {a.name ?? a.key ?? a.id}
                      {a.type && <span className="ml-2 text-[11.5px] text-ink-3">{a.type}</span>}
                    </span>
                    <span className="tnum text-[13px] text-ink-2">
                      {a.estimatedSize != null ? `~${a.estimatedSize.toLocaleString()}` : "—"}
                    </span>
                  </li>
                ))}
                {excluded.length > 0 && (
                  <li className="border-t border-hairline pt-2 text-[13px] text-ink-3">
                    Excluding:{" "}
                    {excluded.map((a) => a.name ?? a.key ?? a.id).filter(Boolean).join(", ")}
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">No audience resolved yet.</p>
            )}
          </SectionCard>

          {/* Assembled HTML preview.
              Sandboxing (WS4 OQ4): sandbox="" strips ALL permissions — no
              scripts, no forms, no same-origin (so the frame can't read the
              console's cookies/DOM) — and referrerPolicy="no-referrer" keeps
              the console URL out of image-request headers. The assembled HTML
              embeds remote images from Klaviyo's CDN: a fully-sandboxed frame
              still loads <img> subresources, but if this console ever ships a
              Content-Security-Policy, frames inherit the EMBEDDED document's
              own policy, not the parent's — so the preview ROUTE (hosted
              runtime) must serve img-src for Klaviyo CDN hosts in ITS headers.
              Confirm the posture with whoever owns console security headers. */}
          <SectionCard
            title="Preview — assembled email"
            action={
              <a href={previewSrc} target="_blank" rel="noreferrer" className="arrow-link text-[14px]">
                Open full size
              </a>
            }
          >
            <iframe
              src={previewSrc}
              sandbox=""
              referrerPolicy="no-referrer"
              title={`Assembled preview — campaign ${id}`}
              className="h-[640px] w-full border border-hairline bg-white"
            />
            <p className="mt-2 text-[11.5px] text-ink-3">
              Rendered by this deployment&apos;s preview route from the committed campaign
              artifacts — what Klaviyo will receive, before Klaviyo has it.
            </p>
          </SectionCard>

          {/* Status trail + the Action gate's ledger */}
          <SectionCard title="Record">
            <ul className="space-y-1.5 text-[13.5px]">
              {row?.createdAt && (
                <li className="flex items-baseline gap-3">
                  <span className="tnum w-44 shrink-0 text-[12px] text-ink-3">
                    {when(row.createdAt)}
                  </span>
                  <span className="text-ink-2">Proposed</span>
                </li>
              )}
              {row?.scheduledAt && (
                <li className="flex items-baseline gap-3">
                  <span className="tnum w-44 shrink-0 text-[12px] text-ink-3">
                    {when(row.scheduledAt)}
                  </span>
                  <span className="text-ink-2">Scheduled send time</span>
                </li>
              )}
              {row?.sentAt && (
                <li className="flex items-baseline gap-3">
                  <span className="tnum w-44 shrink-0 text-[12px] text-ink-3">
                    {when(row.sentAt)}
                  </span>
                  <span className="text-ink-2">Sent</span>
                </li>
              )}
            </ul>

            {row?.klaviyoCampaignId && (
              <p className="mt-3 border-t border-hairline pt-3 text-[12.5px] text-ink-3">
                Klaviyo: campaign {row.klaviyoCampaignId}
                {row.klaviyoTemplateId ? ` · template ${row.klaviyoTemplateId}` : ""}
                {row.klaviyoMessageId ? ` · message ${row.klaviyoMessageId}` : ""}
              </p>
            )}

            <div className="mt-4 border-t border-hairline pt-4">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                Action audit
              </div>
              {audit.length > 0 ? (
                <ul className="space-y-2">
                  {audit.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 text-[13.5px]">
                      <span className="tnum w-44 shrink-0 text-[12px] text-ink-3">
                        {when(a.at)}
                      </span>
                      <Chip
                        variant={
                          a.outcome === "executed"
                            ? "filled"
                            : a.outcome === "failed" || a.outcome === "refused"
                              ? "attention"
                              : "outline"
                        }
                      >
                        {a.outcome}
                      </Chip>
                      <span className="min-w-0 flex-1 text-ink-2">
                        {a.kind} · {a.actor}
                        {a.detail && <span className="text-ink-3"> — {a.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">
                  No gated actions yet — every approval, decline, and execution lands here.
                </p>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
