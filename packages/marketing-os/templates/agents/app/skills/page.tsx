import { PageHeader } from "@/components/primitives";
import { SkillsAdmin, type PackCardData } from "@/components/skills/skills-admin";
import { SKILL_PACKS } from "@/lib/skills-catalog";
import { listEnablements } from "@/lib/skill-enablements";
import { checkProviderConnection, type ConnectionHealth } from "@/lib/provider-connections";

/**
 * Skills — the pack admin surface (WS4-R4 / 05 H1.4 / spec 20 §6).
 *
 * Formerly a redirect to /playbooks; the two are now distinct by design:
 * Playbooks is the capability LIBRARY (what the agent can run for you),
 * Skills is the pack ADMIN (what's installed, enabled, connected, and
 * configured per store). Each pack card joins the static catalog
 * (lib/skills-catalog.ts) with the tenant's mos_skill_enablements row and
 * its required providers' live connection health; Klaviyo's connection card
 * lives below (email's `requires` gate points at it).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  // One probe per distinct required provider (klaviyo today), in parallel
  // with the enablement read — the two are independent.
  const providers = [...new Set(SKILL_PACKS.flatMap((p) => p.requires))];
  const [enablements, healthEntries] = await Promise.all([
    listEnablements(),
    Promise.all(
      providers.map(async (p): Promise<[string, ConnectionHealth]> => [
        p,
        await checkProviderConnection(p, "console-health"),
      ])
    ),
  ]);
  const byPack = new Map((enablements ?? []).map((e) => [e.packId, e]));
  const healthByProvider = new Map<string, ConnectionHealth>(healthEntries);

  const packs: PackCardData[] = SKILL_PACKS.map((meta) => ({
    meta,
    enablement: byPack.get(meta.id) ?? null,
    requirements: meta.requires.map(
      (p) => healthByProvider.get(p) ?? { provider: p, state: "unknown" as const }
    ),
  }));

  const klaviyo =
    healthByProvider.get("klaviyo") ??
    (await checkProviderConnection("klaviyo", "console-health"));

  const integrationsUrl = process.env.MARKETING_OS_API_URL
    ? `${process.env.MARKETING_OS_API_URL.replace(/\/$/, "")}/app/integrations`
    : null;

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Skills"
          title={
            <>
              What your agents <span className="italic">may do.</span>
            </>
          }
          sub="Skill packs per store: enabled or off, their provider connections, and their wiring. Strategy lives in your repo; switches live here."
        />

        {enablements === null && (
          <p className="animate-enter-2 mb-4 text-[13px] text-ink-3">
            The platform database isn&apos;t linked on this deployment — pack state shows
            defaults and toggles won&apos;t persist until SUPABASE_DATABASE_URL points at the
            Marketing OS database.
          </p>
        )}

        <div className="animate-enter-2">
          <SkillsAdmin packs={packs} klaviyo={klaviyo} integrationsUrl={integrationsUrl} />
        </div>

        <p className="animate-enter-3 mt-6 max-w-2xl text-[11.5px] leading-relaxed text-ink-3">
          Enabling a pack merges its tools into your agent on the next request; disabling
          removes them within one request cycle. Strategy-shaped configuration
          (email/strategy.md, social/strategy.md) is co-created with the agent in chat and
          versioned in your repo — only wiring lives on this page.
        </p>
      </div>
    </div>
  );
}
