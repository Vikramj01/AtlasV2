-- Strategy Briefs — stores persisted conversion strategy evaluations.
-- organization_id = auth.uid() (matches the pattern used by consent/capi tables).
-- client_id and project_id are plain UUIDs (no FK — tables may not exist yet).

CREATE TABLE IF NOT EXISTS strategy_briefs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id            UUID,
  project_id           UUID,
  business_outcome     TEXT,
  outcome_timing_days  INTEGER,
  current_event        TEXT,
  verdict              TEXT        CHECK (verdict IN ('keep', 'add_proxy', 'switch')),
  proxy_event          TEXT,
  rationale            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_briefs_org ON strategy_briefs;
CREATE POLICY strategy_briefs_org ON strategy_briefs
  USING (organization_id = auth.uid());
