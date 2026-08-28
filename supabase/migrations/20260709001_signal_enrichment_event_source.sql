-- Add event_source to signal_enrichment_configs and signals
-- Supports configurable action_source / DMA EventSource per signal deployment.
-- Default 'website' preserves existing behaviour for all current rows.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_enrichment_configs') THEN
    ALTER TABLE signal_enrichment_configs
      ADD COLUMN IF NOT EXISTS event_source TEXT NOT NULL DEFAULT 'website'
        CHECK (event_source IN ('website','physical_store','phone_call','system_generated','app','chat'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signals') THEN
    ALTER TABLE signals
      ADD COLUMN IF NOT EXISTS event_source TEXT NOT NULL DEFAULT 'website'
        CHECK (event_source IN ('website','physical_store','system_generated','app'));

    CREATE INDEX IF NOT EXISTS idx_signals_event_source ON signals (event_source);
  END IF;
END $$;
