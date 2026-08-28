-- Add 'microsoft' and 'openai' to capi_providers.provider CHECK constraint (B4, B5)
--
-- Microsoft published Conversions API documentation in beta on 17 Aug 2026.
-- OpenAI/ChatGPT ads reached Europe on 24 Aug 2026 with almost no regional
-- agency instrumentation yet. Both follow the Amazon-precedent provider
-- pattern (see ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md Phase 3, B4/B5).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capi_providers') THEN
    ALTER TABLE capi_providers DROP CONSTRAINT IF EXISTS capi_providers_provider_check;
    ALTER TABLE capi_providers ADD CONSTRAINT capi_providers_provider_check
      CHECK (provider IN ('meta', 'google', 'tiktok', 'linkedin', 'snapchat', 'amazon', 'microsoft', 'openai'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_enrichment_configs') THEN
    ALTER TABLE signal_enrichment_configs
      ADD COLUMN IF NOT EXISTS microsoft_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS openai_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
