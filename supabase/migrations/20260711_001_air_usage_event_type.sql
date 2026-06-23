-- AIR pre-sprint: extend usage_events to track narration cost.
-- 'ai_insight_generated' is the event type emitted once per narrated insight
-- (one Claude call per anomaly). Stored alongside input/output tokens + model
-- so cost attribution per org is captured from day one.

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'usage_events') THEN
    ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_event_type_check;
    ALTER TABLE usage_events ADD CONSTRAINT usage_events_event_type_check
      CHECK (event_type IN (
        'page_scan',
        'ai_report_scheduled',
        'ai_report_ondemand',
        'ai_query_ondemand',
        'dma_ingest_event',
        'dma_enricher_event',
        'ai_insight_generated'
      ));
  END IF;
END $$;
