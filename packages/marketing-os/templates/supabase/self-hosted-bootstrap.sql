-- ============================================================================
-- Marketing OS — self-hosted deployment bootstrap
-- ============================================================================
-- Run this against the Supabase database of a SELF-HOSTED Marketing OS console
-- (your own Vercel + Supabase standing up the OSS template).
--
-- WHY THIS FILE EXISTS
--   Two of the tables a console needs create themselves: lib/email/repo.ts and
--   lib/social/repo.ts both CREATE TABLE IF NOT EXISTS on first write. The rest
--   do not. A self-hosted deployment that never ran the platform migrations
--   therefore reaches a very convincing halfway state — artifacts save,
--   previews render, the agent answers — while every projection-backed surface
--   (campaign list, calendar, contact sheet, review notes) reads empty and
--   silently degrades, because those read paths are all written to
--   degrade-don't-throw. Nothing errors anywhere. It simply shows nothing.
--
--   This closes that gap in one paste.
--
-- WHAT IT CREATES
--   Account, Tenant        — the rows every tenant-scoped read joins through.
--                            Without a Tenant row, tenantIdForShop() returns
--                            null and every projection read returns [] with no
--                            error surfaced anywhere.
--   mos_email_campaigns    — the campaign index the console + cron read.
--   mos_calendar_items     — the ONE cross-channel calendar projection.
--   mos_email_review_notes — review-link notes (spec 25).
--   mos_action_proposals   — the Action gate's pending proposals.
--   mos_action_audit       — the Action gate's ledger.
--   mos_design_surfaces    — Design Studio boards bound to campaigns/posts.
--   mos_skill_enablements  — the per-tenant pack registry.
--   provider_connections   — Klaviyo/Google/Meta connection state.
--   pack_social.posts      — the social pack's own index (spec 26 §3). First
--                            PACK-OWNED schema: pack-private state lives in
--                            pack_social, the shared view stays in
--                            mos_calendar_items.
--
--   NOT created here: mos_email_artifacts and mos_social_artifacts. Those
--   self-create on first write, and while the git lane is deferred they hold
--   the artifacts themselves. Once artifacts move to the store repo (spec 22
--   D1 — files are truth), they become caches, and everything in this file
--   becomes a rebuildable index the cron sweep can reconstruct from the repo.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / OR REPLACE / exception-guarded.
-- Safe to re-run, and safe on a partially-provisioned database.
-- STRUCTURE ONLY: no data. Seed your Tenant row at the bottom.
-- ============================================================================

-- --- dependencies the tables below reference ------------------------------

CREATE OR REPLACE FUNCTION public.update_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

DO $$ BEGIN
  CREATE TYPE public."McpSubdomainStatus" AS ENUM ('NOT_PROVISIONED', 'ROUTER_ONLY', 'DIRECT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.connection_status AS ENUM ('active', 'expired', 'needs_reauth', 'disconnected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.provider_name AS ENUM ('google', 'meta', 'klaviyo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- tables + indexes (dumped from the canonical platform schema) ----------

CREATE TABLE IF NOT EXISTS public."Account" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS public."Tenant" (
    id text NOT NULL,
    "accountId" text NOT NULL,
    shop text NOT NULL,
    "agentsUrl" text,
    "apiKeyHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSyncedAt" timestamp(3) without time zone,
    "storeSlug" text NOT NULL,
    "githubRepo" text,
    "mcpSubdomainStatus" public."McpSubdomainStatus" DEFAULT 'NOT_PROVISIONED'::public."McpSubdomainStatus" NOT NULL,
    "uninstalledAt" timestamp(3) without time zone
);
CREATE TABLE IF NOT EXISTS public.mos_action_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid,
    tenant_id text NOT NULL,
    kind text NOT NULL,
    params jsonb NOT NULL,
    preview_hash text NOT NULL,
    actor text NOT NULL,
    outcome text NOT NULL,
    result jsonb,
    detail text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mos_action_audit_outcome_check CHECK ((outcome = ANY (ARRAY['executed'::text, 'failed'::text, 'declined'::text, 'refused'::text, 'invalidated'::text])))
);
CREATE TABLE IF NOT EXISTS public.mos_action_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    kind text NOT NULL,
    params jsonb NOT NULL,
    risk text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    executor text NOT NULL,
    summary text NOT NULL,
    preview jsonb NOT NULL,
    preview_hash text NOT NULL,
    nonce text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_by text DEFAULT 'agent'::text NOT NULL,
    approved_by text,
    decided_at timestamp with time zone,
    executed_at timestamp with time zone,
    result jsonb,
    invalidated_reason text,
    slack jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mos_action_proposals_executor_check CHECK ((executor = ANY (ARRAY['app'::text, 'agents'::text]))),
    CONSTRAINT mos_action_proposals_risk_check CHECK ((risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT mos_action_proposals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'executing'::text, 'executed'::text, 'failed'::text, 'declined'::text, 'invalidated'::text, 'expired'::text])))
);
CREATE TABLE IF NOT EXISTS public.mos_calendar_items (
    tenant_id text NOT NULL,
    channel text NOT NULL,
    item_id text NOT NULL,
    pack_id text NOT NULL,
    month text NOT NULL,
    scheduled_at timestamp with time zone,
    status text NOT NULL,
    title text NOT NULL,
    intent text DEFAULT ''::text NOT NULL,
    thumbnail_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.mos_design_surfaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    kind text NOT NULL,
    bound_to_type text NOT NULL,
    bound_to_id text NOT NULL,
    penpot_team_id uuid NOT NULL,
    penpot_project_id uuid NOT NULL,
    penpot_file_id uuid NOT NULL,
    penpot_page_id uuid NOT NULL,
    status text DEFAULT 'composing'::text NOT NULL,
    brand_lineage jsonb DEFAULT '{}'::jsonb NOT NULL,
    exports jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text DEFAULT 'agent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mos_design_surfaces_created_by_check CHECK ((created_by = ANY (ARRAY['agent'::text, 'user'::text]))),
    CONSTRAINT mos_design_surfaces_status_check CHECK ((status = ANY (ARRAY['composing'::text, 'ready'::text, 'in_review'::text, 'edited'::text, 'exported'::text])))
);
CREATE TABLE IF NOT EXISTS public.mos_email_campaigns (
    id text NOT NULL,
    tenant_id text NOT NULL,
    calendar_month text NOT NULL,
    archetype text NOT NULL,
    audience_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    subject text,
    scheduled_at timestamp with time zone,
    status text DEFAULT 'proposed'::text NOT NULL,
    design_surface_id uuid,
    skeleton_ref text,
    skeleton_version integer,
    action_proposal_id uuid,
    klaviyo_template_id text,
    klaviyo_campaign_id text,
    klaviyo_message_id text,
    sent_at timestamp with time zone,
    readback jsonb,
    repo_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mos_email_campaigns_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'drafted'::text, 'scheduled'::text, 'sent'::text, 'measured'::text, 'declined'::text, 'cancelled'::text, 'failed'::text])))
);
CREATE TABLE IF NOT EXISTS public.mos_skill_enablements (
    tenant_id text NOT NULL,
    pack_id text NOT NULL,
    version text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled_by text,
    enabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.provider_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    provider public.provider_name NOT NULL,
    external_account text,
    granted_scopes text[],
    secret_ref uuid,
    provider_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.connection_status DEFAULT 'active'::public.connection_status NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_token_refresh timestamp with time zone,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE ONLY public."Account"
      ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public."Tenant"
      ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_action_audit
      ADD CONSTRAINT mos_action_audit_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_action_proposals
      ADD CONSTRAINT mos_action_proposals_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_calendar_items
      ADD CONSTRAINT mos_calendar_items_pkey PRIMARY KEY (tenant_id, channel, item_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_design_surfaces
      ADD CONSTRAINT mos_design_surfaces_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_design_surfaces
      ADD CONSTRAINT mos_design_surfaces_tenant_id_bound_to_type_bound_to_id_kin_key UNIQUE (tenant_id, bound_to_type, bound_to_id, kind);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_email_campaigns
      ADD CONSTRAINT mos_email_campaigns_pkey PRIMARY KEY (tenant_id, id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_skill_enablements
      ADD CONSTRAINT mos_skill_enablements_pkey PRIMARY KEY (tenant_id, pack_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.provider_connections
      ADD CONSTRAINT provider_connections_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.provider_connections
      ADD CONSTRAINT provider_connections_tenant_id_provider_key UNIQUE (tenant_id, provider);
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Account_email_key" ON public."Account" USING btree (email);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_apiKeyHash_key" ON public."Tenant" USING btree ("apiKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_shop_key" ON public."Tenant" USING btree (shop);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_storeSlug_key" ON public."Tenant" USING btree ("storeSlug");
CREATE INDEX IF NOT EXISTS idx_mos_action_audit_proposal ON public.mos_action_audit USING btree (proposal_id);
CREATE INDEX IF NOT EXISTS idx_mos_action_audit_tenant ON public.mos_action_audit USING btree (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_mos_action_proposals_pending ON public.mos_action_proposals USING btree (status, created_at) WHERE (status = 'proposed'::text);
CREATE INDEX IF NOT EXISTS idx_mos_action_proposals_tenant ON public.mos_action_proposals USING btree (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mos_calendar_items_month ON public.mos_calendar_items USING btree (tenant_id, month);
CREATE INDEX IF NOT EXISTS idx_mos_calendar_items_sched ON public.mos_calendar_items USING btree (tenant_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_mos_design_surfaces_file ON public.mos_design_surfaces USING btree (penpot_file_id);
CREATE INDEX IF NOT EXISTS idx_mos_design_surfaces_tenant ON public.mos_design_surfaces USING btree (tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_mos_email_campaigns_month ON public.mos_email_campaigns USING btree (tenant_id, calendar_month);
CREATE INDEX IF NOT EXISTS idx_mos_email_campaigns_scheduled ON public.mos_email_campaigns USING btree (status, scheduled_at) WHERE (status = 'scheduled'::text);
CREATE INDEX IF NOT EXISTS idx_mos_email_campaigns_sent ON public.mos_email_campaigns USING btree (status, sent_at) WHERE (status = 'sent'::text);
DO $$ BEGIN
  CREATE TRIGGER provider_connections_updated_at BEFORE UPDATE ON public.provider_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_mos_action_proposals_updated BEFORE UPDATE ON public.mos_action_proposals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_mos_calendar_items_updated BEFORE UPDATE ON public.mos_calendar_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_mos_design_surfaces_updated BEFORE UPDATE ON public.mos_design_surfaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_mos_email_campaigns_updated BEFORE UPDATE ON public.mos_email_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_mos_skill_enablements_updated BEFORE UPDATE ON public.mos_skill_enablements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;  -- trigger already present
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public."Tenant"
      ADD CONSTRAINT "Tenant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_action_audit
      ADD CONSTRAINT mos_action_audit_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.mos_action_proposals(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_action_proposals
      ADD CONSTRAINT mos_action_proposals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_calendar_items
      ADD CONSTRAINT mos_calendar_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_design_surfaces
      ADD CONSTRAINT mos_design_surfaces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_email_campaigns
      ADD CONSTRAINT mos_email_campaigns_action_proposal_id_fkey FOREIGN KEY (action_proposal_id) REFERENCES public.mos_action_proposals(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_email_campaigns
      ADD CONSTRAINT mos_email_campaigns_design_surface_id_fkey FOREIGN KEY (design_surface_id) REFERENCES public.mos_design_surfaces(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_email_campaigns
      ADD CONSTRAINT mos_email_campaigns_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.mos_skill_enablements
      ADD CONSTRAINT mos_skill_enablements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY public.provider_connections
      ADD CONSTRAINT provider_connections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public."Tenant"(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;          -- constraint already present
  WHEN duplicate_table THEN NULL;
  WHEN invalid_table_definition THEN NULL;  -- primary key already defined
END $$;
ALTER TABLE public."Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_calendar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_design_surfaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mos_skill_enablements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY no_direct_access ON public.provider_connections TO authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;  -- policy already present
END $$;
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;


-- --- review notes (spec 25) -----------------------------------------------
-- Notes arrive through a TOKEN-GATED PUBLIC page. A valid token proves
-- possession of a link, not identity: `author` is whatever the reviewer typed
-- into a text box. Never treat a note as approval or authorisation. Approval
-- keeps its own path — Slack, a real user id, a row in mos_action_audit.

CREATE TABLE IF NOT EXISTS public.mos_email_review_notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT        NOT NULL REFERENCES public."Tenant"(id) ON DELETE CASCADE,
  campaign_id  TEXT        NOT NULL,
  slot         TEXT,
  author       TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'link' CHECK (source IN ('link', 'console')),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mos_email_review_notes_campaign
  ON public.mos_email_review_notes (tenant_id, campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mos_email_review_notes_open
  ON public.mos_email_review_notes (tenant_id, created_at) WHERE resolved_at IS NULL;

-- --- governance -----------------------------------------------------------
-- RLS on, authenticated + anon denied. The app connects as owner through the
-- pooled connection; none of this is reachable with a browser-side key.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mos_email_campaigns','mos_calendar_items','mos_email_review_notes',
    'mos_action_proposals','mos_action_audit','mos_design_surfaces',
    'mos_skill_enablements','provider_connections'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

-- --- updated_at maintenance -----------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mos_email_campaigns','mos_calendar_items','mos_email_review_notes',
    'mos_skill_enablements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================================
-- PACK SCHEMAS — pack_social (spec 26 §3)
-- ============================================================================
-- Pack-owned state lives in the pack's own schema, not behind another `mos_`
-- prefix in public: clean ownership, trivial teardown, collision-free for a
-- third-party ecosystem. Mirrors migrations/009_pack_social.sql — keep the two
-- in step.
--
-- Without this, a self-hosted console runs social exactly as far as the
-- artifacts (posts save, the agent answers) and then shows nothing anywhere
-- the index is read — the same silent half-state this file exists to prevent.

CREATE SCHEMA IF NOT EXISTS pack_social;

CREATE TABLE IF NOT EXISTS pack_social.posts (
  tenant_id      TEXT        NOT NULL REFERENCES public."Tenant"(id) ON DELETE CASCADE,
  id             TEXT        NOT NULL,
  channel        TEXT        NOT NULL,
  calendar_month TEXT        NOT NULL,
  status         TEXT        NOT NULL,
  scheduled_at   TIMESTAMPTZ,
  target_link    TEXT,
  copy           TEXT,
  surface_file_id TEXT,
  surface_page_id TEXT,
  surface_revn    INTEGER,
  approval_hash   TEXT,
  approval_at     TIMESTAMPTZ,
  platform_id     TEXT,
  platform_permalink TEXT,
  published_at    TIMESTAMPTZ,
  failure         TEXT,
  repo_path      TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_pack_social_posts_month
  ON pack_social.posts (tenant_id, calendar_month, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_pack_social_posts_scheduled
  ON pack_social.posts (tenant_id, scheduled_at) WHERE status = 'scheduled';

ALTER TABLE pack_social.posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pack_social.posts FROM authenticated, anon;
REVOKE ALL ON SCHEMA pack_social FROM authenticated, anon;

DROP TRIGGER IF EXISTS trg_pack_social_posts_updated ON pack_social.posts;
CREATE TRIGGER trg_pack_social_posts_updated
  BEFORE UPDATE ON pack_social.posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- SEED YOUR ACCOUNT + TENANT ROWS
-- ============================================================================
-- Every tenant-scoped read joins through Tenant. Until the row exists,
-- tenantIdForShop() returns null and the console renders empty states with no
-- error anywhere — the exact silent failure this file exists to prevent.
--
-- Edit the two values and run:
--
--   INSERT INTO public."Account" (id, name, "createdAt")
--   VALUES ('self-hosted', 'Self-hosted', now())
--   ON CONFLICT (id) DO NOTHING;
--
--   INSERT INTO public."Tenant" (id, "accountId", shop, "storeSlug", "apiKeyHash", "createdAt")
--   VALUES (gen_random_uuid()::text, 'self-hosted',
--           'YOUR-STORE.myshopify.com',       -- must match SHOPIFY_STORE_URL exactly
--           'YOUR-STORE', '', now())
--   ON CONFLICT DO NOTHING;
--
-- Verify:  SELECT id, shop FROM public."Tenant";
--
-- Then rebuild the index from your artifacts by letting the email cron sweep
-- run, or by re-saving each campaign — the projections are derived, never
-- authored.
-- ============================================================================
