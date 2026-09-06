-- AIR Klaviyo connector — Ecommerce Signal Completeness PRD, Feature 2.
--
-- Widens air_metric_snapshots / air_anomalies to accept 'klaviyo' as a
-- source, and platform_connections to accept 'klaviyo' so the new connect
-- endpoint (connections.ts) can create rows the connector reads via the
-- existing resolveTokens() path — same mechanism every other AIR connector
-- uses, except Klaviyo's "oauth_tokens" envelope holds a private API key
-- (access_token field) rather than an OAuth token, since Klaviyo private-key
-- auth has no refresh flow to model.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'air_metric_snapshots') THEN
    ALTER TABLE air_metric_snapshots DROP CONSTRAINT IF EXISTS air_metric_snapshots_source_check;
    ALTER TABLE air_metric_snapshots ADD CONSTRAINT air_metric_snapshots_source_check
      CHECK (source IN ('ga4', 'google_ads', 'meta_ads', 'linkedin_ads', 'klaviyo'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'air_anomalies') THEN
    ALTER TABLE air_anomalies DROP CONSTRAINT IF EXISTS air_anomalies_source_check;
    ALTER TABLE air_anomalies ADD CONSTRAINT air_anomalies_source_check
      CHECK (source IN ('ga4', 'google_ads', 'meta_ads', 'linkedin_ads', 'klaviyo'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
    ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
      CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations', 'linkedin', 'shopify', 'klaviyo'));
  END IF;
END $$;
