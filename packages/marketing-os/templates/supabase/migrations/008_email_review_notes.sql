-- =============================================================================
-- 008 — Review notes on email campaigns (spec 25 — the hosted review loop)
-- =============================================================================
-- A shared review link (HMAC, 30-day expiry) opens the review room: the
-- assembled email plus the context needed to judge it. Reviewers leave notes
-- there; the agent reads them back in-session and revises. This is the table
-- behind that loop.
--
-- IDENTITY WARNING — read before building anything on top of `author`:
--   These notes arrive through a TOKEN-GATED PUBLIC surface. A valid token
--   proves possession of a link, not identity, and `author` is whatever the
--   reviewer typed into a text box. It is a courtesy label for a conversation,
--   NOT an authenticated actor.
--   Never treat a note as an approval, an authorisation, or an audit record.
--   Approval keeps its own path: Slack, real user id, mos_action_audit.
--   `source` exists to keep that distinction legible forever — a future
--   console-authenticated note lane can write 'console' and be trusted more,
--   without silently upgrading the trust of every 'link' row already here.
--
-- Doctrine (spec 22 D1): files are truth, DB is the index. Notes are the
-- exception and are honestly DB-native — they are conversation ABOUT the
-- artifact, not the artifact. Losing them loses discussion, not campaigns.
--
-- Governance mirrors 003/004/007: RLS on, authenticated + anon denied, the
-- app writes as owner through the pooled connection. No secrets.
-- =============================================================================

CREATE TABLE mos_email_review_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  campaign_id  TEXT        NOT NULL,              -- email/campaigns/{id}/
  slot         TEXT,                              -- optional section slot the note is about
  author       TEXT        NOT NULL,              -- SELF-DECLARED (see warning above)
  body         TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'link'  -- 'link' = token-gated public; 'console' = authenticated
                           CHECK (source IN ('link', 'console')),
  -- Set when the agent has acted on the note (or a human waved it off), so a
  -- session can ask for "what's still open" rather than re-reading history.
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read the review room and the MCP tool both make: a campaign's notes,
-- oldest first.
CREATE INDEX idx_mos_email_review_notes_campaign
  ON mos_email_review_notes (tenant_id, campaign_id, created_at);

-- "What's still open across the whole calendar" — the planning-session read.
CREATE INDEX idx_mos_email_review_notes_open
  ON mos_email_review_notes (tenant_id, created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE mos_email_review_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mos_email_review_notes FROM authenticated, anon;

CREATE TRIGGER trg_mos_email_review_notes_updated
  BEFORE UPDATE ON mos_email_review_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
