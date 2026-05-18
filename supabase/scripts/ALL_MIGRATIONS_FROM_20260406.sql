-- ============================================================
-- MIGRATION: 20260406_001_offline_conversion_tables.sql
-- ============================================================

-- ============================================================
-- Atlas: Offline Conversion Upload Module
-- Migration: 20260406_001_offline_conversion_tables.sql
--
-- Creates three tables for CSV-based offline conversion uploads
-- to Google Ads Enhanced Conversions:
--   1. offline_conversion_configs  — one-time setup per org
--   2. offline_conversion_uploads  — tracks each CSV batch
--   3. offline_conversion_rows     — individual conversion rows
--
-- RLS pattern: organization_id = auth.uid() (user isolation,
-- matching the convention from 20260317_001_consent_and_capi_tables.sql)
-- ============================================================


-- ============================================================
-- TABLE 1: offline_conversion_configs
-- Stores one-time Google Ads setup per organization.
-- Only one active config per organization at a time.
-- ============================================================

CREATE TABLE IF NOT EXISTS offline_conversion_configs (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Google Ads account identifiers
  google_customer_id        TEXT        NOT NULL,               -- e.g. "123-456-7890"
  conversion_action_id      TEXT        NOT NULL,               -- Google Ads resource name
  conversion_action_name    TEXT        NOT NULL DEFAULT '',

  -- Column mapping: CSV header → Atlas field name
  -- e.g. { "gclid": "Click ID", "email": "Email", "conversion_time": "Close Date", ... }
  column_mapping            JSONB       NOT NULL DEFAULT '{}',

  -- Defaults applied when CSV row omits these fields
  default_currency          TEXT        NOT NULL DEFAULT 'USD'
                                        CHECK (char_length(default_currency) = 3),
  default_conversion_value  DECIMAL(12,2) DEFAULT NULL,         -- NULL = require per-row value

  -- Lifecycle
  status                    TEXT        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'paused', 'error')),
  error_message             TEXT        DEFAULT NULL,

  -- Reuses capi_providers row for Google OAuth credentials
  -- (no separate credential storage — delegates to existing CAPI auth service)
  capi_provider_id          UUID        REFERENCES capi_providers(id) ON DELETE SET NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One config per org (can be updated in place, not replaced)
  UNIQUE(organization_id)
);


-- ============================================================
-- TABLE 2: offline_conversion_uploads
-- Tracks each CSV batch from file receipt through Google delivery.
-- ============================================================

CREATE TABLE IF NOT EXISTS offline_conversion_uploads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id             UUID        NOT NULL REFERENCES offline_conversion_configs(id) ON DELETE CASCADE,

  -- File metadata
  filename              TEXT        NOT NULL,
  file_size_bytes       INTEGER     NOT NULL DEFAULT 0,
  row_count_total       INTEGER     NOT NULL DEFAULT 0,

  -- Processing status lifecycle:
  -- pending → validating → validated → confirmed → uploading → completed | partial | failed | cancelled
  status                TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                      'pending', 'validating', 'validated',
                                      'confirmed', 'uploading',
                                      'completed', 'partial', 'failed', 'cancelled'
                                    )),

  -- Row counts populated after validation
  row_count_valid       INTEGER     NOT NULL DEFAULT 0,
  row_count_invalid     INTEGER     NOT NULL DEFAULT 0,
  row_count_duplicate   INTEGER     NOT NULL DEFAULT 0,

  -- Row counts populated after Google upload
  row_count_uploaded    INTEGER     NOT NULL DEFAULT 0,
  row_count_rejected    INTEGER     NOT NULL DEFAULT 0,

  -- Validation summary stored as JSONB for UI display
  -- { errors: [{row, field, message}], warnings: [{row, field, message}] }
  validation_summary    JSONB       DEFAULT NULL,

  -- Google API response summary
  -- { partial_failure_error, operation_results: [{index, status, error_code, error_message}] }
  upload_result         JSONB       DEFAULT NULL,

  error_message         TEXT        DEFAULT NULL,

  -- Audit: who triggered this upload
  uploaded_by           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Timestamps for each lifecycle stage
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at          TIMESTAMPTZ DEFAULT NULL,
  confirmed_at          TIMESTAMPTZ DEFAULT NULL,
  processing_started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at          TIMESTAMPTZ DEFAULT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocuploads_org_status
  ON offline_conversion_uploads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_ocuploads_org_created
  ON offline_conversion_uploads(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocuploads_config
  ON offline_conversion_uploads(config_id, created_at DESC);


-- ============================================================
-- TABLE 3: offline_conversion_rows
-- Stores individual conversion records from a CSV batch.
-- Raw PII is nulled out after upload via purge_raw_pii().
-- ============================================================

CREATE TABLE IF NOT EXISTS offline_conversion_rows (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id             UUID        NOT NULL REFERENCES offline_conversion_uploads(id) ON DELETE CASCADE,
  organization_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Position in the original CSV (1-based, excluding header row)
  row_index             INTEGER     NOT NULL,

  -- Raw identifiers (populated during validation, nulled by purge_raw_pii after upload)
  raw_email             TEXT        DEFAULT NULL,
  raw_phone             TEXT        DEFAULT NULL,
  raw_gclid             TEXT        DEFAULT NULL,

  -- Hashed identifiers (SHA-256 hex, retained permanently for audit + dedup)
  hashed_email          TEXT        DEFAULT NULL,
  hashed_phone          TEXT        DEFAULT NULL,

  -- Conversion details
  conversion_time       TIMESTAMPTZ DEFAULT NULL,
  conversion_value      DECIMAL(12,2) DEFAULT NULL,
  currency              TEXT        DEFAULT NULL CHECK (currency IS NULL OR char_length(currency) = 3),
  order_id              TEXT        DEFAULT NULL,    -- for Google-side deduplication

  -- Per-row status
  -- valid | invalid | duplicate | uploaded | rejected | skipped
  status                TEXT        NOT NULL DEFAULT 'valid'
                                    CHECK (status IN (
                                      'valid', 'invalid', 'duplicate',
                                      'uploaded', 'rejected', 'skipped'
                                    )),

  -- Validation error details (populated for invalid/duplicate rows)
  validation_errors     JSONB       DEFAULT NULL,   -- [{field, code, message}]
  validation_warnings   JSONB       DEFAULT NULL,   -- [{field, code, message}]

  -- Google API response for this row
  google_error_code     TEXT        DEFAULT NULL,
  google_error_message  TEXT        DEFAULT NULL,
  uploaded_at           TIMESTAMPTZ DEFAULT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocrows_upload_status
  ON offline_conversion_rows(upload_id, status);
CREATE INDEX IF NOT EXISTS idx_ocrows_upload_index
  ON offline_conversion_rows(upload_id, row_index);
CREATE INDEX IF NOT EXISTS idx_ocrows_org
  ON offline_conversion_rows(organization_id);
-- Index for cross-upload deduplication checks
CREATE INDEX IF NOT EXISTS idx_ocrows_hashed_email_org
  ON offline_conversion_rows(organization_id, hashed_email)
  WHERE hashed_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ocrows_order_id_org
  ON offline_conversion_rows(organization_id, order_id)
  WHERE order_id IS NOT NULL;


-- ============================================================
-- PART 2: ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE offline_conversion_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_conversion_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_conversion_rows    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_isolation" ON offline_conversion_configs
  FOR ALL USING (organization_id = auth.uid());

CREATE POLICY "user_isolation" ON offline_conversion_uploads
  FOR ALL USING (organization_id = auth.uid());

CREATE POLICY "user_isolation" ON offline_conversion_rows
  FOR ALL USING (organization_id = auth.uid());


-- ============================================================
-- PART 3: HELPER FUNCTIONS
-- ============================================================

-- Nulls out raw PII fields after upload completes.
-- Called by the backend after Google upload finishes (or on confirm).
-- Hashed values are retained for audit trail and cross-upload dedup.
CREATE OR REPLACE FUNCTION purge_raw_pii(p_upload_id UUID)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE offline_conversion_rows
  SET
    raw_email = NULL,
    raw_phone = NULL,
    raw_gclid = NULL
  WHERE upload_id = p_upload_id
    AND (raw_email IS NOT NULL OR raw_phone IS NOT NULL OR raw_gclid IS NOT NULL);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN COALESCE(updated_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- updated_at trigger (reuses the function defined in the initial migration)
DROP TRIGGER IF EXISTS trg_occonfigs_updated ON offline_conversion_configs;
CREATE TRIGGER trg_occonfigs_updated
  BEFORE UPDATE ON offline_conversion_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_ocuploads_updated ON offline_conversion_uploads;
CREATE TRIGGER trg_ocuploads_updated
  BEFORE UPDATE ON offline_conversion_uploads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- MIGRATION: 20260408_001_offline_conversions_meta_support.sql
-- ============================================================

-- ============================================================
-- Atlas: Offline Conversions — Multi-Provider Support
-- Migration: 20260408_001_offline_conversions_meta_support.sql
--
-- Extends offline_conversion_configs to support Meta CAPI offline
-- uploads alongside the existing Google Ads integration.
--
-- Changes:
--   1. offline_conversion_configs
--      - Add provider_type column ('google' | 'meta') for worker routing
--      - Make google-specific columns nullable (not required for Meta)
--      - Add meta_event_name column
--
--   2. offline_conversion_rows
--      - Add raw_fbclid column (Meta equivalent of raw_gclid)
--
--   3. purge_raw_pii() — updated to also null raw_fbclid
-- ============================================================


-- ============================================================
-- 1. offline_conversion_configs — multi-provider support
-- ============================================================

-- Provider type: drives worker routing without an extra join
ALTER TABLE offline_conversion_configs
  ADD COLUMN IF NOT EXISTS provider_type TEXT NOT NULL DEFAULT 'google'
    CHECK (provider_type IN ('google', 'meta'));

-- Make Google-specific columns nullable (Meta configs don't need them)
ALTER TABLE offline_conversion_configs
  ALTER COLUMN google_customer_id   DROP NOT NULL,
  ALTER COLUMN conversion_action_id DROP NOT NULL,
  ALTER COLUMN conversion_action_name DROP NOT NULL;

ALTER TABLE offline_conversion_configs
  ALTER COLUMN conversion_action_name SET DEFAULT NULL;

-- Meta event name (e.g. 'Purchase', 'Lead', 'CompleteRegistration')
ALTER TABLE offline_conversion_configs
  ADD COLUMN IF NOT EXISTS meta_event_name TEXT DEFAULT NULL;

-- Enforce: Google configs must have google_customer_id and conversion_action_id
-- Meta configs must have meta_event_name
ALTER TABLE offline_conversion_configs
  ADD CONSTRAINT chk_google_fields CHECK (
    provider_type <> 'google'
    OR (google_customer_id IS NOT NULL AND conversion_action_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_meta_fields CHECK (
    provider_type <> 'meta'
    OR meta_event_name IS NOT NULL
  );


-- ============================================================
-- 2. offline_conversion_rows — add fbclid support
-- ============================================================

-- Facebook Click ID: Meta's equivalent of Google's GCLID for attribution
ALTER TABLE offline_conversion_rows
  ADD COLUMN IF NOT EXISTS raw_fbclid TEXT DEFAULT NULL;

-- Add to the dedup index alongside raw_gclid
-- (fbclid-based within-upload dedup is handled in csvValidator like gclid)


-- ============================================================
-- 3. Update purge_raw_pii() to also clear raw_fbclid
-- ============================================================

CREATE OR REPLACE FUNCTION purge_raw_pii(p_upload_id UUID)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE offline_conversion_rows
  SET
    raw_email  = NULL,
    raw_phone  = NULL,
    raw_gclid  = NULL,
    raw_fbclid = NULL
  WHERE upload_id = p_upload_id
    AND (
      raw_email  IS NOT NULL OR
      raw_phone  IS NOT NULL OR
      raw_gclid  IS NOT NULL OR
      raw_fbclid IS NOT NULL
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN COALESCE(updated_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- MIGRATION: 20260409_001_stripe_subscriptions.sql
-- ============================================================

-- Migration: 20260409_001_stripe_subscriptions
-- Add Stripe billing columns to the profiles table.
-- Plan is already stored on profiles; Stripe metadata lives alongside it.

-- Guarded: profiles is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    EXECUTE $q$
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS subscription_status      TEXT NOT NULL DEFAULT 'inactive',
        ADD COLUMN IF NOT EXISTS current_period_end       TIMESTAMPTZ
    $q$;

    EXECUTE 'CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx ON profiles (stripe_customer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx ON profiles (stripe_subscription_id)';

    EXECUTE 'ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check';
    EXECUTE $q$
      ALTER TABLE profiles
        ADD CONSTRAINT profiles_subscription_status_check
        CHECK (subscription_status IN ('inactive', 'active', 'trialing', 'past_due', 'canceled'))
    $q$;
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260410_001_event_taxonomy.sql
-- ============================================================

-- ============================================================
-- Atlas: Event Taxonomy & Naming Governance
-- Migration: 20260410_001_event_taxonomy.sql
--
-- Creates:
--   1. event_taxonomy      — hierarchical event registry (system + org-custom)
--   2. naming_conventions  — org-level naming rules (one row per org)
--
-- Modifies:
--   3. signals             — adds taxonomy_event_id + taxonomy_path columns
--
-- RLS pattern: organization_id = auth.uid() (matching existing migrations)
-- System rows have organization_id IS NULL and are readable by all.
-- ============================================================


-- ============================================================
-- TABLE 1: event_taxonomy
-- Hierarchical tree of event categories and specific events.
-- Supports arbitrary nesting via parent_id self-reference.
-- Materialised `path` column enables fast subtree queries.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_taxonomy (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL organization_id = system taxonomy (Atlas-maintained, read-only for users)
  organization_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Tree structure
  parent_id         UUID        REFERENCES event_taxonomy(id) ON DELETE CASCADE,
  path              TEXT        NOT NULL,           -- Materialised: 'ecommerce/cart/add_to_cart'
  depth             INTEGER     NOT NULL DEFAULT 0, -- 0 = root category, 1 = subcategory, 2 = event

  -- Identity
  slug              TEXT        NOT NULL,           -- URL-safe id: 'add_to_cart'
  name              TEXT        NOT NULL,           -- Display name: 'Add to Cart'
  description       TEXT,
  node_type         TEXT        NOT NULL CHECK (node_type IN ('category', 'event')),
  -- 'category' = grouping node (ecommerce, lead_generation)
  -- 'event'    = leaf node mapping to an actual trackable action

  -- Event-specific fields (only populated when node_type = 'event')
  -- Parameter schema for this event
  -- {
  --   "required": [{ "key": "transaction_id", "label": "Order ID", "type": "string",
  --                  "description": "Unique order identifier", "format": null }],
  --   "optional": [{ "key": "items", "label": "Products", "type": "array",
  --                  "description": "Purchased items", "format": "ga4_items",
  --                  "item_schema": [{ "key": "item_id", "type": "string" }] }]
  -- }
  parameter_schema  JSONB       DEFAULT NULL,

  -- Platform mappings (only for event nodes)
  -- {
  --   "ga4":        { "event_name": "purchase", "param_mapping": {...}, "required_params": [...] },
  --   "meta":       { "event_name": "Purchase", "param_mapping": {...}, "additional_params": {...} },
  --   "google_ads": { "event_name": "conversion", "param_mapping": {...}, "requires_conversion_label": true },
  --   "tiktok":     { "event_name": "CompletePayment", "param_mapping": {...} },
  --   "linkedin":   { "event_name": "conversion", "param_mapping": {...} },
  --   "snapchat":   { "event_name": "PURCHASE", "param_mapping": {...} }
  -- }
  platform_mappings JSONB       DEFAULT NULL,

  -- Funnel metadata
  funnel_stage      TEXT        CHECK (funnel_stage IN (
                                  'awareness', 'consideration', 'conversion', 'retention', 'advocacy'
                                )),

  -- Display
  icon              TEXT,                           -- Lucide icon name for UI display
  display_order     INTEGER     NOT NULL DEFAULT 0, -- Sort order within parent

  -- Governance
  is_system         BOOLEAN     NOT NULL DEFAULT false, -- true = Atlas-maintained, users cannot delete/modify
  is_custom         BOOLEAN     NOT NULL DEFAULT false, -- true = user-created extension
  deprecated        BOOLEAN     NOT NULL DEFAULT false, -- Soft-delete: hidden from new selections

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique path per org (NULL org = system events, unique globally)
  UNIQUE NULLS NOT DISTINCT (organization_id, path),

  -- Event nodes must have a parameter schema
  CONSTRAINT valid_event_has_schema CHECK (
    node_type != 'event' OR parameter_schema IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_org    ON event_taxonomy(organization_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_parent ON event_taxonomy(parent_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_path   ON event_taxonomy(path);
CREATE INDEX IF NOT EXISTS idx_taxonomy_type   ON event_taxonomy(node_type);
CREATE INDEX IF NOT EXISTS idx_taxonomy_stage  ON event_taxonomy(funnel_stage)
  WHERE funnel_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taxonomy_system ON event_taxonomy(is_system)
  WHERE is_system = true;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_taxonomy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_taxonomy_updated ON event_taxonomy;
CREATE TRIGGER trg_taxonomy_updated
  BEFORE UPDATE ON event_taxonomy
  FOR EACH ROW EXECUTE FUNCTION update_taxonomy_timestamp();


-- ============================================================
-- TABLE 2: naming_conventions
-- Org-level naming rules. One row per organisation.
-- If no row exists for an org, the application uses DEFAULT_CONVENTION.
-- ============================================================

CREATE TABLE IF NOT EXISTS naming_conventions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Case format
  event_case              TEXT        NOT NULL DEFAULT 'snake_case'
                                        CHECK (event_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),
  param_case              TEXT        NOT NULL DEFAULT 'snake_case'
                                        CHECK (param_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),

  -- Prefix rules (null = no prefix)
  event_prefix            TEXT        DEFAULT NULL, -- e.g., 'atlas_' or 'acme_'
  param_prefix            TEXT        DEFAULT NULL, -- e.g., 'dl_'

  -- Separator (used within snake_case / kebab-case words)
  word_separator          TEXT        NOT NULL DEFAULT '_',

  -- Validation rules
  max_event_name_length   INTEGER     NOT NULL DEFAULT 40,
  max_param_key_length    INTEGER     NOT NULL DEFAULT 40,
  allowed_characters      TEXT        NOT NULL DEFAULT 'a-z0-9_', -- Regex character class (without brackets)

  -- Reserved words — event names that should never be used (overrides GA4 auto-collected events)
  reserved_words          JSONB       NOT NULL DEFAULT '["event","page_view","session_start","first_visit","user_engagement"]'::jsonb,

  -- Auto-generated display examples (updated by application on save)
  example_event           TEXT,       -- e.g., 'acme_add_to_cart'
  example_param           TEXT,       -- e.g., 'dl_transaction_id'

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_naming_convention_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_naming_convention_updated ON naming_conventions;
CREATE TRIGGER trg_naming_convention_updated
  BEFORE UPDATE ON naming_conventions
  FOR EACH ROW EXECUTE FUNCTION update_naming_convention_timestamp();


-- ============================================================
-- MODIFY TABLE 3: signals
-- Add taxonomy reference columns (nullable — fully backwards-compatible).
-- Existing signals without taxonomy links continue to work unchanged.
-- ============================================================

-- Guarded: signals is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signals') THEN
    EXECUTE $q$
      ALTER TABLE signals
        ADD COLUMN IF NOT EXISTS taxonomy_event_id UUID REFERENCES event_taxonomy(id) ON DELETE SET NULL
    $q$;
    EXECUTE 'ALTER TABLE signals ADD COLUMN IF NOT EXISTS taxonomy_path TEXT';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signals_taxonomy ON signals(taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signals_taxonomy_path ON signals(taxonomy_path) WHERE taxonomy_path IS NOT NULL';
  END IF;
END $$;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE event_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE naming_conventions ENABLE ROW LEVEL SECURITY;

-- Taxonomy READ: system events (org IS NULL) visible to all authenticated users;
--               org-specific events visible only to the owning org.
CREATE POLICY "taxonomy_select" ON event_taxonomy
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = auth.uid()
  );

-- Taxonomy WRITE: users can only insert/update/delete rows belonging to their own org.
--                System rows (organization_id IS NULL) are protected by this policy —
--                they cannot be written by any user (only via service role migrations).
CREATE POLICY "taxonomy_insert" ON event_taxonomy
  FOR INSERT WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
  );

CREATE POLICY "taxonomy_update" ON event_taxonomy
  FOR UPDATE USING (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
    AND is_system = false
  );

CREATE POLICY "taxonomy_delete" ON event_taxonomy
  FOR DELETE USING (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
    AND is_system = false
  );

-- Naming conventions: strict org isolation
CREATE POLICY "naming_conv_select" ON naming_conventions
  FOR SELECT USING (organization_id = auth.uid());

CREATE POLICY "naming_conv_insert" ON naming_conventions
  FOR INSERT WITH CHECK (organization_id = auth.uid());

CREATE POLICY "naming_conv_update" ON naming_conventions
  FOR UPDATE USING (organization_id = auth.uid());

CREATE POLICY "naming_conv_delete" ON naming_conventions
  FOR DELETE USING (organization_id = auth.uid());


-- ============================================================
-- MIGRATION: 20260411_001_planning_rec_taxonomy.sql
-- ============================================================

-- Migration: Add taxonomy linking columns to planning_recommendations
-- Links AI-generated recommendations back to the org's event taxonomy.
-- taxonomy_event_id: FK to event_taxonomy.id (nullable — unmatched events stay null)
-- taxonomy_path: denormalised path string e.g. 'ecommerce/cart/add_to_cart' for display

-- Guarded: planning_recommendations is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_recommendations') THEN
    EXECUTE $q$
      ALTER TABLE planning_recommendations
        ADD COLUMN IF NOT EXISTS taxonomy_event_id UUID REFERENCES event_taxonomy(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS taxonomy_path TEXT
    $q$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_planning_rec_taxonomy_event_id ON planning_recommendations(taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL';
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260420_001_strategy_briefs.sql
-- ============================================================

-- Strategy Briefs — stores persisted conversion strategy evaluations.
-- organization_id = auth.uid() (matches the pattern used by consent/capi tables).
-- client_id and project_id are plain UUIDs (no FK — tables may not exist yet).

CREATE TABLE IF NOT EXISTS strategy_briefs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id            UUID,
  project_id           UUID,
  business_outcome     TEXT,
  outcome_timing_days  INTEGER,
  current_event        TEXT,
  verdict              TEXT        CHECK (verdict IN ('keep', 'add_proxy', 'switch')),
  proxy_event          TEXT,
  rationale            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_briefs_org ON strategy_briefs;
CREATE POLICY strategy_briefs_org ON strategy_briefs
  USING (organization_id = auth.uid());


-- ============================================================
-- MIGRATION: 20260421_001_strategy_objectives.sql
-- ============================================================

-- Multi-Objective Strategy Foundation
-- Extends strategy_briefs, adds strategy_objectives + strategy_objective_campaigns,
-- and migrates Sprint 1 single-event briefs into the new model.
-- All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS).

-- ── 1. Relax legacy NOT NULL constraints on strategy_briefs ──────────────────

ALTER TABLE strategy_briefs
  ALTER COLUMN verdict DROP NOT NULL,
  ALTER COLUMN business_outcome DROP NOT NULL,
  ALTER COLUMN outcome_timing_days DROP NOT NULL;

-- ── 2. New columns on strategy_briefs ────────────────────────────────────────

ALTER TABLE strategy_briefs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'
    CHECK (mode IN ('single', 'multi')),
  ADD COLUMN IF NOT EXISTS brief_name TEXT,
  ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES strategy_briefs(id);

-- ── 3. strategy_objectives ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_objectives (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id                  UUID        NOT NULL REFERENCES strategy_briefs(id) ON DELETE CASCADE,
  organization_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL,
  description               TEXT,
  platforms                 TEXT[]      NOT NULL DEFAULT '{}',
  current_event             TEXT,
  outcome_timing_days       INTEGER,
  verdict                   TEXT        CHECK (verdict IN ('CONFIRM', 'AUGMENT', 'REPLACE')),
  outcome_category          TEXT,
  recommended_primary_event TEXT,
  recommended_proxy_event   TEXT,
  proxy_event_required      BOOLEAN     NOT NULL DEFAULT FALSE,
  rationale                 TEXT,
  summary_markdown          TEXT,
  locked                    BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at                 TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_objectives_org ON strategy_objectives;
CREATE POLICY strategy_objectives_org ON strategy_objectives
  USING (organization_id = auth.uid());

-- ── 4. strategy_objective_campaigns ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_objective_campaigns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    UUID        NOT NULL REFERENCES strategy_objectives(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        TEXT        NOT NULL,
  campaign_name   TEXT,
  budget          NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_objective_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_objective_campaigns_org ON strategy_objective_campaigns;
CREATE POLICY strategy_objective_campaigns_org ON strategy_objective_campaigns
  USING (organization_id = auth.uid());

-- ── 5. Migrate Sprint 1 single-event briefs ───────────────────────────────────
-- Mark them locked, then copy each into strategy_objectives.
-- INSERT is guarded by brief_id FK — safe to re-run (existing rows won't duplicate
-- because locked_at is already set and the WHERE filters on IS NOT NULL fields).

UPDATE strategy_briefs
  SET locked_at = created_at
  WHERE business_outcome IS NOT NULL
    AND outcome_timing_days IS NOT NULL
    AND locked_at IS NULL;

INSERT INTO strategy_objectives (
  brief_id,
  organization_id,
  name,
  platforms,
  current_event,
  outcome_timing_days,
  verdict,
  recommended_primary_event,
  recommended_proxy_event,
  rationale,
  locked,
  locked_at,
  created_at,
  updated_at
)
SELECT
  id                    AS brief_id,
  organization_id,
  business_outcome      AS name,
  '{}'                  AS platforms,
  current_event,
  outcome_timing_days,
  CASE verdict
    WHEN 'keep'      THEN 'CONFIRM'
    WHEN 'add_proxy' THEN 'AUGMENT'
    WHEN 'switch'    THEN 'REPLACE'
  END                   AS verdict,
  current_event         AS recommended_primary_event,
  proxy_event           AS recommended_proxy_event,
  rationale,
  TRUE                  AS locked,
  created_at            AS locked_at,
  created_at,
  created_at            AS updated_at
FROM strategy_briefs
WHERE business_outcome IS NOT NULL
  AND outcome_timing_days IS NOT NULL
  AND id NOT IN (SELECT brief_id FROM strategy_objectives);


-- ============================================================
-- MIGRATION: 20260425_001_strategy_briefs_storage.sql
-- ============================================================

-- Create the strategy-briefs storage bucket for PDF exports.
-- PDFs are stored at {organization_id}/{brief_id}/v{version_no}.pdf
-- Access is via signed URLs generated server-side — the bucket is never public.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'strategy-briefs',
  'strategy-briefs',
  false,
  10485760,            -- 10 MB per PDF
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- MIGRATION: 20260427_001_remove_walkeros.sql
-- ============================================================

-- Sprint 2.1: Remove WalkerOS from database constraints
-- All operations are guarded: safe to run on databases where these
-- tables may not exist yet.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journeys') THEN
    UPDATE public.journeys
      SET implementation_format = 'gtm'
      WHERE implementation_format IN ('walkeros', 'both');

    EXECUTE 'ALTER TABLE public.journeys DROP CONSTRAINT IF EXISTS journeys_implementation_format_check';
    EXECUTE 'ALTER TABLE public.journeys ADD CONSTRAINT journeys_implementation_format_check CHECK (implementation_format IN (''gtm''))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_outputs') THEN
    UPDATE public.planning_outputs
      SET output_type = 'implementation_guide'
      WHERE output_type = 'walkeros_flow';

    EXECUTE 'ALTER TABLE public.planning_outputs DROP CONSTRAINT IF EXISTS planning_outputs_output_type_check';
    EXECUTE $q$ALTER TABLE public.planning_outputs ADD CONSTRAINT planning_outputs_output_type_check CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'))$q$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_outputs') THEN
    UPDATE public.client_outputs
      SET output_type = 'datalayer_spec'
      WHERE output_type = 'walkeros_flow';

    EXECUTE 'ALTER TABLE public.client_outputs DROP CONSTRAINT IF EXISTS client_outputs_output_type_check';
    EXECUTE $q$ALTER TABLE public.client_outputs ADD CONSTRAINT client_outputs_output_type_check CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'))$q$;
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260428_001_tracking_plan_versions.sql
-- ============================================================

-- Sprint 2.5: tracking_plan_versions — version history for planning outputs
-- Guarded: skipped entirely if planning_sessions doesn't exist yet.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_sessions') THEN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tracking_plan_versions') THEN
      EXECUTE $q$
        CREATE TABLE tracking_plan_versions (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id      UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
          version         INTEGER NOT NULL,
          label           TEXT,
          gtm_output_id   UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          spec_output_id  UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          guide_output_id UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (session_id, version)
        )
      $q$;

      EXECUTE 'CREATE INDEX tracking_plan_versions_session_id_idx ON tracking_plan_versions (session_id, version DESC)';
      EXECUTE 'ALTER TABLE tracking_plan_versions ENABLE ROW LEVEL SECURITY';
      EXECUTE $q$
        CREATE POLICY "Users access own session versions"
          ON tracking_plan_versions FOR ALL
          USING (session_id IN (SELECT id FROM planning_sessions WHERE user_id = auth.uid()))
      $q$;
    END IF;
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260511_001_capi_provider_credentials_v2.sql
-- ============================================================

-- Sprint 3: CAPI provider credentials v2
-- Adds Data Processing Options (DPO) columns for Meta CCPA/LDU compliance.
-- These are top-level columns (not inside the encrypted credentials blob) so
-- they can be read by the pipeline without decrypting credentials.
--
-- DPO reference:
--   https://developers.facebook.com/docs/marketing-api/data-processing-options

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS data_processing_options       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS data_processing_options_country INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_processing_options_state   INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN capi_providers.data_processing_options
  IS 'Meta Data Processing Options array, e.g. [''LDU''] for Limited Data Use (CCPA). Empty array = no restriction.';

COMMENT ON COLUMN capi_providers.data_processing_options_country
  IS 'Meta DPO country code. 0 = use geolocation. 1 = US.';

COMMENT ON COLUMN capi_providers.data_processing_options_state
  IS 'Meta DPO state code. 0 = use geolocation. 1000 = California.';


-- ============================================================
-- MIGRATION: 20260518_001_google_oauth_fields.sql
-- ============================================================

-- Sprint 4: Google OAuth lifecycle + adapter name
--
-- access_token_expires_at: top-level column (not in encrypted credentials blob)
--   so the OAuth refresh job can check token expiry without decrypting.
--   Populated by the google-oauth-refresh Bull job after each successful refresh.
--
-- adapter_name: records which of the three Google sub-adapters the user configured.
--   Values: 'google_ec_web' | 'google_ec_leads' | 'google_offline'
--   NULL for Meta, TikTok, LinkedIn providers.

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adapter_name             TEXT;

COMMENT ON COLUMN capi_providers.access_token_expires_at
  IS 'Google only — when the stored OAuth access token expires. Used by the refresh job to schedule proactive renewal.';

COMMENT ON COLUMN capi_providers.adapter_name
  IS 'Google sub-adapter: google_ec_web (real-time EC), google_ec_leads (lead matching), google_offline (CSV batch). NULL for non-Google providers.';


-- ============================================================
-- MIGRATION: 20260519_001_capi_dedup.sql
-- ============================================================

-- Sprint 2.0a: Deduplication Engine — database foundation
-- Adds dedup tracking to capi_events, creates capi_browser_events table,
-- and adds provider_token to capi_providers for beacon authentication.

-- ── capi_events: dedup tracking columns ──────────────────────────────────────

ALTER TABLE capi_events
  ADD COLUMN IF NOT EXISTS event_id         TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key        TEXT,
  ADD COLUMN IF NOT EXISTS dedup_status     TEXT CHECK (dedup_status IN ('hit', 'miss', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS dedup_matched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_capi_events_dedup_status
  ON capi_events (organization_id, provider_config_id, dedup_status, processed_at);

-- ── capi_browser_events: Atlas Signal Tag beacon store ────────────────────────
-- Receives browser-side event_id beacons from GTM before server-side CAPI fires.
-- Redis is the hot lookup path; this table provides a durable audit trail.

CREATE TABLE IF NOT EXISTS capi_browser_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id      UUID        REFERENCES capi_providers(id) ON DELETE SET NULL,
  event_id         TEXT        NOT NULL,
  event_name       TEXT        NOT NULL,
  fbclid           TEXT,
  gclid            TEXT,
  session_id       TEXT,
  event_data       JSONB,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

ALTER TABLE capi_browser_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON capi_browser_events
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_capi_browser_events_lookup
  ON capi_browser_events (organization_id, event_name, fbclid, received_at DESC);

-- ── capi_providers: provider_token for beacon authentication ─────────────────
-- Included in the generated GTM container as a constant variable.
-- The browser-event beacon authenticates via X-Atlas-Provider-Token header
-- without requiring a Supabase session.

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS provider_token UUID DEFAULT gen_random_uuid();

-- Back-fill any existing rows that got a NULL (DEFAULT only applies to new rows
-- when the column already existed with IF NOT EXISTS on a populated table).
UPDATE capi_providers
  SET provider_token = gen_random_uuid()
  WHERE provider_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_providers_token
  ON capi_providers (provider_token);


-- ============================================================
-- MIGRATION: 20260520_001_usage_events.sql
-- ============================================================

-- Usage events: log every Browserbase page scan and Claude API call per org.
-- Internal data only — no customer-facing access. Service role only via RLS.

CREATE TABLE usage_events (
  id               uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           uuid          NOT NULL,
  event_type       text          NOT NULL CHECK (event_type IN (
                     'page_scan',
                     'ai_report_scheduled',
                     'ai_report_ondemand',
                     'ai_query_ondemand'
                   )),

  -- Browserbase fields (page_scan only)
  browser_minutes  numeric(8,4)  NULL,
  pages_scanned    integer       NULL,
  domain           text          NULL,

  -- Claude fields (ai_* only)
  input_tokens     integer       NULL,
  output_tokens    integer       NULL,
  model            text          NULL,

  -- Cost computed at write time; update computeCost() when invoices arrive
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,

  -- Traceability
  job_id           text          NULL,
  scan_run_id      uuid          NULL, -- groups all page_scan rows from one crawl job
  metadata         jsonb         NULL,

  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_org_id     ON usage_events (org_id);
CREATE INDEX idx_usage_events_created_at ON usage_events (created_at DESC);
CREATE INDEX idx_usage_events_scan_run   ON usage_events (scan_run_id) WHERE scan_run_id IS NOT NULL;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON usage_events
  USING (auth.role() = 'service_role');

-- ── Materialized view: pre-aggregated monthly summary per org ─────────────────
-- Refreshed nightly by the usageSummaryQueue Bull job via RPC below.

CREATE MATERIALIZED VIEW usage_monthly_summary AS
SELECT
  org_id,
  date_trunc('month', created_at)                                  AS month,
  COUNT(*) FILTER (WHERE event_type = 'page_scan')                 AS total_page_scans,
  SUM(browser_minutes) FILTER (WHERE event_type = 'page_scan')     AS total_browser_minutes,
  COUNT(*) FILTER (WHERE event_type LIKE 'ai_%')                   AS total_ai_calls,
  SUM(input_tokens)  FILTER (WHERE event_type LIKE 'ai_%')         AS total_input_tokens,
  SUM(output_tokens) FILTER (WHERE event_type LIKE 'ai_%')         AS total_output_tokens,
  SUM(cost_usd)                                                     AS total_variable_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type = 'page_scan')            AS scan_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%')              AS ai_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_report_%')       AS report_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%ondemand')      AS ondemand_cost_usd
FROM usage_events
GROUP BY org_id, date_trunc('month', created_at);

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX ON usage_monthly_summary (org_id, month);

-- ── RPC: allows the Bull worker to refresh the view without direct DB access ──

CREATE OR REPLACE FUNCTION refresh_usage_monthly_summary()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY usage_monthly_summary;
END;
$$;


-- ============================================================
-- MIGRATION: 20260521_001_org_subscriptions.sql
-- ============================================================

-- Sprint 2.2 — org_subscriptions, cap_violations, and supporting view
-- Manually-managed commercial subscription record per org (no Stripe integration in this phase).
-- Both tables are service-role only: no customer-facing access.

-- ── 1. update_updated_at helper ───────────────────────────────────────────────
-- Safe to re-run — already defined in 20260317_001_consent_and_capi_tables.sql.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. org_subscriptions ──────────────────────────────────────────────────────

CREATE TABLE org_subscriptions (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Tier and pricing
  tier                    text          NOT NULL,   -- must match AtlasTier keys in config/pricing.ts
  currency                text          NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'AED', 'SGD')),
  contracted_price        numeric(10,2) NOT NULL,   -- actual agreed price in the currency above
  mrr_usd                 numeric(10,2) NOT NULL,   -- always USD for margin calculations
  billing_cadence         text          NOT NULL DEFAULT 'monthly'
                            CHECK (billing_cadence IN ('one_time', 'monthly', 'quarterly', 'annual')),

  -- Discounts
  cadence_discount_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  accelerator_partner     boolean       NOT NULL DEFAULT false,
  custom_discount_pct     numeric(5,2)  NOT NULL DEFAULT 0,
  custom_discount_reason  text          NULL,

  -- Add-ons: { "extra_domains": 2, "white_label": true, "signal_operator": true }
  addons                  jsonb         NOT NULL DEFAULT '{}',

  -- Subscription window
  started_at              timestamptz   NOT NULL,
  ends_at                 timestamptz   NULL,       -- null = open-ended
  trial_ends_at           timestamptz   NULL,       -- null = not on trial

  -- Status
  status                  text          NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trial', 'active', 'paused', 'cancelled', 'expired')),
  cancellation_reason     text          NULL,

  -- Operator notes (not customer-visible)
  notes                   text          NULL,

  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_subscriptions_org_id  ON org_subscriptions (org_id);
CREATE INDEX idx_org_subscriptions_status  ON org_subscriptions (status);
CREATE INDEX idx_org_subscriptions_tier    ON org_subscriptions (tier);

ALTER TABLE org_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON org_subscriptions
  USING (auth.role() = 'service_role');

CREATE TRIGGER org_subscriptions_updated_at
  BEFORE UPDATE ON org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. org_active_subscriptions view ─────────────────────────────────────────
-- Always returns the most recent active or trial subscription per org.
-- Used by the fair-use job and admin dashboard margin query.

CREATE OR REPLACE VIEW org_active_subscriptions AS
SELECT DISTINCT ON (org_id) *
FROM org_subscriptions
WHERE status IN ('trial', 'active')
ORDER BY org_id, started_at DESC;

-- ── 4. cap_violations ────────────────────────────────────────────────────────

CREATE TABLE cap_violations (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cap_type      text          NOT NULL CHECK (cap_type IN (
                  'page_scan', 'domain_count', 'client_count', 'query_count'
                )),
  domain        text          NULL,       -- populated for page_scan violations
  cap_value     numeric       NOT NULL,   -- the entitlement
  actual        numeric       NOT NULL,   -- what was consumed
  usage_pct     numeric       NOT NULL,   -- actual / cap_value
  severity      text          NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  resolved      boolean       NOT NULL DEFAULT false,
  resolved_at   timestamptz   NULL,
  resolution    text          NULL,       -- 'upgraded', 'warned', 'overage_charged', 'ignored'
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_cap_violations_org_id   ON cap_violations (org_id);
CREATE INDEX idx_cap_violations_resolved ON cap_violations (resolved) WHERE resolved = false;

ALTER TABLE cap_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON cap_violations
  USING (auth.role() = 'service_role');


-- ============================================================
-- MIGRATION: 20260522_001_browserbase_usage_snapshots.sql
-- ============================================================

-- Browserbase nightly reconciliation snapshots.
-- Stores the daily pull from the Browserbase Project Usage API and compares it
-- against Atlas-internal logged minutes to surface unattributed sessions.
--
-- Internal operator data only — no customer-facing access.
-- API response shape (sdk v2.x): { browserMinutes: number, proxyBytes: number }

CREATE TABLE browserbase_usage_snapshots (
  id                       uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Calendar date this snapshot covers (one row per day, upserted nightly)
  snapshot_date            date          NOT NULL UNIQUE,

  -- Values reported directly by the Browserbase Project Usage API
  total_browser_minutes    numeric(10,4) NOT NULL,
  total_proxy_data_gb      numeric(10,6) NOT NULL,  -- converted from proxyBytes / 1e9

  -- Plan allowance: $20/month plan includes 6,000 minutes.
  -- Update if the plan changes.
  included_minutes         integer       NOT NULL DEFAULT 6000,

  -- Computed: minutes and cost beyond the plan allowance.
  -- Both are $0 until total_browser_minutes > 6,000.
  overage_minutes          numeric(10,4) GENERATED ALWAYS AS
                             (GREATEST(total_browser_minutes - included_minutes, 0)) STORED,
  overage_cost_usd         numeric(10,4) GENERATED ALWAYS AS
                             (GREATEST(total_browser_minutes - included_minutes, 0) * 0.002) STORED,

  -- Atlas-internal total for the same calendar month (summed from usage_events).
  -- Populated by the reconciliation job; NULL means the job hasn't run yet.
  atlas_logged_minutes     numeric(10,4) NULL,

  -- Computed: gap between what Browserbase reports and what Atlas attributed.
  -- A large positive delta means sessions ran without proper org attribution.
  delta_minutes            numeric(10,4) GENERATED ALWAYS AS
                             (total_browser_minutes - COALESCE(atlas_logged_minutes, 0)) STORED,

  created_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_bb_snapshots_date ON browserbase_usage_snapshots (snapshot_date DESC);

ALTER TABLE browserbase_usage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON browserbase_usage_snapshots
  USING (auth.role() = 'service_role');


-- ============================================================
-- MIGRATION: 20260530_001_crawl_signal_extractor.sql
-- ============================================================

-- Sprint CSE-1 — Crawl Signal Extractor tables
-- All org_id columns reference auth.users(id) — consistent with org_subscriptions,
-- cap_violations, strategy_briefs, and all other recent migrations.
-- All four tables are service-role only (no customer-facing RLS read access).

-- ── 1. crawl_runs — one record per scan execution ─────────────────────────────

CREATE TABLE crawl_runs (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode                    text          NOT NULL CHECK (mode IN ('onboarding', 'scheduled')),
  status                  text          NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  triggered_by            text          NOT NULL CHECK (triggered_by IN ('system', 'manual', 'onboarding')),

  -- Page scope counters
  total_pages             integer       NOT NULL DEFAULT 0,
  pages_completed         integer       NOT NULL DEFAULT 0,
  pages_failed            integer       NOT NULL DEFAULT 0,

  -- Browserbase tracking
  browserbase_session_id  text          NULL,
  browser_minutes_used    numeric(8,4)  NULL,

  -- Timing
  started_at              timestamptz   NULL,
  completed_at            timestamptz   NULL,
  duration_seconds        integer       GENERATED ALWAYS AS (
                            EXTRACT(EPOCH FROM (completed_at - started_at))::integer
                          ) STORED,

  -- Error capture
  error_message           text          NULL,
  error_detail            jsonb         NULL,

  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_runs_org_id     ON crawl_runs (org_id);
CREATE INDEX idx_crawl_runs_status     ON crawl_runs (status);
CREATE INDEX idx_crawl_runs_created_at ON crawl_runs (created_at DESC);

ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON crawl_runs
  USING (auth.role() = 'service_role');

-- ── 2. crawl_pages — one record per page per crawl run ────────────────────────

CREATE TABLE crawl_pages (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url                 text          NOT NULL,
  url_type            text          NOT NULL CHECK (url_type IN (
                        'ad_destination',
                        'conversion_funnel',
                        'manual'
                      )),
  domain              text          NOT NULL,

  -- Scan result
  status              text          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scanning', 'completed', 'failed', 'skipped')),
  http_status         integer       NULL,
  scan_duration_ms    integer       NULL,

  -- Signal summary (denormalised for quick reads)
  signals_found       integer       NOT NULL DEFAULT 0,
  signals_healthy     integer       NOT NULL DEFAULT 0,
  signals_degraded    integer       NOT NULL DEFAULT 0,
  signals_missing     integer       NOT NULL DEFAULT 0,

  error_message       text          NULL,
  scanned_at          timestamptz   NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_pages_crawl_run_id ON crawl_pages (crawl_run_id);
CREATE INDEX idx_crawl_pages_org_id       ON crawl_pages (org_id);
CREATE INDEX idx_crawl_pages_domain       ON crawl_pages (domain);

ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON crawl_pages
  USING (auth.role() = 'service_role');

-- ── 3. detected_signals — one record per signal per page per run ──────────────

CREATE TABLE detected_signals (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_page_id       uuid          NOT NULL REFERENCES crawl_pages(id) ON DELETE CASCADE,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Signal identity
  signal_type         text          NOT NULL CHECK (signal_type IN (
                        'gtm_container',
                        'ga4_base',
                        'ga4_event',
                        'meta_pixel',
                        'meta_capi',
                        'google_ads_conversion',
                        'google_ads_remarketing',
                        'tiktok_pixel',
                        'linkedin_insight',
                        'snapchat_pixel',
                        'custom_event'
                      )),
  signal_name         text          NULL,
  signal_id           text          NULL,

  -- Health assessment
  health_status       text          NOT NULL CHECK (health_status IN (
                        'healthy',
                        'degraded',
                        'missing',
                        'duplicate',
                        'misconfigured'
                      )),
  health_score        integer       NOT NULL CHECK (health_score BETWEEN 0 AND 100),

  -- Detection detail
  detected_at         text          NULL CHECK (detected_at IN (
                        'page_load', 'dom_ready', 'interaction', 'network'
                      )),
  firing_triggers     jsonb         NULL,
  parameters          jsonb         NULL,
  issues              jsonb         NULL,

  -- Baseline tracking for scheduled mode delta detection
  first_seen_run_id   uuid          NULL REFERENCES crawl_runs(id),
  is_regression       boolean       NOT NULL DEFAULT false,

  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_detected_signals_crawl_run_id  ON detected_signals (crawl_run_id);
CREATE INDEX idx_detected_signals_org_id        ON detected_signals (org_id);
CREATE INDEX idx_detected_signals_signal_type   ON detected_signals (signal_type);
CREATE INDEX idx_detected_signals_health_status ON detected_signals (health_status);

ALTER TABLE detected_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON detected_signals
  USING (auth.role() = 'service_role');

-- ── 4. org_page_scope — the customer's configured page list ───────────────────

CREATE TABLE org_page_scope (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             text          NOT NULL,
  url_type        text          NOT NULL CHECK (url_type IN (
                    'ad_destination', 'conversion_funnel', 'manual'
                  )),
  domain          text          NOT NULL,
  source          text          NULL,       -- 'google_ads', 'meta_ads', 'auto_detected', 'manual'
  is_active       boolean       NOT NULL DEFAULT true,
  priority        integer       NOT NULL DEFAULT 0,
  added_at        timestamptz   NOT NULL DEFAULT now(),
  last_crawled_at timestamptz   NULL,

  UNIQUE (org_id, url)
);

CREATE INDEX idx_org_page_scope_org_id    ON org_page_scope (org_id);
CREATE INDEX idx_org_page_scope_is_active ON org_page_scope (is_active) WHERE is_active = true;

ALTER TABLE org_page_scope ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON org_page_scope
  USING (auth.role() = 'service_role');


-- ============================================================
-- MIGRATION: 20260601_001_proxy_event_library.sql
-- ============================================================

-- Sprint Signal-Timing-1 — Proxy Event Library table
-- System-owned reference data (is_system = true).
-- All authenticated users can read rows; only service role can insert/update/delete.
-- Extensible via additional seed runs or a future admin UI.

CREATE TABLE proxy_event_library (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  lag_class        text        NOT NULL CHECK (lag_class IN ('immediate', 'short_lag', 'long_lag', 'deep_lag')),
  platform_benefit text        NOT NULL CHECK (platform_benefit IN ('meta', 'google', 'both')),
  rationale        text        NOT NULL,
  event_type       text        NOT NULL,
  verticals        text[]      NOT NULL DEFAULT '{}',
  is_system        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Index for the primary query pattern: lag_class filter + optional vertical overlap
CREATE INDEX idx_proxy_event_library_lag_class ON proxy_event_library (lag_class);
CREATE INDEX idx_proxy_event_library_verticals ON proxy_event_library USING GIN (verticals);

-- RLS: read-only for all authenticated users; writes restricted to service role
ALTER TABLE proxy_event_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proxy_event_library_read"
  ON proxy_event_library
  FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- MIGRATION: 20260602_001_journey_stage_timing_metadata.sql
-- ============================================================

-- Sprint 4: persist signal timing metadata alongside journey stages.
-- Each key is an action key (e.g. "purchase") or "__proxy__" for the
-- stage-level proxy marker. Values are ConversionEventTiming objects.
-- Guarded: safe to run on databases where journey_stages may not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journey_stages') THEN
    EXECUTE 'ALTER TABLE public.journey_stages ADD COLUMN IF NOT EXISTS conversion_event_metadata JSONB NOT NULL DEFAULT ''{}''';
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260603_001_journey_client_link.sql
-- ============================================================

-- Link journeys to clients (optional, for agency workflow where the wizard is
-- launched from a specific client's page). Null means the journey is standalone.
-- Guarded: safe to run on databases where journeys or clients may not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journeys')
  AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    EXECUTE 'ALTER TABLE public.journeys ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL';
    IF NOT EXISTS (
      SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'journeys' AND indexname = 'idx_journeys_client_id'
    ) THEN
      EXECUTE 'CREATE INDEX idx_journeys_client_id ON public.journeys (client_id) WHERE client_id IS NOT NULL';
    END IF;
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260604_001_journey_stage_b2b_fields.sql
-- ============================================================

-- B2B Journey Stage fields: proxy monetary value + buyer intent level
-- Used by the B2B Lead Gen template and value-based bidding setup
-- Guarded: safe to run on databases where journey_stages may not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journey_stages') THEN
    EXECUTE 'ALTER TABLE public.journey_stages ADD COLUMN IF NOT EXISTS proxy_value_gbp numeric CHECK (proxy_value_gbp >= 0)';
    EXECUTE 'ALTER TABLE public.journey_stages ADD COLUMN IF NOT EXISTS buyer_intent_level text CHECK (buyer_intent_level IN (''problem_aware'', ''solution_aware'', ''vendor_aware''))';
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260604002_journey_tables_with_b2b_fields.sql
-- ============================================================

-- Journey tables (journeys, journey_stages, journey_platforms, generated_specs)
-- journey_stages includes proxy_value_gbp and buyer_intent_level from the B2B sprint.

CREATE TABLE IF NOT EXISTS journeys (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL DEFAULT 'Untitled Journey',
  business_type             TEXT        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  implementation_format     TEXT        NOT NULL DEFAULT 'gtm',
  source_planning_session_id UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journeys_owner ON journeys;
CREATE POLICY journeys_owner ON journeys USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS journey_stages (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id                UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_order               INTEGER     NOT NULL,
  label                     TEXT        NOT NULL,
  page_type                 TEXT        NOT NULL,
  sample_url                TEXT,
  actions                   TEXT[]      NOT NULL DEFAULT '{}',
  conversion_event_metadata JSONB       NOT NULL DEFAULT '{}',
  proxy_value_gbp           NUMERIC     CHECK (proxy_value_gbp >= 0),
  buyer_intent_level        TEXT        CHECK (buyer_intent_level IN ('problem_aware','solution_aware','vendor_aware')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, stage_order)
);

ALTER TABLE journey_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journey_stages_owner ON journey_stages;
CREATE POLICY journey_stages_owner ON journey_stages
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS journey_platforms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id     UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  platform       TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  measurement_id TEXT,
  config         JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, platform)
);

ALTER TABLE journey_platforms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journey_platforms_owner ON journey_platforms;
CREATE POLICY journey_platforms_owner ON journey_platforms
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS generated_specs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  format       TEXT        NOT NULL,
  spec_data    JSONB       NOT NULL DEFAULT '{}',
  version      INTEGER     NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE generated_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generated_specs_owner ON generated_specs;
CREATE POLICY generated_specs_owner ON generated_specs
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));


-- ============================================================
-- MIGRATION: 20260604003_upsert_journey_stage_fn.sql
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_journey_stage(
  p_journey_id                UUID,
  p_stage_order               INTEGER,
  p_label                     TEXT,
  p_page_type                 TEXT,
  p_sample_url                TEXT,
  p_actions                   TEXT[],
  p_conversion_event_metadata JSONB,
  p_proxy_value_gbp           NUMERIC,
  p_buyer_intent_level        TEXT
) RETURNS SETOF journey_stages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO journey_stages (
    journey_id, stage_order, label, page_type, sample_url,
    actions, conversion_event_metadata, proxy_value_gbp,
    buyer_intent_level, updated_at
  ) VALUES (
    p_journey_id, p_stage_order, p_label, p_page_type, p_sample_url,
    p_actions, p_conversion_event_metadata, p_proxy_value_gbp,
    p_buyer_intent_level, NOW()
  )
  ON CONFLICT (journey_id, stage_order) DO UPDATE SET
    label                     = EXCLUDED.label,
    page_type                 = EXCLUDED.page_type,
    sample_url                = EXCLUDED.sample_url,
    actions                   = EXCLUDED.actions,
    conversion_event_metadata = EXCLUDED.conversion_event_metadata,
    proxy_value_gbp           = EXCLUDED.proxy_value_gbp,
    buyer_intent_level        = EXCLUDED.buyer_intent_level,
    updated_at                = NOW()
  RETURNING *;
END;
$$;


-- ============================================================
-- MIGRATION: 20260605_001_strategy_objective_governance_tier.sql
-- ============================================================

-- Measurement governance tier per strategy objective
-- conversion_tier: how the platform should treat this event
-- platform_action_types: per-platform mapping (e.g. {google_ads: "primary_action", meta: "custom_event"})

ALTER TABLE strategy_objectives
  ADD COLUMN IF NOT EXISTS conversion_tier      text CHECK (conversion_tier IN ('primary', 'secondary', 'suppression')),
  ADD COLUMN IF NOT EXISTS platform_action_types jsonb;


-- ============================================================
-- MIGRATION: 20260606002_set_objective_evaluation_fn.sql
-- ============================================================

CREATE OR REPLACE FUNCTION set_objective_evaluation(
  p_objective_id            UUID,
  p_org_id                  UUID,
  p_verdict                 TEXT,
  p_outcome_category        TEXT,
  p_recommended_primary_event TEXT,
  p_recommended_proxy_event TEXT,
  p_proxy_event_required    BOOLEAN,
  p_rationale               TEXT,
  p_summary_markdown        TEXT,
  p_conversion_tier         TEXT,
  p_platform_action_types   JSONB
) RETURNS SETOF strategy_objectives
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE strategy_objectives
  SET
    verdict                     = p_verdict,
    outcome_category            = p_outcome_category,
    recommended_primary_event   = p_recommended_primary_event,
    recommended_proxy_event     = p_recommended_proxy_event,
    proxy_event_required        = p_proxy_event_required,
    rationale                   = p_rationale,
    summary_markdown            = p_summary_markdown,
    conversion_tier             = p_conversion_tier,
    platform_action_types       = p_platform_action_types,
    updated_at                  = NOW()
  WHERE id              = p_objective_id
    AND organization_id = p_org_id
  RETURNING *;
END;
$$;


-- ============================================================
-- MIGRATION: 20260606_001_platform_connections.sql
-- ============================================================

-- Platform Reconciliation Phase 1: Connection Plumbing
-- Creates the platform_connections table with three connection types
-- (manager, child, standalone) and full RLS.
--
-- FK pattern follows existing Atlas migrations:
--   organization_id → auth.users(id)   (Supabase auth user = org owner)
--   client_id       → plain UUID, no FK (clients table may not exist in preview envs)
--   parent_connection_id → self-referential FK on this table
--
-- oauth_tokens stores an AES-256-GCM encrypted JSON envelope.
-- Child rows carry NULL oauth_tokens — tokens always live on the parent manager row.

CREATE TABLE IF NOT EXISTS platform_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             UUID,              -- soft ref to clients; no FK (preview env safety)
  platform              TEXT NOT NULL CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations')),
  connection_type       TEXT NOT NULL CHECK (connection_type IN ('manager', 'child', 'standalone')),
  parent_connection_id  UUID REFERENCES platform_connections(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL,
  account_label         TEXT,
  oauth_tokens          TEXT,              -- AES-256-GCM encrypted JSON envelope; NULL for child rows
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'revoked', 'error', 'available')),
  last_synced_at        TIMESTAMPTZ,
  last_error            TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, platform, account_id),

  -- Enforce the three-type invariant:
  --   manager:    org-level row, no client, no parent (tokens live here)
  --   child:      per-client row under a manager, no tokens of its own
  --   standalone: per-client row with no parent (tokens live here)
  CONSTRAINT connection_type_invariant CHECK (
    (connection_type = 'manager'    AND parent_connection_id IS NULL     AND client_id IS NULL) OR
    (connection_type = 'child'      AND parent_connection_id IS NOT NULL AND client_id IS NOT NULL) OR
    (connection_type = 'standalone' AND parent_connection_id IS NULL     AND client_id IS NOT NULL)
  )
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_platform_connections_client
  ON platform_connections (client_id, platform)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_connections_parent
  ON platform_connections (parent_connection_id)
  WHERE parent_connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_connections_manager
  ON platform_connections (organization_id, platform)
  WHERE connection_type = 'manager';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org connections"
  ON platform_connections
  FOR ALL
  USING (organization_id = auth.uid());


-- ============================================================
-- MIGRATION: 20260607002_reconciliation_core.sql
-- ============================================================

-- Platform Reconciliation Phase 2 — Reconciliation Core
-- Stores the results of config + alignment diff runs.

-- ── reconciliation_runs ───────────────────────────────────────────────────────
-- One row per reconciliation run. A run covers one client across one or more
-- platforms and is associated with a strategy brief when triggered post-lock.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,
  client_id        UUID        NOT NULL,           -- soft ref; no FK for preview env safety
  brief_id         UUID        REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  run_type         TEXT        NOT NULL
                     CHECK (run_type IN ('scheduled', 'manual', 'post_brief_lock')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  platforms_run    TEXT[]      NOT NULL DEFAULT '{}',
  total_findings   INTEGER     DEFAULT 0,
  error_summary    TEXT
);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org runs"
  ON reconciliation_runs
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_runs_client
  ON reconciliation_runs (client_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_brief
  ON reconciliation_runs (brief_id)
  WHERE brief_id IS NOT NULL;

-- ── reconciliation_findings ───────────────────────────────────────────────────
-- One row per finding within a run. Each finding has a typed code, structured
-- expected/observed payloads, a human-readable narrative, and a remediation hint.
-- resolved_at is set when a user dismisses the finding after fixing it.

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID        NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL,
  client_id         UUID        NOT NULL,
  brief_id          UUID        REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  objective_id      UUID        REFERENCES strategy_objectives(id) ON DELETE SET NULL,
  platform          TEXT        NOT NULL,
  dimension         TEXT        NOT NULL
                      CHECK (dimension IN ('delivery', 'config', 'alignment', 'volume')),
  severity          TEXT        NOT NULL
                      CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  finding_code      TEXT        NOT NULL,          -- e.g. 'WRONG_PRIMARY_CONVERSION'
  expected          JSONB,                          -- what the brief / spec says it should be
  observed          JSONB,                          -- what the platform actually has
  narrative         TEXT        NOT NULL,           -- human-readable description
  remediation_hint  TEXT,                           -- actionable next step
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org findings"
  ON reconciliation_findings
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_findings_client_unresolved
  ON reconciliation_findings (client_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_findings_brief
  ON reconciliation_findings (brief_id)
  WHERE brief_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_findings_run
  ON reconciliation_findings (run_id);


-- ============================================================
-- MIGRATION: 20260607_001_platform_state_cache.sql
-- ============================================================

-- Platform Reconciliation Phase 2 — Platform State Cache
-- Stores a periodic snapshot of conversion actions and campaign goals
-- pulled from connected ad platform accounts.

-- ── platform_conversion_actions ───────────────────────────────────────────────
-- One row per conversion action / custom conversion / key event observed on a
-- connected account. Upserted on every config sync.

CREATE TABLE IF NOT EXISTS platform_conversion_actions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id           UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id         UUID        NOT NULL,
  external_id             TEXT        NOT NULL,        -- platform's own ID for this conversion
  name                    TEXT        NOT NULL,
  status                  TEXT,                         -- ENABLED | REMOVED | HIDDEN (Google Ads); ACTIVE (Meta)
  category                TEXT,                         -- PURCHASE | LEAD | SIGNUP | … (Google Ads)
  primary_for_goal        BOOLEAN,
  attribution_model       TEXT,                         -- LAST_CLICK | DATA_DRIVEN | LINEAR | … (Google Ads)
  counting_type           TEXT,                         -- ONE_PER_CLICK | MANY_PER_CLICK (Google Ads)
  click_lookback_days     INTEGER,
  view_lookback_days      INTEGER,
  value_settings          JSONB,                        -- { default_value, default_currency, always_use_default }
  include_in_conversions  BOOLEAN,
  aem_priority            INTEGER,                      -- Meta only: position in AEM ranking (1-indexed); ≥9 = not optimised
  raw                     JSONB,                        -- full platform response preserved for debugging
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, external_id)
);

ALTER TABLE platform_conversion_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org pca"
  ON platform_conversion_actions
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pca_connection
  ON platform_conversion_actions (connection_id);

-- ── platform_campaign_goals ───────────────────────────────────────────────────
-- One row per campaign observed on a connected account. Upserted on every
-- config sync. Captures what the campaign is currently optimising for.

CREATE TABLE IF NOT EXISTS platform_campaign_goals (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id                   UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id                 UUID        NOT NULL,
  external_campaign_id            TEXT        NOT NULL,
  campaign_name                   TEXT        NOT NULL,
  campaign_type                   TEXT,                 -- SEARCH | PMAX | DISPLAY | SHOPPING (Google Ads) / campaign objective (Meta)
  status                          TEXT,                 -- ENABLED | PAUSED | REMOVED / ACTIVE | PAUSED
  optimization_goal               TEXT,                 -- Meta: OFFSITE_CONVERSIONS | LINK_CLICKS | …
  selective_optimization_actions  TEXT[],               -- Google Ads: list of conversion action external_ids this campaign optimises for
  custom_event_type               TEXT,                 -- Meta: PURCHASE | LEAD | …
  budget_micros                   BIGINT,               -- daily/lifetime budget in micros (Google) or cents (Meta)
  raw                             JSONB,
  observed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, external_campaign_id)
);

ALTER TABLE platform_campaign_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org pcg"
  ON platform_campaign_goals
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pcg_connection
  ON platform_campaign_goals (connection_id);


-- ============================================================
-- MIGRATION: 20260608_001_phase3_schema.sql
-- ============================================================

-- Phase 3: daily event stats cache + volume reconciliation tolerance config

-- Add stats sync timestamp to platform_connections
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections
      ADD COLUMN IF NOT EXISTS last_stats_synced_at TIMESTAMPTZ;
  END IF;
END $$;

-- Daily event counts cache
CREATE TABLE IF NOT EXISTS platform_event_stats_daily (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL,
  client_id         UUID        NOT NULL,
  date              DATE        NOT NULL,
  event_name        TEXT        NOT NULL,
  platform_count    INTEGER     NOT NULL DEFAULT 0,
  atlas_count       INTEGER,
  delta_pct         NUMERIC(6,2),
  quality_signals   JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, date, event_name)
);

ALTER TABLE platform_event_stats_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org stats" ON platform_event_stats_daily
  FOR ALL USING (organization_id = auth.uid());

CREATE INDEX idx_stats_connection_date
  ON platform_event_stats_daily (connection_id, date DESC);

CREATE INDEX idx_stats_client_event
  ON platform_event_stats_daily (client_id, event_name, date DESC);

-- Per-client volume reconciliation tolerance configuration
CREATE TABLE IF NOT EXISTS reconciliation_tolerance_configs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL,
  client_id             UUID        NOT NULL,
  event_name            TEXT,
  platform              TEXT,
  volume_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  dedup_warn_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.70,
  enabled               BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_tolerance_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org tolerance" ON reconciliation_tolerance_configs
  FOR ALL USING (organization_id = auth.uid());

CREATE INDEX idx_tolerance_client ON reconciliation_tolerance_configs (client_id);

-- Unique constraint using COALESCE to handle nulls in composite unique key
CREATE UNIQUE INDEX idx_tolerance_unique
  ON reconciliation_tolerance_configs (
    organization_id,
    client_id,
    COALESCE(event_name, '*'),
    COALESCE(platform, '*')
  );


-- ============================================================
-- MIGRATION: 20260609001_phase4_health_extensions.sql
-- ============================================================

-- Phase 4: Platform Acceptance score column on health tables
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_scores') THEN
    ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS platform_acceptance_score NUMERIC;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_snapshots') THEN
    ALTER TABLE health_snapshots ADD COLUMN IF NOT EXISTS platform_acceptance_score NUMERIC;
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 20260610_002_implementation_health.sql
-- ============================================================

-- Implementation Health Checks (IHC) — Sprint A1
-- New tables: gtm_container_connections, gtm_container_snapshots,
--             ihc_alert_preferences, audit_findings
-- Extension:  crawl_runs gains is_baseline flag
--
-- FK constraints to organizations and clients are applied conditionally so this
-- migration survives Supabase preview branches and CI environments where those
-- tables may not exist yet. Pattern matches the is_baseline guard below.

-- ── gtm_container_connections ────────────────────────────────────────────────
-- One row per GTM container connected to a property.
-- oauth_credentials_encrypted stores AES-256-GCM envelope (same format as capi_providers).

create table if not exists gtm_container_connections (
  id                              uuid primary key default gen_random_uuid(),
  organization_id                 uuid not null,
  client_id                       uuid,
  property_id                     uuid not null,
  container_id                    text not null,
  account_id                      text,
  auth_method                     text not null check (auth_method in ('oauth', 'manual_upload')),
  oauth_credentials_encrypted     text,
  last_synced_at                  timestamptz,
  last_container_json_snapshot_id uuid,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- Add FK to organizations if the table exists
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_connections'
        and constraint_name = 'gtm_container_connections_organization_id_fkey'
    ) then
      alter table gtm_container_connections
        add constraint gtm_container_connections_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clients') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_connections'
        and constraint_name = 'gtm_container_connections_client_id_fkey'
    ) then
      alter table gtm_container_connections
        add constraint gtm_container_connections_client_id_fkey
        foreign key (client_id) references clients(id) on delete set null;
    end if;
  end if;
end
$$;

alter table gtm_container_connections enable row level security;

create policy "gtm_container_connections_org_isolation"
  on gtm_container_connections
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_gtm_connections_org
  on gtm_container_connections (organization_id);

create index if not exists idx_gtm_connections_property
  on gtm_container_connections (property_id);

-- ── gtm_container_snapshots ──────────────────────────────────────────────────
-- Versioned container JSON snapshots. is_active = true marks the current version.

create table if not exists gtm_container_snapshots (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null references gtm_container_connections(id) on delete cascade,
  organization_id  uuid not null,
  container_json   jsonb not null,
  container_version text,
  snapshot_at      timestamptz not null default now(),
  is_active        boolean not null default true
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_snapshots'
        and constraint_name = 'gtm_container_snapshots_organization_id_fkey'
    ) then
      alter table gtm_container_snapshots
        add constraint gtm_container_snapshots_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
end
$$;

alter table gtm_container_snapshots enable row level security;

create policy "gtm_container_snapshots_org_isolation"
  on gtm_container_snapshots
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_gtm_snapshots_connection
  on gtm_container_snapshots (connection_id);

create index if not exists idx_gtm_snapshots_org_active
  on gtm_container_snapshots (organization_id, is_active);

-- ── ihc_alert_preferences ────────────────────────────────────────────────────
-- One row per org; INSERT on first save, UPDATE thereafter.

create table if not exists ihc_alert_preferences (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null unique,
  email_critical_enabled       boolean not null default true,
  email_high_digest_enabled    boolean not null default true,
  email_medium_digest_enabled  boolean not null default true,
  email_low_enabled            boolean not null default false,
  digest_timezone              text not null default 'UTC',
  daily_digest_hour            int  not null default 9,
  weekly_digest_day            int  not null default 1,
  weekly_digest_hour           int  not null default 9,
  critical_alert_batch_minutes int  not null default 15,
  recipient_user_ids           uuid[] not null default '{}',
  paused_properties            uuid[] not null default '{}',
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'ihc_alert_preferences'
        and constraint_name = 'ihc_alert_preferences_organization_id_fkey'
    ) then
      alter table ihc_alert_preferences
        add constraint ihc_alert_preferences_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
end
$$;

alter table ihc_alert_preferences enable row level security;

create policy "ihc_alert_preferences_org_isolation"
  on ihc_alert_preferences
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

-- ── audit_findings ───────────────────────────────────────────────────────────
-- Persistent finding store, cross-run. One row per (property, rule) with
-- status transitions tracked via status + first/last_seen timestamps.

create table if not exists audit_findings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  client_id        uuid,
  property_id      uuid not null,
  rule_id          text not null,
  validation_layer text not null,
  severity         text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status           text not null default 'open'
                     check (status in ('open', 'acknowledged', 'resolved', 'suppressed')),
  evidence         jsonb not null default '{}',
  resolution_note  text,
  suppressed_until timestamptz,
  first_detected_at timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'audit_findings'
        and constraint_name = 'audit_findings_organization_id_fkey'
    ) then
      alter table audit_findings
        add constraint audit_findings_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clients') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'audit_findings'
        and constraint_name = 'audit_findings_client_id_fkey'
    ) then
      alter table audit_findings
        add constraint audit_findings_client_id_fkey
        foreign key (client_id) references clients(id) on delete set null;
    end if;
  end if;
end
$$;

alter table audit_findings enable row level security;

create policy "audit_findings_org_isolation"
  on audit_findings
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_audit_findings_org_status
  on audit_findings (organization_id, status);

create index if not exists idx_audit_findings_property_severity
  on audit_findings (property_id, severity);

create index if not exists idx_audit_findings_rule
  on audit_findings (rule_id);

-- ── crawl_runs — is_baseline extension ───────────────────────────────────────
-- Wraps ALTER TABLE in existence guard for Supabase preview environments.

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'crawl_runs'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'crawl_runs' and column_name = 'is_baseline'
    ) then
      alter table crawl_runs add column is_baseline boolean not null default false;
    end if;
  end if;
end
$$;

-- Partial index — only created if crawl_runs exists (guarded by the DO block above).
-- create index if not exists is safe even if column doesn't exist yet because
-- Supabase runs the whole file; if the DO block above succeeded the column is present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'crawl_runs' and column_name = 'is_baseline'
  ) then
    execute $idx$
      create index if not exists idx_crawl_runs_baseline
        on crawl_runs (org_id, is_baseline)
        where is_baseline = true
    $idx$;
  end if;
end
$$;


-- ============================================================
-- MIGRATION: 20260611_001_ihc_drift_consecutive_count.sql
-- ============================================================

-- IHC Sprint C — add consecutive_fail_count to audit_findings
-- Tracks how many consecutive rule-evaluation runs produced a failure.
-- Drift rules (5.12–5.14) require 2 consecutive failures before status → 'open'
-- to suppress transient CSE flakiness.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'audit_findings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_findings' AND column_name = 'consecutive_fail_count'
    ) THEN
      ALTER TABLE audit_findings
        ADD COLUMN consecutive_fail_count integer NOT NULL DEFAULT 0;
    END IF;
  END IF;
END
$$;


-- ============================================================
-- MIGRATION: 20260615_001_ihc_alerts.sql
-- ============================================================

-- Phase E: IHC alert tracking
-- Adds last_alerted_at to audit_findings for dedup, and ihc_alert_log for
-- per-finding per-type send history (critical batching + digest dedup).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_findings') THEN
    ALTER TABLE public.audit_findings
      ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;
  END IF;
END $$;

-- ihc_alert_log — records every alert email sent per finding per type.
-- Used to enforce dedup (alert once per open transition), anti-flap (24h
-- suppress on rapid reopen), and critical batching (15-min rolling window).

CREATE TABLE IF NOT EXISTS public.ihc_alert_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  finding_id        uuid        NOT NULL,
  alert_type        text        NOT NULL, -- 'critical_immediate' | 'daily_digest' | 'weekly_digest'
  sent_at           timestamptz NOT NULL DEFAULT now(),
  batch_id          text,                -- groups findings sent in the same email
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_findings') THEN
    ALTER TABLE public.ihc_alert_log
      ADD CONSTRAINT IF NOT EXISTS ihc_alert_log_finding_fk
        FOREIGN KEY (finding_id) REFERENCES public.audit_findings(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_ihc_alert_log_org     ON public.ihc_alert_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_ihc_alert_log_finding ON public.ihc_alert_log(finding_id, alert_type, sent_at DESC);

ALTER TABLE public.ihc_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can read own alert log" ON public.ihc_alert_log;
CREATE POLICY "org members can read own alert log"
  ON public.ihc_alert_log FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );


-- ============================================================
-- MIGRATION: 20260617_001_missing_indexes.sql
-- ============================================================

-- OPT-03: Add missing indexes on high-traffic tables
-- Additive only — no data changes, no RLS changes, no table drops.

-- strategy_briefs: list view filters by org and sorts by created_at
CREATE INDEX IF NOT EXISTS idx_strategy_briefs_org_created
  ON strategy_briefs (organization_id, created_at DESC);

-- strategy_objectives: fetched by brief_id scoped to org
CREATE INDEX IF NOT EXISTS idx_strategy_objectives_brief_org
  ON strategy_objectives (brief_id, organization_id);

-- detected_signals: joined to crawl_pages by crawl_page_id
CREATE INDEX IF NOT EXISTS idx_detected_signals_page
  ON detected_signals (crawl_page_id);

-- offline_conversion_rows: batch status filter in bulkUpdateRowStatuses
CREATE INDEX IF NOT EXISTS idx_offline_conversion_rows_org_status
  ON offline_conversion_rows (organization_id, status);

-- reconciliation_findings: filter unresolved findings by org
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_org_resolved
  ON reconciliation_findings (organization_id, resolved_at)
  WHERE resolved_at IS NULL;

-- audit_findings: time-series IHC queries filter by org and created_at
CREATE INDEX IF NOT EXISTS idx_audit_findings_org_created
  ON audit_findings (organization_id, created_at DESC);

-- capi_events: queue processing queries filter by org and pending/processing status
CREATE INDEX IF NOT EXISTS idx_capi_events_org_status_pending
  ON capi_events (organization_id, status)
  WHERE status IN ('pending', 'processing');


