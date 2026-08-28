-- ============================================================
-- Add enrichment tracking columns to capi_providers.
-- enrichment_score: 0-100 computed completeness score.
-- enrichment_validated_at: when enrichment was last assessed.
-- identity_config_id: FK to client_identity_configs (optional).
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capi_providers') THEN
    ALTER TABLE capi_providers
      ADD COLUMN IF NOT EXISTS identity_config_id      UUID REFERENCES client_identity_configs(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS enrichment_score        INTEGER,
      ADD COLUMN IF NOT EXISTS enrichment_validated_at TIMESTAMPTZ;
  END IF;
END $$;
