-- Read-only console material, rebuilt from post.md; never an approval source.
ALTER TABLE pack_social.posts ADD COLUMN IF NOT EXISTS post_snapshot JSONB;
