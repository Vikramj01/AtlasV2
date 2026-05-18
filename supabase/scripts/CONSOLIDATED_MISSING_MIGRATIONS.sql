-- ============================================================
-- CONSOLIDATED MISSING MIGRATIONS
-- Atlas V2 — base tables not created by any numbered migration file
--
-- Run this script once in the Supabase SQL editor on a fresh project
-- (or any project that is missing these tables).
--
-- Source: reconstructed from backend/src/services/database/*,
--         backend/src/types/*, and the guards embedded in numbered
--         migration files (20260405, 20260409, 20260410, etc.).
--
-- Order:
--   1. profiles                (auth scaffold + Stripe columns)
--   2. organisations + organisation_members
--   3. clients + client_platforms + client_pages
--   4. signals + signal_packs + signal_pack_signals + deployments + client_outputs
--   5. audits + audit_results + audit_reports
--   6. scheduled_audits
--   7. health_scores + health_snapshots + health_alerts
--   8. planning_sessions + planning_pages + planning_recommendations + planning_outputs
--   9. developer_shares + implementation_progress
-- ============================================================


-- ============================================================
-- SECTION 1: profiles
-- Source: inferred from 20260405_001_fix_user_deletion_cascade.sql
--         (profiles FK fix) + 20260409_001_stripe_subscriptions.sql
--         (Stripe columns) + authMiddleware / adminQueries usage
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id                        UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name                 TEXT,
  role                      TEXT        NOT NULL DEFAULT 'user'
                                        CHECK (role IN ('user', 'admin')),
  plan                      TEXT        NOT NULL DEFAULT 'free'
                                        CHECK (plan IN ('free', 'pro', 'agency')),
  organisation_id           UUID,       -- soft ref; populated when user joins an org
  stripe_customer_id        TEXT        UNIQUE,
  stripe_subscription_id    TEXT        UNIQUE,
  subscription_status       TEXT        NOT NULL DEFAULT 'inactive'
                                        CHECK (subscription_status IN (
                                          'inactive', 'active', 'trialing',
                                          'past_due', 'canceled'
                                        )),
  current_period_end        TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_organisation_id_idx      ON public.profiles (organisation_id);
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx   ON public.profiles (stripe_customer_id);
CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx ON public.profiles (stripe_subscription_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- Auto-create a profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger (shared helper — defined here, reused by all subsequent tables)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ============================================================
-- SECTION 2: organisations + organisation_members
-- Source: backend/src/services/database/orgQueries.ts
--         backend/src/types/organisation.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organisations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        TEXT        NOT NULL DEFAULT 'pro'
                          CHECK (plan IN ('free', 'pro', 'agency')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organisations_owner_id_idx ON public.organisations (owner_id);
CREATE INDEX IF NOT EXISTS organisations_slug_idx     ON public.organisations (slug);

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_owner_all" ON public.organisations;
CREATE POLICY "org_owner_all"
  ON public.organisations FOR ALL
  USING (owner_id = auth.uid());

-- Members can read the org they belong to
DROP POLICY IF EXISTS "org_members_select" ON public.organisations;
CREATE POLICY "org_members_select"
  ON public.organisations FOR SELECT
  USING (
    id IN (
      SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS trg_organisations_updated ON public.organisations;
CREATE TRIGGER trg_organisations_updated
  BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── organisation_members ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organisation_members (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL DEFAULT 'member'
                               CHECK (role IN ('owner', 'admin', 'member')),
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at      TIMESTAMPTZ,
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS organisation_members_user_id_idx ON public.organisation_members (user_id);

ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_isolation" ON public.organisation_members;
CREATE POLICY "org_members_isolation"
  ON public.organisation_members FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.organisation_members m2
      WHERE m2.user_id = auth.uid()
    )
  );


-- ============================================================
-- SECTION 3: clients + client_platforms + client_pages
-- Source: backend/src/services/database/clientQueries.ts
--         backend/src/types/organisation.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clients (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  website_url       TEXT        NOT NULL,
  business_type     TEXT        NOT NULL
                                CHECK (business_type IN (
                                  'ecommerce', 'saas', 'lead_gen',
                                  'content', 'marketplace', 'custom'
                                )),
  detected_platform TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'paused', 'archived')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy user_id column: handle_user_deletion references clients.user_id
-- Add as nullable so the cascade trigger still resolves even on older rows.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS clients_organisation_id_idx ON public.clients (organisation_id);
CREATE INDEX IF NOT EXISTS clients_status_idx          ON public.clients (status);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_org_isolation" ON public.clients;
CREATE POLICY "clients_org_isolation"
  ON public.clients FOR ALL
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS trg_clients_updated ON public.clients;
CREATE TRIGGER trg_clients_updated
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── client_platforms ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_platforms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform       TEXT        NOT NULL
                             CHECK (platform IN ('ga4', 'google_ads', 'meta', 'sgtm', 'tiktok', 'linkedin')),
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  measurement_id TEXT,
  config         JSONB       NOT NULL DEFAULT '{}',
  UNIQUE (client_id, platform)
);

CREATE INDEX IF NOT EXISTS client_platforms_client_id_idx ON public.client_platforms (client_id);

ALTER TABLE public.client_platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_platforms_org_isolation" ON public.client_platforms;
CREATE POLICY "client_platforms_org_isolation"
  ON public.client_platforms FOR ALL
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE organisation_id IN (
        SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── client_pages ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_pages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  label        TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  page_type    TEXT        NOT NULL DEFAULT 'custom',
  stage_order  INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_pages_client_id_idx ON public.client_pages (client_id, stage_order);

ALTER TABLE public.client_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_pages_org_isolation" ON public.client_pages;
CREATE POLICY "client_pages_org_isolation"
  ON public.client_pages FOR ALL
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE organisation_id IN (
        SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── client_outputs ────────────────────────────────────────────────────────────
-- Source: backend/src/types/signal.ts (ClientOutput interface)
--         20260427_001_remove_walkeros.sql (constraint guard references client_outputs)

CREATE TABLE IF NOT EXISTS public.client_outputs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  output_type        TEXT        NOT NULL
                                 CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide')),
  output_data        JSONB,
  file_path          TEXT,
  version            INTEGER     NOT NULL DEFAULT 1,
  source_deployments JSONB       NOT NULL DEFAULT '[]',
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_outputs_client_id_idx ON public.client_outputs (client_id, generated_at DESC);

ALTER TABLE public.client_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_outputs_org_isolation" ON public.client_outputs;
CREATE POLICY "client_outputs_org_isolation"
  ON public.client_outputs FOR ALL
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE organisation_id IN (
        SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
      )
    )
  );


-- ============================================================
-- SECTION 4: signals + signal_packs + signal_pack_signals + deployments
-- Source: backend/src/services/database/signalQueries.ts
--         backend/src/types/signal.ts
--         20260410_001_event_taxonomy.sql (adds taxonomy_event_id to signals)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.signals (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  key                    TEXT        NOT NULL,
  name                   TEXT        NOT NULL,
  description            TEXT        NOT NULL DEFAULT '',
  category               TEXT        NOT NULL DEFAULT 'custom'
                                     CHECK (category IN ('conversion', 'engagement', 'navigation', 'custom')),
  is_system              BOOLEAN     NOT NULL DEFAULT false,
  is_custom              BOOLEAN     NOT NULL DEFAULT false,
  source_action_primitive TEXT,
  required_params        JSONB       NOT NULL DEFAULT '[]',
  optional_params        JSONB       NOT NULL DEFAULT '[]',
  platform_mappings      JSONB       NOT NULL DEFAULT '{}',
  taxonomy_event_id      UUID,       -- FK added by 20260410; kept here to avoid duplicate ALTER
  taxonomy_path          TEXT,
  version                INTEGER     NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

-- user_id alias used by handle_user_deletion trigger
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS signals_organisation_id_idx ON public.signals (organisation_id);
CREATE INDEX IF NOT EXISTS signals_is_system_idx       ON public.signals (is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_signals_taxonomy        ON public.signals (taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_taxonomy_path   ON public.signals (taxonomy_path) WHERE taxonomy_path IS NOT NULL;

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signals_org_isolation" ON public.signals;
CREATE POLICY "signals_org_isolation"
  ON public.signals FOR ALL
  USING (organisation_id IS NULL OR organisation_id = auth.uid());

DROP TRIGGER IF EXISTS trg_signals_updated ON public.signals;
CREATE TRIGGER trg_signals_updated
  BEFORE UPDATE ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── signal_packs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.signal_packs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  business_type   TEXT        NOT NULL,
  is_system       BOOLEAN     NOT NULL DEFAULT false,
  version         INTEGER     NOT NULL DEFAULT 1,
  signals_count   INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_id alias used by handle_user_deletion trigger
ALTER TABLE public.signal_packs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS signal_packs_organisation_id_idx ON public.signal_packs (organisation_id);
CREATE INDEX IF NOT EXISTS signal_packs_is_system_idx       ON public.signal_packs (is_system) WHERE is_system = true;

ALTER TABLE public.signal_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_packs_org_isolation" ON public.signal_packs;
CREATE POLICY "signal_packs_org_isolation"
  ON public.signal_packs FOR ALL
  USING (organisation_id IS NULL OR organisation_id = auth.uid());

DROP TRIGGER IF EXISTS trg_signal_packs_updated ON public.signal_packs;
CREATE TRIGGER trg_signal_packs_updated
  BEFORE UPDATE ON public.signal_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── signal_pack_signals ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.signal_pack_signals (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id       UUID    NOT NULL REFERENCES public.signal_packs(id) ON DELETE CASCADE,
  signal_id     UUID    NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  stage_hint    TEXT,
  is_required   BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE (pack_id, signal_id)
);

CREATE INDEX IF NOT EXISTS signal_pack_signals_pack_id_idx ON public.signal_pack_signals (pack_id, display_order);

ALTER TABLE public.signal_pack_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_pack_signals_isolation" ON public.signal_pack_signals;
CREATE POLICY "signal_pack_signals_isolation"
  ON public.signal_pack_signals FOR ALL
  USING (
    pack_id IN (
      SELECT id FROM public.signal_packs
      WHERE organisation_id IS NULL OR organisation_id = auth.uid()
    )
  );

-- ── deployments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deployments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pack_id           UUID        NOT NULL REFERENCES public.signal_packs(id) ON DELETE CASCADE,
  signal_overrides  JSONB       NOT NULL DEFAULT '{}',
  deployed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_generated_at TIMESTAMPTZ,
  UNIQUE (client_id, pack_id)
);

-- user_id alias used by handle_user_deletion trigger
ALTER TABLE public.deployments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS deployments_client_id_idx ON public.deployments (client_id);
CREATE INDEX IF NOT EXISTS deployments_pack_id_idx   ON public.deployments (pack_id);

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deployments_org_isolation" ON public.deployments;
CREATE POLICY "deployments_org_isolation"
  ON public.deployments FOR ALL
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE organisation_id IN (
        SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()
      )
    )
  );


-- ============================================================
-- SECTION 5: audits + audit_results + audit_reports
-- Source: backend/src/services/database/queries.ts
--         frontend/src/types/audit.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audits (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id              UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  website_url            TEXT        NOT NULL,
  funnel_type            TEXT        NOT NULL CHECK (funnel_type IN ('ecommerce', 'saas', 'lead_gen')),
  region                 TEXT        NOT NULL DEFAULT 'us' CHECK (region IN ('us', 'eu', 'global')),
  status                 TEXT        NOT NULL DEFAULT 'queued'
                                     CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress               INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  test_email             TEXT,
  test_phone             TEXT,
  browserbase_session_id TEXT,
  error_message          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS audits_user_id_idx    ON public.audits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audits_client_id_idx  ON public.audits (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audits_status_idx     ON public.audits (status);

ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audits_owner" ON public.audits;
CREATE POLICY "audits_owner"
  ON public.audits FOR ALL
  USING (user_id = auth.uid());

-- ── audit_results ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_results (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id         UUID    NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  validation_layer TEXT    NOT NULL,
  rule_id          TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('pass', 'fail', 'warning')),
  severity         TEXT    NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  technical_details JSONB  NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_results_audit_id_idx ON public.audit_results (audit_id);

ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_results_owner" ON public.audit_results;
CREATE POLICY "audit_results_owner"
  ON public.audit_results FOR ALL
  USING (
    audit_id IN (SELECT id FROM public.audits WHERE user_id = auth.uid())
  );

-- user_id alias used by handle_user_deletion trigger
ALTER TABLE public.audit_results ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── audit_reports ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_reports (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id    UUID    NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE UNIQUE,
  report_json JSONB   NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_reports_audit_id_idx ON public.audit_reports (audit_id);

ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_reports_owner" ON public.audit_reports;
CREATE POLICY "audit_reports_owner"
  ON public.audit_reports FOR ALL
  USING (
    audit_id IN (SELECT id FROM public.audits WHERE user_id = auth.uid())
  );

-- user_id alias used by handle_user_deletion trigger
ALTER TABLE public.audit_reports ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;


-- ============================================================
-- SECTION 6: scheduled_audits
-- Source: backend/src/services/database/scheduleQueries.ts
--         backend/src/types/schedule.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scheduled_audits (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  website_url      TEXT        NOT NULL,
  funnel_type      TEXT        NOT NULL CHECK (funnel_type IN ('ecommerce', 'saas', 'lead_gen')),
  region           TEXT        NOT NULL DEFAULT 'us' CHECK (region IN ('us', 'eu', 'global')),
  url_map          JSONB       NOT NULL DEFAULT '{}',
  frequency        TEXT        NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  day_of_week      INTEGER     CHECK (day_of_week BETWEEN 0 AND 6),
  hour_utc         INTEGER     NOT NULL DEFAULT 2 CHECK (hour_utc BETWEEN 0 AND 23),
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  next_run_at      TIMESTAMPTZ NOT NULL,
  last_run_at      TIMESTAMPTZ,
  last_audit_id    UUID        REFERENCES public.audits(id) ON DELETE SET NULL,
  last_audit_score INTEGER,
  test_email       TEXT,
  test_phone       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_audits_user_id_idx    ON public.scheduled_audits (user_id);
CREATE INDEX IF NOT EXISTS scheduled_audits_next_run_idx   ON public.scheduled_audits (next_run_at) WHERE is_active = true;

ALTER TABLE public.scheduled_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_audits_owner" ON public.scheduled_audits;
CREATE POLICY "scheduled_audits_owner"
  ON public.scheduled_audits FOR ALL
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_scheduled_audits_updated ON public.scheduled_audits;
CREATE TRIGGER trg_scheduled_audits_updated
  BEFORE UPDATE ON public.scheduled_audits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ============================================================
-- SECTION 7: health_scores + health_snapshots + health_alerts
-- Source: backend/src/services/database/healthQueries.ts
--         backend/src/types/health.ts
--         20260609001_phase4_health_extensions.sql (adds platform_acceptance_score)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.health_scores (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url              TEXT,
  overall_score            NUMERIC(5,2) NOT NULL DEFAULT 0,
  signal_health            NUMERIC(5,2) NOT NULL DEFAULT 0,
  capi_delivery_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  consent_coverage         NUMERIC(5,2) NOT NULL DEFAULT 0,
  tag_firing_rate          NUMERIC(5,2) NOT NULL DEFAULT 0,
  platform_acceptance_score NUMERIC(5,2),
  last_audit_id            UUID        REFERENCES public.audits(id) ON DELETE SET NULL,
  last_audit_at            TIMESTAMPTZ,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.health_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_scores_owner" ON public.health_scores;
CREATE POLICY "health_scores_owner"
  ON public.health_scores FOR ALL
  USING (user_id = auth.uid());

-- ── health_snapshots ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.health_snapshots (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  overall_score             NUMERIC(5,2) NOT NULL,
  signal_health             NUMERIC(5,2),
  capi_delivery_rate        NUMERIC(5,2),
  consent_coverage          NUMERIC(5,2),
  tag_firing_rate           NUMERIC(5,2),
  platform_acceptance_score NUMERIC(5,2),
  snapshot_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_snapshots_user_id_idx ON public.health_snapshots (user_id, snapshot_at DESC);

ALTER TABLE public.health_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_snapshots_owner" ON public.health_snapshots;
CREATE POLICY "health_snapshots_owner"
  ON public.health_snapshots FOR ALL
  USING (user_id = auth.uid());

-- ── health_alerts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.health_alerts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type           TEXT        NOT NULL CHECK (alert_type IN (
                         'capi_delivery', 'tag_firing', 'consent_missing',
                         'no_recent_audit', 'capi_not_configured',
                         'recon_critical_finding', 'recon_brief_misaligned',
                         'connection_expired'
                       )),
  severity             TEXT        NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title                TEXT        NOT NULL,
  message              TEXT        NOT NULL,
  metric_value         NUMERIC,
  threshold_value      NUMERIC,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  consecutive_ok_count INTEGER     NOT NULL DEFAULT 0,
  triggered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  acknowledged_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_alerts_user_id_idx    ON public.health_alerts (user_id, is_active);
CREATE INDEX IF NOT EXISTS health_alerts_triggered_idx  ON public.health_alerts (triggered_at DESC);

ALTER TABLE public.health_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_alerts_owner" ON public.health_alerts;
CREATE POLICY "health_alerts_owner"
  ON public.health_alerts FOR ALL
  USING (user_id = auth.uid());


-- ============================================================
-- SECTION 8: planning_sessions + planning_pages
--            + planning_recommendations + planning_outputs
-- Source: backend/src/services/database/planningQueries.ts
--         backend/src/types/planning.ts
--         20260411_001_planning_rec_taxonomy.sql (taxonomy columns on recommendations)
--         20260428_001_tracking_plan_versions.sql (tracking_plan_versions)
--         20260427_001_remove_walkeros.sql (output_type constraint)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planning_sessions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  website_url         TEXT        NOT NULL,
  business_type       TEXT        NOT NULL,
  business_description TEXT,
  selected_platforms  TEXT[]      NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'setup'
                                  CHECK (status IN (
                                    'setup', 'scanning', 'review_ready',
                                    'generating', 'outputs_ready', 'failed'
                                  )),
  error_message       TEXT,
  rescan_results      JSONB,
  last_rescan_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS planning_sessions_user_id_idx    ON public.planning_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS planning_sessions_client_id_idx  ON public.planning_sessions (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE public.planning_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_sessions_owner" ON public.planning_sessions;
CREATE POLICY "planning_sessions_owner"
  ON public.planning_sessions FOR ALL
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_planning_sessions_updated ON public.planning_sessions;
CREATE TRIGGER trg_planning_sessions_updated
  BEFORE UPDATE ON public.planning_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── planning_pages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.planning_pages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES public.planning_sessions(id) ON DELETE CASCADE,
  url               TEXT        NOT NULL,
  page_type         TEXT        NOT NULL,
  page_order        INTEGER     NOT NULL DEFAULT 0,
  page_title        TEXT,
  meta_description  TEXT,
  screenshot_url    TEXT,
  screenshot_width  INTEGER,
  screenshot_height INTEGER,
  existing_tracking JSONB       NOT NULL DEFAULT '[]',
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'scanning', 'done', 'failed')),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS planning_pages_session_id_idx ON public.planning_pages (session_id, page_order);

ALTER TABLE public.planning_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_pages_owner" ON public.planning_pages;
CREATE POLICY "planning_pages_owner"
  ON public.planning_pages FOR ALL
  USING (
    session_id IN (
      SELECT id FROM public.planning_sessions WHERE user_id = auth.uid()
    )
  );

-- ── planning_recommendations ──────────────────────────────────────────────────
-- taxonomy_event_id and taxonomy_path are included here directly
-- (normally added by 20260411_001_planning_rec_taxonomy.sql via ALTER TABLE;
--  including inline here means the ALTER in that file becomes a no-op).

CREATE TABLE IF NOT EXISTS public.planning_recommendations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id               UUID        NOT NULL REFERENCES public.planning_pages(id) ON DELETE CASCADE,
  element_selector      TEXT,
  element_text          TEXT,
  element_type          TEXT,
  action_type           TEXT        NOT NULL,
  event_name            TEXT        NOT NULL,
  required_params       JSONB       NOT NULL DEFAULT '[]',
  optional_params       JSONB       NOT NULL DEFAULT '[]',
  bbox_x                NUMERIC,
  bbox_y                NUMERIC,
  bbox_width            NUMERIC,
  bbox_height           NUMERIC,
  confidence_score      NUMERIC(4,3) NOT NULL DEFAULT 0,
  business_justification TEXT       NOT NULL DEFAULT '',
  affected_platforms    TEXT[]      NOT NULL DEFAULT '{}',
  user_decision         TEXT        CHECK (user_decision IN ('approved', 'skipped', 'modified')),
  modified_config       JSONB,
  decided_at            TIMESTAMPTZ,
  source                TEXT        NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  taxonomy_event_id     UUID        REFERENCES public.event_taxonomy(id) ON DELETE SET NULL,
  taxonomy_path         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planning_recommendations_page_id_idx         ON public.planning_recommendations (page_id);
CREATE INDEX IF NOT EXISTS planning_recommendations_user_decision_idx   ON public.planning_recommendations (user_decision);
CREATE INDEX IF NOT EXISTS idx_planning_rec_taxonomy_event_id           ON public.planning_recommendations (taxonomy_event_id)
  WHERE taxonomy_event_id IS NOT NULL;

ALTER TABLE public.planning_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_recs_owner" ON public.planning_recommendations;
CREATE POLICY "planning_recs_owner"
  ON public.planning_recommendations FOR ALL
  USING (
    page_id IN (
      SELECT p.id FROM public.planning_pages p
      JOIN public.planning_sessions s ON p.session_id = s.id
      WHERE s.user_id = auth.uid()
    )
  );

-- ── planning_outputs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.planning_outputs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL REFERENCES public.planning_sessions(id) ON DELETE CASCADE,
  output_type   TEXT        NOT NULL
                            CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide')),
  content       JSONB,
  content_text  TEXT,
  storage_path  TEXT,
  file_size_bytes INTEGER,
  mime_type     TEXT        NOT NULL DEFAULT 'application/json',
  version       INTEGER     NOT NULL DEFAULT 1,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planning_outputs_session_id_idx ON public.planning_outputs (session_id, generated_at DESC);

ALTER TABLE public.planning_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_outputs_owner" ON public.planning_outputs;
CREATE POLICY "planning_outputs_owner"
  ON public.planning_outputs FOR ALL
  USING (
    session_id IN (
      SELECT id FROM public.planning_sessions WHERE user_id = auth.uid()
    )
  );

-- ── tracking_plan_versions ────────────────────────────────────────────────────
-- Source: 20260428_001_tracking_plan_versions.sql (normally guarded;
--         created inline here because planning_sessions now exists above)

CREATE TABLE IF NOT EXISTS public.tracking_plan_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES public.planning_sessions(id) ON DELETE CASCADE,
  version         INTEGER     NOT NULL,
  label           TEXT,
  gtm_output_id   UUID        REFERENCES public.planning_outputs(id) ON DELETE SET NULL,
  spec_output_id  UUID        REFERENCES public.planning_outputs(id) ON DELETE SET NULL,
  guide_output_id UUID        REFERENCES public.planning_outputs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);

CREATE INDEX IF NOT EXISTS tracking_plan_versions_session_id_idx
  ON public.tracking_plan_versions (session_id, version DESC);

ALTER TABLE public.tracking_plan_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access own session versions" ON public.tracking_plan_versions;
CREATE POLICY "Users access own session versions"
  ON public.tracking_plan_versions FOR ALL
  USING (
    session_id IN (SELECT id FROM public.planning_sessions WHERE user_id = auth.uid())
  );


-- ============================================================
-- SECTION 9: developer_shares + implementation_progress
-- Source: backend/src/services/database/developerQueries.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.developer_shares (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             UUID        NOT NULL REFERENCES public.planning_sessions(id) ON DELETE CASCADE,
  user_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token            TEXT        NOT NULL UNIQUE,
  developer_name         TEXT,
  developer_email        TEXT,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  invite_sent_at         TIMESTAMPTZ,
  marketer_notified_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_shares_session_id_idx ON public.developer_shares (session_id);
CREATE INDEX IF NOT EXISTS developer_shares_user_id_idx    ON public.developer_shares (user_id);
CREATE INDEX IF NOT EXISTS developer_shares_token_idx      ON public.developer_shares (share_token);

ALTER TABLE public.developer_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "developer_shares_owner" ON public.developer_shares;
CREATE POLICY "developer_shares_owner"
  ON public.developer_shares FOR ALL
  USING (user_id = auth.uid());

-- ── implementation_progress ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.implementation_progress (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id         UUID        NOT NULL REFERENCES public.developer_shares(id) ON DELETE CASCADE,
  page_id          UUID        NOT NULL REFERENCES public.planning_pages(id) ON DELETE CASCADE,
  page_label       TEXT        NOT NULL DEFAULT '',
  page_url         TEXT        NOT NULL DEFAULT '',
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
  developer_notes  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (share_id, page_id)
);

CREATE INDEX IF NOT EXISTS implementation_progress_share_id_idx ON public.implementation_progress (share_id);

ALTER TABLE public.implementation_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "implementation_progress_owner" ON public.implementation_progress;
CREATE POLICY "implementation_progress_owner"
  ON public.implementation_progress FOR ALL
  USING (
    share_id IN (
      SELECT id FROM public.developer_shares WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS trg_impl_progress_updated ON public.implementation_progress;
CREATE TRIGGER trg_impl_progress_updated
  BEFORE UPDATE ON public.implementation_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
