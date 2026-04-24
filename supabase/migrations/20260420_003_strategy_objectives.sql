-- Multi-Objective Strategy Foundation
-- Extends strategy_briefs, adds strategy_objectives + strategy_objective_campaigns,
-- and migrates Sprint 1 single-event briefs into the new model.
-- All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS).

-- ── 1. Relax legacy NOT NULL constraints on strategy_briefs ──────────────────

ALTER TABLE strategy_briefs
  ALTER COLUMN verdict DROP NOT NULL,
  ALTER COLUMN business_outcome DROP NOT NULL,
  ALTER COLUMN outcome_timing_days DROP NOT NULL;

-- ── 2. New columns on strategy_briefs ────────────────────────────────────────

ALTER TABLE strategy_briefs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'
    CHECK (mode IN ('single', 'multi')),
  ADD COLUMN IF NOT EXISTS brief_name TEXT,
  ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES strategy_briefs(id);

-- ── 3. strategy_objectives ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_objectives (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id                  UUID        NOT NULL REFERENCES strategy_briefs(id) ON DELETE CASCADE,
  organization_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL,
  description               TEXT,
  platforms                 TEXT[]      NOT NULL DEFAULT '{}',
  current_event             TEXT,
  outcome_timing_days       INTEGER,
  verdict                   TEXT        CHECK (verdict IN ('CONFIRM', 'AUGMENT', 'REPLACE')),
  outcome_category          TEXT,
  recommended_primary_event TEXT,
  recommended_proxy_event   TEXT,
  proxy_event_required      BOOLEAN     NOT NULL DEFAULT FALSE,
  rationale                 TEXT,
  summary_markdown          TEXT,
  locked                    BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at                 TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_objectives_org ON strategy_objectives;
CREATE POLICY strategy_objectives_org ON strategy_objectives
  USING (organization_id = auth.uid());

-- ── 4. strategy_objective_campaigns ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_objective_campaigns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    UUID        NOT NULL REFERENCES strategy_objectives(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        TEXT        NOT NULL,
  campaign_name   TEXT,
  budget          NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strategy_objective_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_objective_campaigns_org ON strategy_objective_campaigns;
CREATE POLICY strategy_objective_campaigns_org ON strategy_objective_campaigns
  USING (organization_id = auth.uid());

-- ── 5. Migrate Sprint 1 single-event briefs ───────────────────────────────────
-- Mark them locked, then copy each into strategy_objectives.
-- INSERT is guarded by brief_id FK — safe to re-run (existing rows won't duplicate
-- because locked_at is already set and the WHERE filters on IS NOT NULL fields).

UPDATE strategy_briefs
  SET locked_at = created_at
  WHERE business_outcome IS NOT NULL
    AND outcome_timing_days IS NOT NULL
    AND locked_at IS NULL;

INSERT INTO strategy_objectives (
  brief_id,
  organization_id,
  name,
  platforms,
  current_event,
  outcome_timing_days,
  verdict,
  recommended_primary_event,
  recommended_proxy_event,
  rationale,
  locked,
  locked_at,
  created_at,
  updated_at
)
SELECT
  id                    AS brief_id,
  organization_id,
  business_outcome      AS name,
  '{}'                  AS platforms,
  current_event,
  outcome_timing_days,
  CASE verdict
    WHEN 'keep'      THEN 'CONFIRM'
    WHEN 'add_proxy' THEN 'AUGMENT'
    WHEN 'switch'    THEN 'REPLACE'
  END                   AS verdict,
  current_event         AS recommended_primary_event,
  proxy_event           AS recommended_proxy_event,
  rationale,
  TRUE                  AS locked,
  created_at            AS locked_at,
  created_at,
  created_at            AS updated_at
FROM strategy_briefs
WHERE business_outcome IS NOT NULL
  AND outcome_timing_days IS NOT NULL
  AND id NOT IN (SELECT brief_id FROM strategy_objectives);
