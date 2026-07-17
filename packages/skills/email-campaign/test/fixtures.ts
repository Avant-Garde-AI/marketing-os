/**
 * Shared test fixtures — an Arthaus-flavored strategy and a fake
 * KlaviyoClient (the pack never sees a credential; tests never see a network).
 */

import type {
  EmailCampaign,
  EmailStrategy,
  KlaviyoAudience,
  KlaviyoClient,
  KlaviyoTemplate,
  KlaviyoUniversalContentBlock,
} from "../src/types";

export const strategy: EmailStrategy = {
  audiences: [
    {
      key: "engaged-30d",
      klaviyoRef: { type: "segment", id: "SegEngaged30" },
      description: "Opened or clicked in the last 30 days",
      cadenceCap: 4,
    },
    {
      key: "full-list",
      klaviyoRef: { type: "list", id: "ListMain" },
      description: "The full marketing list",
      cadenceCap: 2,
    },
    {
      key: "collectors",
      klaviyoRef: { type: "segment", id: "SegCollectors" },
      description: "Multi-purchase collectors",
      cadenceCap: 2,
    },
  ],
  archetypes: [
    { name: "new-arrivals", messagingRef: "brand.md §6 — discovery messaging", weight: 3 },
    { name: "editorial-story", messagingRef: "brand.md §10 — editorial strategy", weight: 2 },
    { name: "promotion", messagingRef: "brand.md §6 — considered promotion", weight: 1 },
  ],
  campaignsPerMonth: 4,
  sendDays: ["tuesday", "thursday"],
  sendTime: "10:00",
  seasonalArcs: [
    { name: "autumn-refresh", months: ["2026-08", "2026-09"], description: "Autumn gallery refresh" },
  ],
  guardrails: {
    maxCampaignsPerWeek: 2,
    quietPeriods: [{ start: "2026-08-24", end: "2026-08-31", reason: "site migration freeze" }],
  },
  body: "## Rationale\n\nThe standing email strategy, co-created from brand.md.",
};

export const campaign: EmailCampaign = {
  id: "2026-08-new-arrivals",
  archetype: "new-arrivals",
  audience: {
    included: [
      { key: "engaged-30d", type: "segment", id: "SegEngaged30", name: "Engaged 30d", estimatedSize: 1240 },
    ],
    excluded: [{ type: "segment", id: "SegRecent", name: "Purchased last 14d" }],
  },
  subjectCandidates: [
    "New botanical prints, framed and ready",
    "Three walls, three new stories",
  ],
  subject: "New botanical prints, framed and ready",
  previewText: "Autumn arrivals: framed botanicals over walnut consoles.",
  copyFormulaRef: "brand.md copy-formulas/art-description",
  skeletonRef: "arthaus-editorial-v1",
  sections: [
    {
      slot: "hero",
      type: "surface",
      alt: "Autumn arrivals: three framed botanical prints over a walnut console",
      surfaceId: "surf-123",
      boardName: "hero",
      payload: { headline: "Autumn arrivals" },
    },
    {
      slot: "body-1",
      type: "html",
      blocks: [
        { type: "paragraph", text: "Museum-grade botanicals, newly framed." },
        { type: "button", text: "Explore the arrivals", href: "https://myarthaus.com/collections/new" },
      ],
    },
  ],
  utm: { campaign: "2026-08-new-arrivals", source: "klaviyo", medium: "email" },
  klaviyo: { templateId: "Tpl1" },
  provenance: [
    { claim: "new-arrivals archetype weighted 3 in strategy", origin: "owner" },
    { claim: "botanical prints are the month's top mover", origin: "data" },
  ],
  status: "proposed",
  body: "Drafted from the August plan's first slot.",
};

// ---------------------------------------------------------------------------
// Arthaus-flavored DTCG tokens — the shape @avant-garde/brand-md's
// compileDesignTokens emits for packages/brand-md/examples/arthaus/DESIGN.md
// (subset; aliases kept as aliases to exercise resolution).
// ---------------------------------------------------------------------------

export const arthausTokens: Record<string, unknown> = {
  $description: "Arthaus design tokens compiled from DESIGN.md",
  $metadata: { tokenSetOrder: ["global"] },
  global: {
    colors: {
      "warm-parchment": { $type: "color", $value: "#F5F2ED" },
      charcoal: { $type: "color", $value: "#2D2D2D" },
      "warm-gray": { $type: "color", $value: "#6B6560" },
      bronze: { $type: "color", $value: "#B07D4F" },
      "deep-ink": { $type: "color", $value: "#1A1A2E" },
      primary: { $type: "color", $value: "{colors.bronze}" },
      background: { $type: "color", $value: "{colors.warm-parchment}" },
      "background-transactional": { $type: "color", $value: "#FFFFFF" },
      text: { $type: "color", $value: "{colors.charcoal}" },
      "text-secondary": { $type: "color", $value: "{colors.warm-gray}" },
    },
    typography: {
      display: {
        $type: "typography",
        $value: {
          fontFamily: ["Canela", "Freight Display", "Noe Display", "Georgia", "serif"],
          fontWeight: 500,
          letterSpacing: "0em",
        },
      },
      body: {
        $type: "typography",
        $value: {
          fontFamily: ["Inter", "Söhne", "Graphik", "system-ui", "sans-serif"],
          fontSize: "17px",
          lineHeight: 1.55,
          fontWeight: 400,
        },
      },
      specs: {
        $type: "typography",
        $value: { fontFamily: ["IBM Plex Mono", "JetBrains Mono", "monospace"], fontSize: "14px" },
      },
    },
    spacing: {
      md: { $type: "dimension", $value: "24px" },
      lg: { $type: "dimension", $value: "48px" },
    },
    rounded: {
      none: { $type: "dimension", $value: "0px" },
      subtle: { $type: "dimension", $value: "2px" },
    },
    components: {
      "button-primary": {
        backgroundColor: { $type: "color", $value: "{colors.charcoal}" },
        textColor: { $type: "color", $value: "#FFFFFF" },
      },
      card: { backgroundColor: { $type: "color", $value: "#FFFFFF" } },
    },
  },
};

// ---------------------------------------------------------------------------
// Fake KlaviyoClient
// ---------------------------------------------------------------------------

export interface FakeKlaviyoState {
  audiences: KlaviyoAudience[];
  templates: KlaviyoTemplate[];
  universalContent: KlaviyoUniversalContentBlock[];
  /** Every mutating call is recorded here — preview()-is-read-only tests
   * assert this stays empty. */
  mutations: string[];
}

export function createFakeKlaviyo(overrides: Partial<FakeKlaviyoState> = {}): {
  client: KlaviyoClient;
  state: FakeKlaviyoState;
} {
  const state: FakeKlaviyoState = {
    audiences: [
      { type: "segment", id: "SegEngaged30", name: "Engaged 30d", profileCount: 1240 },
      { type: "list", id: "ListMain", name: "Main list", profileCount: 8200 },
      { type: "segment", id: "SegCollectors", name: "Collectors", profileCount: 310 },
    ],
    templates: [
      {
        id: "Tpl1",
        name: "Arthaus Editorial",
        editorType: "USER_DRAGGABLE",
        updated: "2026-06-01T00:00:00Z",
        html: '<html><body><table><tr><td>{% universal_content id="UC1" %}</td></tr><tr><td>{{ first_name }}</td></tr></table>{% unsubscribe %}</body></html>',
      },
      { id: "Tpl2", name: "Arthaus Winback", editorType: "CODE", updated: "2026-05-01T00:00:00Z" },
    ],
    universalContent: [{ id: "UC1", name: "Header band", html: "<td>ARTHAUS HEADER</td>" }],
    mutations: [],
    ...overrides,
  };

  const client: KlaviyoClient = {
    async listAudiences() {
      return state.audiences;
    },
    async listTemplates() {
      return state.templates.map(({ html: _h, text: _t, ...summary }) => summary);
    },
    async getTemplate(id) {
      const t = state.templates.find((t) => t.id === id);
      if (!t) throw new Error(`fake: template ${id} not found`);
      return t;
    },
    async listUniversalContent() {
      return state.universalContent;
    },
    async listMetrics() {
      return [{ id: "MetricPO", name: "Placed Order", integration: "shopify" }];
    },
    async campaignValuesReport(query) {
      return (query.campaignIds ?? ["CampX"]).map((campaignId) => ({
        campaignId,
        delivered: 1200,
        opens: 480,
        opensUnique: 410,
        openRate: 0.34,
        clicks: 96,
        clicksUnique: 82,
        clickRate: 0.068,
        conversions: 18,
        conversionValue: 2140,
        revenuePerRecipient: 1.78,
      }));
    },
    async estimateRecipients() {
      return { estimatedCount: 1240 };
    },
    async getSendJob() {
      return { status: "queued" };
    },
    async getCampaignStatus() {
      return { status: "Draft" };
    },
    async renderTemplate(id) {
      const t = state.templates.find((t) => t.id === id);
      return { html: t?.html ?? "<html></html>" };
    },
    async createTemplate(input) {
      state.mutations.push(`createTemplate:${input.name}`);
      return { id: `Tpl-new-${state.mutations.length}` };
    },
    async updateTemplate(id) {
      state.mutations.push(`updateTemplate:${id}`);
    },
    async createCampaign(input) {
      state.mutations.push(`createCampaign:${input.name}`);
      return { campaignId: "CampNew", messageId: "MsgNew" };
    },
    async assignTemplate(messageId, templateId) {
      state.mutations.push(`assignTemplate:${messageId}:${templateId}`);
    },
    async updateCampaignSendStrategy(campaignId, strategy) {
      state.mutations.push(`updateSendStrategy:${campaignId}:${strategy.datetime}`);
    },
    async createSendJob(campaignId) {
      state.mutations.push(`createSendJob:${campaignId}`);
      return { status: "queued" };
    },
    async cancelSendJob(campaignId) {
      state.mutations.push(`cancelSendJob:${campaignId}`);
    },
    async uploadImage(input) {
      state.mutations.push(`uploadImage:${input.name}`);
      return { id: `img-${input.name}`, imageUrl: `https://d3k81ch9hvuctc.cloudfront.net/fake/${input.name}.png` };
    },
  };

  return { client, state };
}
