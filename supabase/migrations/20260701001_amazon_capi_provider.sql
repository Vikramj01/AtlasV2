-- Add 'amazon' to capi_providers.provider CHECK constraint
-- and add amazon_enabled flag to signal_enrichment_configs

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capi_providers') THEN
    ALTER TABLE capi_providers DROP CONSTRAINT IF EXISTS capi_providers_provider_check;
    ALTER TABLE capi_providers ADD CONSTRAINT capi_providers_provider_check
      CHECK (provider IN ('meta', 'google', 'tiktok', 'linkedin', 'snapchat', 'amazon'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_enrichment_configs') THEN
    ALTER TABLE signal_enrichment_configs
      ADD COLUMN IF NOT EXISTS amazon_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
