-- Platform Reconciliation Phase 2 — Reconciliation Core
-- Stores the results of config + alignment diff runs.

-- ── reconciliation_runs ───────────────────────────────────────────────────────
-- One row per reconciliation run. A run covers one client across one or more
-- platforms and is associated with a strategy brief when triggered post-lock.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,
  client_id        UUID        NOT NULL,           -- soft ref; no FK for preview env safety
  brief_id         UUID        REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  run_type         TEXT        NOT NULL
                     CHECK (run_type IN ('scheduled', 'manual', 'post_brief_lock')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  platforms_run    TEXT[]      NOT NULL DEFAULT '{}',
  total_findings   INTEGER     DEFAULT 0,
  error_summary    TEXT
);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org runs"
  ON reconciliation_runs
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_runs_client
  ON reconciliation_runs (client_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_brief
  ON reconciliation_runs (brief_id)
  WHERE brief_id IS NOT NULL;

-- ── reconciliation_findings ───────────────────────────────────────────────────
-- One row per finding within a run. Each finding has a typed code, structured
-- expected/observed payloads, a human-readable narrative, and a remediation hint.
-- resolved_at is set when a user dismisses the finding after fixing it.

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID        NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL,
  client_id         UUID        NOT NULL,
  brief_id          UUID        REFERENCES strategy_briefs(id) ON DELETE SET NULL,
  objective_id      UUID        REFERENCES strategy_objectives(id) ON DELETE SET NULL,
  platform          TEXT        NOT NULL,
  dimension         TEXT        NOT NULL
                      CHECK (dimension IN ('delivery', 'config', 'alignment', 'volume')),
  severity          TEXT        NOT NULL
                      CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  finding_code      TEXT        NOT NULL,          -- e.g. 'WRONG_PRIMARY_CONVERSION'
  expected          JSONB,                          -- what the brief / spec says it should be
  observed          JSONB,                          -- what the platform actually has
  narrative         TEXT        NOT NULL,           -- human-readable description
  remediation_hint  TEXT,                           -- actionable next step
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org findings"
  ON reconciliation_findings
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_findings_client_unresolved
  ON reconciliation_findings (client_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_findings_brief
  ON reconciliation_findings (brief_id)
  WHERE brief_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_findings_run
  ON reconciliation_findings (run_id);
