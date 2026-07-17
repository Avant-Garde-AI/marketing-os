/**
 * Read-side helpers for the console's Email pages (WS4-R3 / 02 §7).
 *
 * Composition, mirroring lib/social/console-data.ts:
 *  - the mos_email_campaigns INDEX row (status, Klaviyo ids, readback, month)
 *    read from the platform DB projection;
 *  - the campaign.md ARTIFACT (files are truth — subject candidates, sections,
 *    provenance, rationale prose) read through the tenant's artifact store
 *    (the same keyed store the social pack reads through) and parsed
 *    LENIENTLY here — the console renders what it can and never crashes on
 *    schema drift (the canonical zod schemas live in
 *    packages/skills/email-campaign; the console is a tolerant reader);
 *  - the campaign's Design Surface rows (mos_design_surfaces) for "Open
 *    canvas" links and section thumbnails;
 *  - the Action gate's records: mos_action_audit rows referencing the
 *    campaign, and pending mos_action_proposals (spec 20 §6 — the console
 *    shows state; approval lives in Slack for MVP).
 *
 * Everything degrades to null/[] — no DB, unapplied migrations, or a missing
 * artifact all render as editorial empty states.
 */

import { parse as parseYaml } from "yaml";
import { getTenant } from "../tenant-context";
import { safeQuery, tenantIdForShop } from "../platform-db";
import { readSocialFile } from "../social/repo"; // the tenant's generic artifact store (shop, path) — social-named, store-wide

const ID_RE = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Types (console-lenient mirrors of the pack's canonical shapes)
// ---------------------------------------------------------------------------

export interface EmailCampaignRow {
  id: string;
  calendarMonth: string;
  archetype: string;
  audienceRefs: AudienceRef[];
  subject: string | null;
  scheduledAt: string | null;
  status: string;
  designSurfaceId: string | null;
  skeletonRef: string | null;
  skeletonVersion: number | null;
  actionProposalId: string | null;
  klaviyoTemplateId: string | null;
  klaviyoCampaignId: string | null;
  klaviyoMessageId: string | null;
  sentAt: string | null;
  readback: Record<string, unknown> | null;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceRef {
  key?: string;
  type?: string;
  id?: string;
  name?: string;
  estimatedSize?: number;
}

export interface ProvenanceClaim {
  claim: string;
  origin: string;
}

/** A campaign section as the console reads it (lenient union of the pack's
 * surface/html shapes — unknown fields pass through untouched). */
export interface SectionView {
  slot: string;
  type: string;
  alt?: string;
  surfaceId?: string;
  boardName?: string;
  assetPath?: string;
  imageUrl?: string;
  blocks?: Array<Record<string, unknown>>;
}

/** campaign.md as parsed leniently for display. */
export interface CampaignArtifact {
  id?: string;
  archetype?: string;
  subject?: string;
  previewText?: string;
  subjectCandidates: string[];
  copyFormulaRef?: string;
  skeletonRef?: string;
  sections: SectionView[];
  audience: { included: AudienceRef[]; excluded: AudienceRef[] };
  scheduledAt?: string;
  utm?: { campaign?: string; source?: string; medium?: string };
  provenance: ProvenanceClaim[];
  status?: string;
  /** Markdown rationale prose. */
  body: string;
}

export interface SurfaceLink {
  surfaceId: string;
  /** Console-relative Design Studio link ("/studio?team-id=…"). */
  studioPath: string;
  /** Console-relative export render (this deployment's export route). */
  exportPath: string;
}

export interface AuditRecord {
  id: string;
  kind: string;
  actor: string;
  outcome: string;
  detail: string | null;
  at: string;
}

export interface PendingProposal {
  id: string;
  kind: string;
  summary: string;
  risk: string;
  createdAt: string;
}

export interface CampaignDetail {
  row: EmailCampaignRow | null;
  artifact: CampaignArtifact | null;
  /** Design Surfaces bound to this campaign, keyed by surface id. */
  surfaces: Map<string, SurfaceLink>;
  /** "Open canvas" — the campaign-level surface (row.designSurfaceId) if any,
   * else the first section surface. */
  studioPath: string | null;
  audit: AuditRecord[];
  pending: PendingProposal[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function iso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

// ---------------------------------------------------------------------------
// The index rows
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  calendar_month: string;
  archetype: string;
  audience_refs: unknown;
  subject: string | null;
  scheduled_at: Date | string | null;
  status: string;
  design_surface_id: string | null;
  skeleton_ref: string | null;
  skeleton_version: number | null;
  action_proposal_id: string | null;
  klaviyo_template_id: string | null;
  klaviyo_campaign_id: string | null;
  klaviyo_message_id: string | null;
  sent_at: Date | string | null;
  readback: Record<string, unknown> | null;
  repo_path: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const ROW_COLUMNS = `id, calendar_month, archetype, audience_refs, subject, scheduled_at,
  status, design_surface_id, skeleton_ref, skeleton_version, action_proposal_id,
  klaviyo_template_id, klaviyo_campaign_id, klaviyo_message_id, sent_at, readback,
  repo_path, created_at, updated_at`;

function toRow(r: DbRow): EmailCampaignRow {
  return {
    id: r.id,
    calendarMonth: r.calendar_month,
    archetype: r.archetype,
    audienceRefs: Array.isArray(r.audience_refs) ? (r.audience_refs as AudienceRef[]) : [],
    subject: r.subject,
    scheduledAt: iso(r.scheduled_at),
    status: r.status,
    designSurfaceId: r.design_surface_id,
    skeletonRef: r.skeleton_ref,
    skeletonVersion: r.skeleton_version,
    actionProposalId: r.action_proposal_id,
    klaviyoTemplateId: r.klaviyo_template_id,
    klaviyoCampaignId: r.klaviyo_campaign_id,
    klaviyoMessageId: r.klaviyo_message_id,
    sentAt: iso(r.sent_at),
    readback: r.readback,
    repoPath: r.repo_path,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

/** Every campaign row for the tenant, newest month first. */
export async function listCampaigns(): Promise<EmailCampaignRow[]> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return [];
  const rows = await safeQuery<DbRow>(
    "email campaigns",
    `SELECT ${ROW_COLUMNS} FROM mos_email_campaigns
      WHERE tenant_id = $1
      ORDER BY calendar_month DESC, scheduled_at NULLS LAST, id`,
    [tid]
  );
  return (rows ?? []).map(toRow);
}

async function loadCampaignRow(id: string): Promise<EmailCampaignRow | null> {
  const { shop, tenantId } = getTenant();
  const tid = await tenantIdForShop(shop, tenantId);
  if (!tid) return null;
  const rows = await safeQuery<DbRow>(
    `email campaign ${id}`,
    `SELECT ${ROW_COLUMNS} FROM mos_email_campaigns WHERE tenant_id = $1 AND id = $2`,
    [tid, id]
  );
  return rows?.[0] ? toRow(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// The campaign.md artifact — lenient front-matter read
// ---------------------------------------------------------------------------

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asAudienceRefs(v: unknown): AudienceRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is AudienceRef => Boolean(x) && typeof x === "object");
}

function asProvenance(v: unknown): ProvenanceClaim[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({ claim: String(x.claim ?? ""), origin: String(x.origin ?? "agent") }))
    .filter((p) => p.claim);
}

function asSections(v: unknown): SectionView[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      slot: String(x.slot ?? ""),
      type: String(x.type ?? ""),
      ...(asString(x.alt) ? { alt: asString(x.alt) } : {}),
      ...(asString(x.surfaceId) ? { surfaceId: asString(x.surfaceId) } : {}),
      ...(asString(x.boardName) ? { boardName: asString(x.boardName) } : {}),
      ...(asString(x.assetPath) ? { assetPath: asString(x.assetPath) } : {}),
      ...(asString(x.imageUrl) ? { imageUrl: asString(x.imageUrl) } : {}),
      ...(Array.isArray(x.blocks)
        ? { blocks: x.blocks.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object") }
        : {}),
    }));
}

/** Parse campaign.md tolerantly: bad or missing front matter yields null;
 * partial front matter yields whatever fields are present. */
export function parseCampaignArtifact(raw: string): CampaignArtifact | null {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) return null;
  let fm: Record<string, unknown>;
  try {
    const parsed = parseYaml(m[1] ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    fm = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const audience = (fm.audience ?? {}) as Record<string, unknown>;
  const utm = fm.utm as Record<string, unknown> | undefined;
  const artifact: CampaignArtifact = {
    subjectCandidates: asStringArray(fm.subjectCandidates),
    sections: asSections(fm.sections),
    audience: {
      included: asAudienceRefs(audience.included),
      excluded: asAudienceRefs(audience.excluded),
    },
    provenance: asProvenance(fm.provenance),
    body: raw.slice(m[0].length).trim(),
  };
  if (asString(fm.id)) artifact.id = asString(fm.id);
  if (asString(fm.archetype)) artifact.archetype = asString(fm.archetype);
  if (asString(fm.subject)) artifact.subject = asString(fm.subject);
  if (asString(fm.previewText)) artifact.previewText = asString(fm.previewText);
  if (asString(fm.copyFormulaRef)) artifact.copyFormulaRef = asString(fm.copyFormulaRef);
  if (asString(fm.skeletonRef)) artifact.skeletonRef = asString(fm.skeletonRef);
  if (asString(fm.scheduledAt)) artifact.scheduledAt = asString(fm.scheduledAt);
  if (asString(fm.status)) artifact.status = asString(fm.status);
  if (utm && typeof utm === "object") {
    artifact.utm = {
      ...(asString(utm.campaign) ? { campaign: asString(utm.campaign) } : {}),
      ...(asString(utm.source) ? { source: asString(utm.source) } : {}),
      ...(asString(utm.medium) ? { medium: asString(utm.medium) } : {}),
    };
  }
  return artifact;
}

async function loadCampaignArtifact(shop: string, id: string): Promise<CampaignArtifact | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const raw = await readSocialFile(shop, `email/campaigns/${id}/campaign.md`);
    return raw === null ? null : parseCampaignArtifact(raw);
  } catch (e) {
    console.error(`[email] campaign.md ${id} unreadable:`, errMsg(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Design Surfaces → Studio / export links
// ---------------------------------------------------------------------------

interface SurfaceRow {
  id: string;
  penpot_team_id: string;
  penpot_file_id: string;
  penpot_page_id: string;
}

function toSurfaceLink(r: SurfaceRow): SurfaceLink {
  const qs = new URLSearchParams({ "team-id": r.penpot_team_id, "file-id": r.penpot_file_id });
  if (r.penpot_page_id) qs.set("page-id", r.penpot_page_id);
  return {
    surfaceId: r.id,
    // Full-window Design Studio degradation (spec 23 — until DS4's embedded
    // canvas, /studio opens the workspace, itself degrading to an explainer).
    studioPath: `/studio?${qs.toString()}`,
    // This deployment's own export route (guarded like brand-image): a
    // console-relative render for section thumbnails.
    exportPath: `/api/design-surfaces/export/${r.penpot_file_id}?pageId=${r.penpot_page_id}&format=png&scale=1`,
  };
}

async function loadSurfaces(tid: string, surfaceIds: string[]): Promise<Map<string, SurfaceLink>> {
  const out = new Map<string, SurfaceLink>();
  const ids = [...new Set(surfaceIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const rows = await safeQuery<SurfaceRow>(
    "design surfaces",
    `SELECT id, penpot_team_id, penpot_file_id, penpot_page_id
       FROM mos_design_surfaces
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tid, ids]
  );
  for (const r of rows ?? []) out.set(r.id, toSurfaceLink(r));
  return out;
}

// ---------------------------------------------------------------------------
// Action gate records (spec 20 §6 — console shows state)
// ---------------------------------------------------------------------------

async function loadAudit(tid: string, campaignId: string, proposalId: string | null): Promise<AuditRecord[]> {
  const rows = await safeQuery<{
    id: string;
    kind: string;
    actor: string;
    outcome: string;
    detail: string | null;
    at: Date | string;
  }>(
    "action audit",
    `SELECT id, kind, actor, outcome, detail, at
       FROM mos_action_audit
      WHERE tenant_id = $1
        AND (params->>'campaignId' = $2 OR params->>'campaign_id' = $2 OR params->>'id' = $2
             OR ($3::uuid IS NOT NULL AND proposal_id = $3::uuid))
      ORDER BY at DESC`,
    [tid, campaignId, proposalId]
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    actor: r.actor,
    outcome: r.outcome,
    detail: r.detail,
    at: iso(r.at)!,
  }));
}

async function loadPending(tid: string, campaignId: string, proposalId: string | null): Promise<PendingProposal[]> {
  const rows = await safeQuery<{
    id: string;
    kind: string;
    summary: string;
    risk: string;
    created_at: Date | string;
  }>(
    "pending proposals",
    `SELECT id, kind, summary, risk, created_at
       FROM mos_action_proposals
      WHERE tenant_id = $1 AND status = 'proposed'
        AND (params->>'campaignId' = $2 OR params->>'campaign_id' = $2 OR params->>'id' = $2
             OR ($3::uuid IS NOT NULL AND id = $3::uuid))
      ORDER BY created_at DESC`,
    [tid, campaignId, proposalId]
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    risk: r.risk,
    createdAt: iso(r.created_at)!,
  }));
}

// ---------------------------------------------------------------------------
// The composed detail
// ---------------------------------------------------------------------------

/** Everything the campaign detail page renders. Null only when NEITHER the
 * index row nor the artifact exists (a truly unknown id). */
export async function loadCampaignDetail(id: string): Promise<CampaignDetail | null> {
  if (!ID_RE.test(id)) return null;
  const { shop, tenantId } = getTenant();

  const [row, artifact] = await Promise.all([
    loadCampaignRow(id),
    loadCampaignArtifact(shop, id),
  ]);
  if (!row && !artifact) return null;

  const tid = await tenantIdForShop(shop, tenantId);

  const sectionSurfaceIds = (artifact?.sections ?? [])
    .map((s) => s.surfaceId)
    .filter((s): s is string => Boolean(s));
  const allSurfaceIds = [
    ...(row?.designSurfaceId ? [row.designSurfaceId] : []),
    ...sectionSurfaceIds,
  ];

  const [surfaces, audit, pending] = await Promise.all([
    tid ? loadSurfaces(tid, allSurfaceIds) : Promise.resolve(new Map<string, SurfaceLink>()),
    tid ? loadAudit(tid, id, row?.actionProposalId ?? null) : Promise.resolve([]),
    tid ? loadPending(tid, id, row?.actionProposalId ?? null) : Promise.resolve([]),
  ]);

  const primarySurfaceId = row?.designSurfaceId ?? sectionSurfaceIds[0] ?? null;
  const studioPath = primarySurfaceId ? (surfaces.get(primarySurfaceId)?.studioPath ?? null) : null;

  return { row, artifact, surfaces, studioPath, audit, pending };
}
