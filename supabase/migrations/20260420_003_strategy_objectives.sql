-- Sprint 1.6a: Multi-objective data foundation.
-- Extends strategy_briefs and adds strategy_objectives + strategy_objective_campaigns tables.
-- Existing single-event briefs are migrated into strategy_objectives automatically.

-- ── 1. Relax NOT NULL constraints on legacy single-event columns ───────────────
-- New multi-objective briefs don't carry verdict/business_outcome at the brief level —
-- those fields now live on strategy_objectives rows instead.
ALTER TABLE strategy_briefs ALTER COLUMN verdict DROP NOT NULL;
ALTER TABLE strategy_briefs ALTER COLUMN business_outcome DROP NOT NULL;
ALTER TABLE strategy_briefs ALTER COLUMN outcome_timing_days DROP NOT NULL;

-- ── 2. Add new columns to strategy_briefs ─────────────────────────────────────
ALTER TABLE strategy_briefs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'
    CHECK (mode IN ('single','multiple')),
  ADD COLUMN IF NOT EXISTS brief_name TEXT,
  ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES strategy_briefs(id);

-- Mark all pre-existing (Sprint 1) single-event briefs as locked since they
-- were already completed under the old flow.
UPDATE strategy_briefs SET locked_at = created_at WHERE locked_at IS NULL;

-- ── 3. strategy_objectives ────────────────────────────────────────────────────
CREATE TABLE strategy_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES strategy_briefs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  business_outcome TEXT NOT NULL,
  outcome_timing_days INTEGER NOT NULL,
  current_event TEXT,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  verdict TEXT CHECK (verdict IN ('keep','add_proxy','switch')),
  recommended_primary_event TEXT,
  recommended_proxy_event TEXT,
  rationale TEXT,
  warnings TEXT[] NOT NULL DEFAULT '{}',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_objectives_org ON strategy_objectives
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 4. strategy_objective_campaigns ──────────────────────────────────────────
CREATE TABLE strategy_objective_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID NOT NULL REFERENCES strategy_objectives(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta','google','linkedin','tiktok','other')),
  campaign_identifier TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_objective_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_objective_campaigns_org ON strategy_objective_campaigns
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_strategy_objectives_brief ON strategy_objectives(brief_id);
CREATE INDEX idx_strategy_objective_campaigns_objective ON strategy_objective_campaigns(objective_id);

-- ── 6. Data migration: one objective row per existing single-event brief ──────
-- Existing briefs had verdict/proxy_event at the brief level. Map them into
-- strategy_objectives with locked=true so they appear as completed in the new model.
INSERT INTO strategy_objectives (
  brief_id,
  organization_id,
  name,
  priority,
  business_outcome,
  outcome_timing_days,
  current_event,
  platforms,
  verdict,
  recommended_primary_event,
  recommended_proxy_event,
  rationale,
  warnings,
  locked,
  locked_at,
  created_at,
  updated_at
)
SELECT
  id                AS brief_id,
  organization_id,
  'Primary objective' AS name,
  1                 AS priority,
  business_outcome,
  outcome_timing_days,
  current_event,
  '{}'              AS platforms,
  verdict,
  current_event     AS recommended_primary_event,
  proxy_event       AS recommended_proxy_event,
  rationale,
  '{}'              AS warnings,
  TRUE              AS locked,
  created_at        AS locked_at,
  created_at,
  created_at        AS updated_at
FROM strategy_briefs
WHERE business_outcome IS NOT NULL
  AND outcome_timing_days IS NOT NULL;
