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
