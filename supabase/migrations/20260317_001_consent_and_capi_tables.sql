-- ============================================================
-- Atlas Phase 1: Consent Integration Hub + CAPI Module
-- Supabase Migration (corrected)
--
-- Fix: Original referenced non-existent `projects` and `organizations`
-- tables. Atlas uses `profiles` tied to auth.users. project_id is used
-- as TEXT (MVP: equals user_id). organization_id is UUID referencing
-- auth.users directly, no org-level FK needed for personal accounts.
-- ============================================================

-- ============================================================
-- PART 1: CONSENT INTEGRATION HUB TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS consent_configs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT        NOT NULL,
  organization_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode              TEXT        NOT NULL DEFAULT 'builtin'
                                CHECK (mode IN ('builtin','onetrust','cookiebot','usercentrics')),
  regulation        TEXT        NOT NULL DEFAULT 'gdpr'
                                CHECK (regulation IN ('gdpr','ccpa','custom')),
  categories        JSONB       NOT NULL DEFAULT '[
    {"id":"analytics","name":"Analytics","description":"Cookies that help us understand how visitors interact with the website.","required":false,"default_state":"pending"},
    {"id":"marketing","name":"Marketing","description":"Cookies used to deliver relevant ads and track campaign performance.","required":false,"default_state":"pending"},
    {"id":"personalisation","name":"Personalisation","description":"Cookies that enable personalised content and recommendations.","required":false,"default_state":"pending"},
    {"id":"functional","name":"Functional","description":"Essential cookies required for the website to function properly.","required":true,"default_state":"granted"}
  ]'::jsonb,
  banner_config     JSONB       DEFAULT '{
    "position":"bottom_bar",
    "colors":{"background":"#FFFFFF","button_primary":"#1B2A4A","button_secondary":"#F0F7FA","text":"#1A1A2E"},
    "copy":{"heading":"We value your privacy","body":"We use cookies to enhance your browsing experience and analyse our traffic.","accept_button":"Accept All","reject_button":"Reject All","manage_link":"Manage Preferences"},
    "logo_url":null,
    "ttl_days":365
  }'::jsonb,
  cmp_config        JSONB       DEFAULT NULL,
  gcm_enabled       BOOLEAN     NOT NULL DEFAULT true,
  gcm_mapping       JSONB       DEFAULT '{
    "analytics":["analytics_storage"],
    "marketing":["ad_storage","ad_user_data","ad_personalization"],
    "personalisation":["personalization_storage"],
    "functional":["functionality_storage","security_storage"]
  }'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE TABLE IF NOT EXISTS consent_records (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT        NOT NULL,
  organization_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id        TEXT        NOT NULL,
  consent_id        TEXT        NOT NULL,
  decisions         JSONB       NOT NULL,
  gcm_state         JSONB       DEFAULT NULL,
  regulation        TEXT        NOT NULL,
  ip_country        TEXT        DEFAULT NULL,
  user_agent        TEXT        DEFAULT NULL,
  source            TEXT        NOT NULL DEFAULT 'builtin'
                                CHECK (source IN ('builtin','onetrust','cookiebot','usercentrics','api')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_project_visitor ON consent_records(project_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_project_created ON consent_records(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_records_expires        ON consent_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_consent_records_source         ON consent_records(project_id, source);


-- ============================================================
-- PART 2: CONVERSION API MODULE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS capi_providers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            TEXT        NOT NULL,
  organization_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              TEXT        NOT NULL
                                    CHECK (provider IN ('meta','google','tiktok','linkedin','snapchat')),
  status                TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','testing','active','paused','error')),
  credentials           JSONB       NOT NULL DEFAULT '{}',
  event_mapping         JSONB       NOT NULL DEFAULT '[]',
  identifier_config     JSONB       NOT NULL DEFAULT '{"enabled_identifiers":[],"source_mapping":{}}',
  dedup_config          JSONB       NOT NULL DEFAULT '{"enabled":true,"event_id_field":"event_id","dedup_window_minutes":2880}',
  test_event_code       TEXT        DEFAULT NULL,
  error_message         TEXT        DEFAULT NULL,
  last_health_check     TIMESTAMPTZ DEFAULT NULL,
  events_sent_total     BIGINT      NOT NULL DEFAULT 0,
  events_failed_total   BIGINT      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, provider)
);

CREATE TABLE IF NOT EXISTS capi_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_config_id    UUID        NOT NULL REFERENCES capi_providers(id) ON DELETE CASCADE,
  organization_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atlas_event_id        TEXT        NOT NULL,
  provider_event_name   TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'received'
                                    CHECK (status IN (
                                      'received','consent_valid','consent_blocked','validated',
                                      'prepared','delivered','delivery_failed','dead_letter'
                                    )),
  consent_state         JSONB       NOT NULL DEFAULT '{}',
  identifiers_sent      INTEGER     NOT NULL DEFAULT 0,
  event_value           DECIMAL(12,2) DEFAULT NULL,
  event_currency        TEXT        DEFAULT NULL,
  provider_response     JSONB       DEFAULT NULL,
  retry_count           INTEGER     NOT NULL DEFAULT 0,
  error_code            TEXT        DEFAULT NULL,
  error_message         TEXT        DEFAULT NULL,
  processed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at          TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_capi_events_provider_status    ON capi_events(provider_config_id, status);
CREATE INDEX IF NOT EXISTS idx_capi_events_provider_processed ON capi_events(provider_config_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_status_retry       ON capi_events(status, retry_count) WHERE status = 'delivery_failed';
CREATE INDEX IF NOT EXISTS idx_capi_events_dead_letter        ON capi_events(provider_config_id) WHERE status = 'dead_letter';

CREATE TABLE IF NOT EXISTS capi_event_queue (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_config_id  UUID        NOT NULL REFERENCES capi_providers(id) ON DELETE CASCADE,
  organization_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload             JSONB       NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','completed','failed')),
  retry_count         INTEGER     NOT NULL DEFAULT 0,
  max_retries         INTEGER     NOT NULL DEFAULT 3,
  next_retry_at       TIMESTAMPTZ DEFAULT NULL,
  error_message       TEXT        DEFAULT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_capi_queue_pending  ON capi_event_queue(status, next_retry_at) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_capi_queue_provider ON capi_event_queue(provider_config_id, status);


-- ============================================================
-- PART 3: ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE consent_configs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE capi_providers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE capi_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE capi_event_queue  ENABLE ROW LEVEL SECURITY;

-- Simplified RLS: organization_id = the owning user's auth.uid()
-- (MVP: personal accounts only; org-level RBAC is a future sprint)

DROP POLICY IF EXISTS "org_isolation" ON consent_configs;
CREATE POLICY "user_isolation" ON consent_configs
  FOR ALL USING (organization_id = auth.uid());

DROP POLICY IF EXISTS "org_isolation" ON consent_records;
CREATE POLICY "user_isolation" ON consent_records
  FOR ALL USING (organization_id = auth.uid());

DROP POLICY IF EXISTS "org_isolation" ON capi_providers;
CREATE POLICY "user_isolation" ON capi_providers
  FOR ALL USING (organization_id = auth.uid());

DROP POLICY IF EXISTS "org_isolation" ON capi_events;
CREATE POLICY "user_isolation" ON capi_events
  FOR ALL USING (organization_id = auth.uid());

DROP POLICY IF EXISTS "org_isolation" ON capi_event_queue;
CREATE POLICY "user_isolation" ON capi_event_queue
  FOR ALL USING (organization_id = auth.uid());

-- Allow the banner snippet (public, unauthed) to INSERT consent records.
-- The backend uses supabaseAdmin (service role) so this policy only
-- matters for direct Supabase client calls.
DROP POLICY IF EXISTS "public_insert_consent" ON consent_records;
CREATE POLICY "public_insert_consent" ON consent_records
  FOR INSERT WITH CHECK (true);


-- ============================================================
-- PART 4: HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_active_consent(p_project_id TEXT, p_visitor_id TEXT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'visitor_id', visitor_id,
    'decisions',  decisions,
    'gcm_state',  gcm_state,
    'expires_at', expires_at,
    'last_updated', created_at
  )
  FROM consent_records
  WHERE project_id = p_project_id
    AND visitor_id = p_visitor_id
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION purge_expired_consent()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM consent_records
  WHERE expires_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN COALESCE(deleted_count, 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_provider_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS NULL OR OLD.status != 'delivered') THEN
    UPDATE capi_providers
    SET events_sent_total = events_sent_total + 1, updated_at = now()
    WHERE id = NEW.provider_config_id;
  ELSIF NEW.status = 'dead_letter' AND (OLD.status IS NULL OR OLD.status != 'dead_letter') THEN
    UPDATE capi_providers
    SET events_failed_total = events_failed_total + 1, updated_at = now()
    WHERE id = NEW.provider_config_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_provider_counters ON capi_events;
CREATE TRIGGER trg_update_provider_counters
  AFTER INSERT OR UPDATE OF status ON capi_events
  FOR EACH ROW EXECUTE FUNCTION update_provider_counters();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_configs_updated ON consent_configs;
CREATE TRIGGER trg_consent_configs_updated
  BEFORE UPDATE ON consent_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_capi_providers_updated ON capi_providers;
CREATE TRIGGER trg_capi_providers_updated
  BEFORE UPDATE ON capi_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
