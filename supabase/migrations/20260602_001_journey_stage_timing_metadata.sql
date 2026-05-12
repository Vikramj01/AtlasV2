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
