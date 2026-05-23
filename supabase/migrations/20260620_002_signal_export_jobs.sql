-- Signal Tracking Dashboard — async export jobs table
-- Tracks Bull-queued CSV export requests. The actual Bull worker that
-- processes these jobs is implemented in Sprint 5; this table provides
-- the status-polling contract for the API from Sprint 2 onward.

CREATE TABLE IF NOT EXISTS signal_export_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  filters         JSONB       NOT NULL DEFAULT '{}',
  row_estimate    INTEGER,
  storage_path    TEXT,
  download_url    TEXT,
  expires_at      TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

ALTER TABLE signal_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON signal_export_jobs
  FOR ALL USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_signal_export_jobs_org_created
  ON signal_export_jobs (organization_id, created_at DESC);
