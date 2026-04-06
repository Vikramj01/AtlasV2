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
