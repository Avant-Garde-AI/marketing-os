-- =============================================================================
-- 009 — pack_social: the social pack's own schema (spec 26 §3, D2/D6)
-- =============================================================================
-- The first PACK-OWNED schema. Everything before this put pack state in
-- `public` behind an `mos_` prefix; spec 25 §7 / 26 §3 replace that with a
-- namespaced schema per pack:
--
--   * clean ownership      — one schema is the pack's whole DB footprint
--   * trivial teardown     — disabling the pack is DROP SCHEMA, not a hunt
--   * collision-free       — a third-party pack cannot squat an `mos_` name
--
-- The social pack is FIRST-PARTY, so it may run this at enablement (spec 25
-- D4). It is nevertheless written as though it were third-party — no
-- references into another pack's tables, no assumptions about `public`
-- beyond the platform contracts — because that boundary is the thing that
-- makes a third-party ecosystem possible later. The migration runner keys off
-- the `mos_skill_enablements` row (tenant_id, pack_id, version).
--
-- WHAT LIVES HERE vs. WHAT DOES NOT (spec 26 §3, D2):
--   pack_social.posts  — PACK-PRIVATE state: platform ids, permalinks, the
--                        approval fingerprint, the bound canvas revision.
--                        Nobody outside the pack reads these.
--   public.mos_calendar_items — the SHARED view. Every channel writes it
--                        through upsertCalendarItem and the console reads it
--                        treating `channel`/`status` as opaque. Do NOT
--                        overload the calendar with pack state (D2).
--
-- Doctrine (spec 22 D1): files are truth, the DB is a rebuildable index. Every
-- column here is derived from social/posts/{id}/post.md and can be rebuilt by
-- re-reading the artifacts. Losing this table loses speed, never content.
--
-- Governance mirrors 003/004/007/008: RLS on, authenticated + anon revoked,
-- the app writes as owner through the pooled connection. Tenant isolation is
-- tenant_id + RLS, never a schema per tenant (spec 26 §3).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS pack_social;

-- The pack's index over social/posts/{id}/post.md.
CREATE TABLE IF NOT EXISTS pack_social.posts (
  tenant_id      TEXT        NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  id             TEXT        NOT NULL,              -- social/posts/{id}/
  channel        TEXT        NOT NULL,              -- 'instagram' | 'threads' | …  (pack-owned, opaque to platform)
  calendar_month TEXT        NOT NULL,              -- YYYY-MM, or 'unscheduled'
  status         TEXT        NOT NULL,              -- the pack's lifecycle (spec 24 §1)
  scheduled_at   TIMESTAMPTZ,
  target_link    TEXT,
  copy           TEXT,

  -- Bound Design Surface (spec 23). `surface_revn` is the canvas revision the
  -- artifact last recorded: a canvas edit bumps it WITHOUT changing the
  -- file/page ids, which is precisely the drift the publish consent check
  -- exists to catch. Kept here so a surface can be spotted as edited without
  -- re-reading every artifact.
  surface_file_id TEXT,
  surface_page_id TEXT,
  surface_revn    INTEGER,

  -- Approve-at-schedule consent (spec 24 D2). The hash is a FINGERPRINT of the
  -- approved publish material, not an authorisation by itself — the
  -- authorisation is the Slack-actor row in public.mos_action_audit. Stored so
  -- a surface can show "approved, consent intact" without recomputing.
  approval_hash   TEXT,
  approval_at     TIMESTAMPTZ,

  -- Platform write-back after a successful publish.
  platform_id     TEXT,
  platform_permalink TEXT,
  published_at    TIMESTAMPTZ,
  failure         TEXT,

  -- Where truth lives. Explicit so an operator reading a row can always find
  -- the file that produced it.
  repo_path      TEXT        NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id)
);

-- The month read behind the calendar and the review month-sheet.
CREATE INDEX IF NOT EXISTS idx_pack_social_posts_month
  ON pack_social.posts (tenant_id, calendar_month, scheduled_at);

-- The cron's due-work read: what is scheduled and ready to go out.
CREATE INDEX IF NOT EXISTS idx_pack_social_posts_scheduled
  ON pack_social.posts (tenant_id, scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE pack_social.posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pack_social.posts FROM authenticated, anon;
REVOKE ALL ON SCHEMA pack_social FROM authenticated, anon;

-- update_updated_at() is defined by the init migration in public.
DROP TRIGGER IF EXISTS trg_pack_social_posts_updated ON pack_social.posts;
CREATE TRIGGER trg_pack_social_posts_updated
  BEFORE UPDATE ON pack_social.posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
