-- Add an OpenAI platform-enablement flag to signal_enrichment_configs.
--
-- ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part A (A-W6) — OpenAI CAPI delivery
-- (openaiDelivery.ts) already works end-to-end. What's missing is a flag an
-- operator can toggle for a signal's OpenAI delivery, on the same footing as
-- enabled_for_meta/enabled_for_google/enabled_for_tiktok — consumed by the
-- enrichment validation rules (SIG_04, CROSS_01, CROSS_02) so an
-- OpenAI-only deployment is scored honestly instead of reading as "no
-- platforms enabled".
--
-- Defaults to false, matching enabled_for_tiktok's precedent (migration
-- 20260905001) rather than the true default enabled_for_meta/enabled_for_google
-- use — a true default here would retroactively mark every existing
-- deployment as OpenAI-enabled and change its validation score overnight.
-- This column follows the enabled_for_<platform> naming already in use, not
-- the unwired amazon_enabled/microsoft_enabled/openai_enabled columns added
-- in 20260701001/20260828003 — those stay unwired, per the PRD's explicit
-- instruction not to conflate this flag with those dead columns.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_enrichment_configs') THEN
    ALTER TABLE signal_enrichment_configs
      ADD COLUMN IF NOT EXISTS enabled_for_openai BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
