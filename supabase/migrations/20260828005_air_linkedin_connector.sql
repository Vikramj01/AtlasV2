-- AIR LinkedIn connector (B13) + adjacent pre-existing fixes
--
-- Widens air_metric_snapshots / air_anomalies to accept 'linkedin_ads' as a
-- source, and platform_connections to accept 'linkedin' so a future OAuth
-- connect flow (not built here — see note below) can create rows the AIR
-- LinkedIn connector can read via the existing resolveTokens() path.
--
-- Note: this migration does not add a LinkedIn OAuth connect flow. Until one
-- exists, no platform_connections row with platform='linkedin' will ever be
-- created, so the new connector runs as a structurally-correct no-op (same
-- as every other AIR connector when an org has no matching connection).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'air_metric_snapshots') THEN
    ALTER TABLE air_metric_snapshots DROP CONSTRAINT IF EXISTS air_metric_snapshots_source_check;
    ALTER TABLE air_metric_snapshots ADD CONSTRAINT air_metric_snapshots_source_check
      CHECK (source IN ('ga4', 'google_ads', 'meta_ads', 'linkedin_ads'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'air_anomalies') THEN
    ALTER TABLE air_anomalies DROP CONSTRAINT IF EXISTS air_anomalies_source_check;
    ALTER TABLE air_anomalies ADD CONSTRAINT air_anomalies_source_check
      CHECK (source IN ('ga4', 'google_ads', 'meta_ads', 'linkedin_ads'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
    ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
      CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations', 'linkedin'));
  END IF;
END $$;
