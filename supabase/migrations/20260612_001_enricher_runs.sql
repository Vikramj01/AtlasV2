CREATE TABLE IF NOT EXISTS enricher_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  ingest_type     text        NOT NULL DEFAULT 'audience_members',
  destinations    jsonb       NOT NULL DEFAULT '[]',
  operation_type  text        NOT NULL DEFAULT 'CREATE',
  status          text        NOT NULL DEFAULT 'completed',
  record_count    integer     NOT NULL DEFAULT 0,
  matched_count   integer,
  failed_count    integer,
  match_rate      numeric(5,2),
  dma_response    jsonb,
  error_message   text,
  triggered_by    text        NOT NULL DEFAULT 'manual',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE enricher_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'organisation_members') THEN
    CREATE POLICY "org_members_only" ON enricher_runs
      FOR ALL
      USING (
        org_id IN (
          SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
