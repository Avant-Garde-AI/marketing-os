-- =============================================================================
-- 010 — pack_social.posts.group_key (spec 26 D3: the review unit is a GROUP)
-- =============================================================================
-- One creative idea usually ships as several posts — an Instagram square, a
-- story, a Threads variant. Reviewed apart, a brand's register drifts between
-- platforms and nobody sees it; reviewed together, that drift is the first
-- thing you notice. So the review room's unit is the post GROUP.
--
-- D3 resolves as a CONVENTION rather than a group artifact: variants share a
-- `groupId` in their post.md front matter, and a post without one is its own
-- group of one (group_key falls back to the post id). No second artifact type
-- to drift from the posts it references, and this column is exactly the key a
-- first-class group artifact would later be built on.
--
-- Derived from the artifact like every other column here (spec 22 D1), so it
-- is rebuildable by re-reading posts. Backfilled to the post id, which is the
-- correct group-of-one value for every row written before this migration.
-- =============================================================================

ALTER TABLE pack_social.posts
  ADD COLUMN IF NOT EXISTS group_key TEXT;

-- Every pre-existing row is a group of one.
UPDATE pack_social.posts SET group_key = id WHERE group_key IS NULL;

ALTER TABLE pack_social.posts
  ALTER COLUMN group_key SET NOT NULL;

-- The review room's read: "every variant of this group, for this tenant".
CREATE INDEX IF NOT EXISTS idx_pack_social_posts_group
  ON pack_social.posts (tenant_id, group_key);
