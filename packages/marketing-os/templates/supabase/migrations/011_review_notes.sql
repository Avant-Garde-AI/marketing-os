-- =============================================================================
-- 011 — mos_review_notes: review notes, generalised across packs (spec 26 D1)
-- =============================================================================
-- 008 shipped `mos_email_review_notes`, keyed on `campaign_id`. Social needs
-- the same thing keyed on a post group. D1: GENERALISE rather than clone —
-- "two clones is where a third becomes inevitable", and the shape is already
-- channel-neutral apart from the column name.
--
-- ADDITIVE ON PURPOSE. This creates the generalised table and leaves
-- mos_email_review_notes untouched and serving. The email review loop was
-- proven end to end days ago; migrating it in the same stroke as introducing
-- social's notes would put a working loop at risk for no schedule gain. Social
-- writes here from day one; email moves over as its own change, once this
-- table has been exercised. Until then both exist, which is the point of doing
-- it in two steps.
--
-- The addressing is (pack_id, item_id): the pack that owns the thing being
-- discussed, and its id within that pack. For social the item is a post GROUP
-- key (spec 26 D3) — the group is the review unit, so it is the discussion
-- unit. For email it will be the campaign id.
--
-- IDENTITY WARNING (unchanged from 008, and it must never soften):
--   Notes arrive through a TOKEN-GATED PUBLIC surface. A valid token proves
--   possession of a link, NOT identity. `author` is free text the reviewer
--   typed. It is a courtesy label for a conversation — never an approval, an
--   authorisation, or an audit record. Approval keeps its own path: Slack, a
--   real user id, mos_action_audit. `source` exists to keep that distinction
--   legible forever: a future console-authenticated lane can write 'console'
--   and be trusted more without silently upgrading every 'link' row already
--   stored.
--
-- Doctrine note: notes are the deliberate EXCEPTION to files-are-truth. They
-- are conversation ABOUT an artifact, not the artifact, so they are honestly
-- DB-native. Losing them loses discussion, never content.
--
-- Governance mirrors 003/004/007/008: RLS on, authenticated + anon revoked,
-- the app writes as owner through the pooled connection.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mos_review_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  pack_id      TEXT        NOT NULL,              -- 'social-media' | 'email-campaign' | …
  item_id      TEXT        NOT NULL,              -- post GROUP key | campaign id
  slot         TEXT,                              -- optional sub-target (a variant, a section)
  author       TEXT        NOT NULL,              -- SELF-DECLARED (see warning above)
  body         TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'link'
                           CHECK (source IN ('link', 'console')),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read the review room and the MCP tool both make: one item's thread,
-- oldest first.
CREATE INDEX IF NOT EXISTS idx_mos_review_notes_item
  ON mos_review_notes (tenant_id, pack_id, item_id, created_at);

-- "What's still open" — the planning-session read, across a whole pack.
CREATE INDEX IF NOT EXISTS idx_mos_review_notes_open
  ON mos_review_notes (tenant_id, pack_id, created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE mos_review_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mos_review_notes FROM authenticated, anon;

DROP TRIGGER IF EXISTS trg_mos_review_notes_updated ON mos_review_notes;
CREATE TRIGGER trg_mos_review_notes_updated
  BEFORE UPDATE ON mos_review_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
