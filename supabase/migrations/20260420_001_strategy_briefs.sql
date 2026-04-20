-- Strategy Briefs — stores persisted conversion strategy evaluations.
-- Linked optionally to a client and/or project so gating logic can verify
-- that a brief exists before allowing spec-generating actions.

CREATE TABLE strategy_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  business_outcome TEXT NOT NULL,
  outcome_timing_days INTEGER NOT NULL,
  current_event TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('keep', 'add_proxy', 'switch')),
  proxy_event TEXT,
  rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY strategy_briefs_org ON strategy_briefs
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Add strategy_brief_id FK to projects (nullable — existing projects unaffected)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS strategy_brief_id UUID REFERENCES strategy_briefs(id);
