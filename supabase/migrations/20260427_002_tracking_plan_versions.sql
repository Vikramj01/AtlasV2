-- Sprint 2.5: tracking_plan_versions — version history for planning outputs
-- Each row captures a snapshot of a session's full output set at a point in time.
-- RLS: users can only see versions for their own sessions.

CREATE TABLE IF NOT EXISTS tracking_plan_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  label           TEXT,                        -- optional human label e.g. "Post-QA update"
  gtm_output_id   UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
  spec_output_id  UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
  guide_output_id UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);

-- Index for fast lookups by session
CREATE INDEX IF NOT EXISTS tracking_plan_versions_session_id_idx
  ON tracking_plan_versions (session_id, version DESC);

-- RLS
ALTER TABLE tracking_plan_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own session versions"
  ON tracking_plan_versions
  FOR ALL
  USING (
    session_id IN (
      SELECT id FROM planning_sessions WHERE user_id = auth.uid()
    )
  );
