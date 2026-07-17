/**
 * The static skill-pack catalog (WS4-R4 / 05 H1.4).
 *
 * Per-tenant STATE lives in mos_skill_enablements (H1.1); this file is the
 * pack METADATA the Skills page joins it with: id, name, description, version,
 * provider requirements (H1.2 — the enable gate), and the wiring-shaped
 * config fields stored in the enablement row's `config` jsonb (H1.3 —
 * strategy-shaped config lives in repo artifacts like email/strategy.md,
 * never here).
 */

export interface SkillConfigField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
}

export interface SkillPackMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Provider connections required before the pack can be enabled (H1.2). */
  requires: string[];
  /** Wiring-shaped config → enablement row `config` jsonb (H1.3). */
  configFields: SkillConfigField[];
}

export const SKILL_PACKS: SkillPackMeta[] = [
  {
    id: "email-campaign",
    name: "Email Campaign Agent",
    description:
      "Plans monthly email calendars from your strategy, composes campaigns on Design Surfaces, drafts them into Klaviyo behind your approval, and reads performance back against your baseline.",
    version: "0.1.0",
    requires: ["klaviyo"],
    configFields: [
      {
        key: "conversion_metric_id",
        label: "Conversion metric id",
        placeholder: "e.g. WRfWfM",
        help: "Klaviyo's Placed Order metric id — required on every performance read. Resolved automatically at connect time; override here if your account is ambiguous.",
      },
      {
        key: "default_from_address",
        label: "Default from-address",
        placeholder: "hello@yourstore.com",
        help: "The sending address campaigns default to. Must be verified in Klaviyo.",
      },
    ],
  },
  {
    id: "social-media",
    name: "Social Media Agent",
    description:
      "Derives monthly social calendars from your Brand Soul, drafts post specs with provenance, and composes post creative on Design Surfaces — publishing gates through your approval.",
    version: "0.1.0",
    requires: [],
    configFields: [],
  },
];

export function packMeta(packId: string): SkillPackMeta | undefined {
  return SKILL_PACKS.find((p) => p.id === packId);
}
