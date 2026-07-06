import Link from "next/link";
import { PageHeader, Chip, SectionCard, EmptyState } from "@/components/primitives";
import { OfferPerformance, type OfferPerfData } from "@/components/chat/gen-ui";
import fileManifest from "@/config/surfaces.json";

/**
 * Surfaces — the storefront management view (spec 14 addendum).
 *
 * Each deployed surface renders as a card: status, live variant creative,
 * the experiment funnel (same registered component chat uses), the current
 * decision read, and actions. Monitoring is deterministic (the page calls
 * the same platform queries the agent's tools call — no model in the loop);
 * judgment deep-links into chat.
 */

export const dynamic = "force-dynamic";

interface ManifestSurface {
  id: string;
  placement?: string;
  experiment?: { id?: string; policy?: string; allocation?: number; arms?: { key: string; weight: number }[] };
  variants?: Record<string, { content?: Record<string, string> }>;
}
interface PlatformArm {
  arm: string; exposures: number; impressions: number; captures: number; dismisses: number;
  captureRate: number | null; ci95: [number, number] | null; pBest: number | null;
}

const MIN_IMPRESSIONS = 200, MIN_CAPTURES = 10, PROMOTE_AT = 0.95;

function verdict(arms: PlatformArm[]): string {
  const shown = arms.filter((a) => a.arm !== "control");
  if (shown.length === 0) return "Awaiting first traffic.";
  const minN = Math.min(...shown.map((a) => a.impressions));
  const caps = shown.reduce((t, a) => t + a.captures, 0);
  const top = [...shown].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0]!;
  if (minN >= MIN_IMPRESSIONS && caps >= MIN_CAPTURES && (top.pBest ?? 0) >= PROMOTE_AT)
    return `"${top.arm}" is ready to promote — ${Math.round((top.pBest ?? 0) * 100)}% probability best.`;
  if (minN >= MIN_IMPRESSIONS && caps >= MIN_CAPTURES)
    return `Signal forming — "${top.arm}" leads at ${Math.round((top.pBest ?? 0) * 100)}% P(best).`;
  return `Collecting — ${minN.toLocaleString()}/${MIN_IMPRESSIONS} impressions on the smallest arm, ${caps}/${MIN_CAPTURES} captures.`;
}

async function platform<T>(path: string): Promise<T | null> {
  const apiUrl = process.env.MARKETING_OS_API_URL;
  const apiKey = process.env.MARKETING_OS_API_KEY;
  if (!apiUrl || !apiKey) return null;
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function SurfacesPage() {
  // Platform-stored surfaces (deploy-on-approve) + the file bootstrap manifest.
  const [list, stats] = await Promise.all([
    platform<{ surfaces: { surfaceId: string; status: string; allocation: number }[] }>("/api/offers/surfaces"),
    platform<{ surfaces: { surfaceId: string; arms: PlatformArm[] }[] }>("/api/offers/stats?days=30"),
  ]);

  const platformRows = list?.surfaces ?? [];
  const fileSurfaces = (fileManifest as { surfaces: ManifestSurface[] }).surfaces ?? [];
  const platformIds = new Set(platformRows.map((r) => r.surfaceId));

  const cards = [
    ...platformRows.map((r) => ({ id: r.surfaceId, status: r.status, source: "platform" as const, manifest: undefined as ManifestSurface | undefined, allocation: r.allocation })),
    ...fileSurfaces.filter((s) => !platformIds.has(s.id)).map((s) => ({
      id: s.id, status: "ACTIVE", source: "bootstrap" as const, manifest: s, allocation: s.experiment?.allocation ?? 1,
    })),
  ];

  const statsBySurface = new Map((stats?.surfaces ?? []).map((s) => [s.surfaceId, s.arms]));

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Surfaces"
          title="On the storefront"
          sub="Every offer your agents run — its experiment, its numbers, and its next decision."
        />

        {cards.length === 0 ? (
          <div className="animate-enter-2 border border-hairline bg-raised">
            <EmptyState
              headline={<>Nothing deployed yet. Design an offer in chat — it lands here, <span className="italic">in practice.</span></>}
              action={<Link href="/chat?prompt=Design a new offer for our store and propose it for my review." className="arrow-link text-[15px]">Design an offer</Link>}
            />
          </div>
        ) : (
          <div className="animate-enter-2 space-y-6">
            {cards.map((card) => {
              const arms = statsBySurface.get(card.id) ?? [];
              const exp = card.manifest?.experiment;
              const variants = Object.entries(card.manifest?.variants ?? {});
              const perf: OfferPerfData = {
                surfaceId: card.id,
                days: 30,
                arms: arms.map((a) => ({ ...a, attributedCustomers: 0, attributedOrders: 0, attributedRevenue: 0 })),
              };
              return (
                <SectionCard
                  key={card.id}
                  title={card.id.replace(/^ofr_/, "").replace(/_/g, " ")}
                  action={
                    <span className="flex items-center gap-2">
                      <Chip variant={card.status === "ACTIVE" ? "filled" : "outline"}>
                        {card.status === "ACTIVE" ? "In practice" : card.status === "PAUSED" ? "Paused" : "Retired"}
                      </Chip>
                      {exp?.policy === "thompson" && <Chip variant="attention">Bandit</Chip>}
                    </span>
                  }
                >
                  {/* the creative, as deployed */}
                  {variants.length > 0 && (
                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {variants.map(([key, v]) => (
                        <div key={key} className="border border-hairline p-3.5">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-3">{key}</div>
                          <div className="font-display text-[15px] leading-snug">{v.content?.headline}</div>
                          <div className="mt-1.5 inline-block bg-inverse px-2.5 py-1 text-[11px] font-medium text-paper">{v.content?.cta}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* the numbers — the exact component chat renders */}
                  {arms.length > 0 ? (
                    <OfferPerformance data={perf} />
                  ) : (
                    <p className="py-2 text-sm text-ink-2">No traffic recorded yet.</p>
                  )}

                  {/* the decision + the seam into judgment */}
                  <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-hairline pt-3.5">
                    <p className="text-[13.5px] text-ink-2">{verdict(arms)}</p>
                    <span className="flex items-center gap-5">
                      <Link href={`/chat?prompt=${encodeURIComponent(`Review the ${card.id} offer experiment and recommend next moves.`)}`} className="arrow-link text-[14px]">
                        Review in chat
                      </Link>
                      <Link href={`/chat?prompt=${encodeURIComponent(`How is the ${card.id} offer performing? Include attribution.`)}`} className="arrow-link text-[14px]">
                        Ask with attribution
                      </Link>
                    </span>
                  </div>
                  {card.source === "bootstrap" && (
                    <p className="mt-2 text-[11.5px] text-ink-3">
                      Bootstrap surface (config file) — superseded automatically by the first platform-deployed offer.
                    </p>
                  )}
                </SectionCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
