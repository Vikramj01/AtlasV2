-- ============================================================
-- COMPOSABLE SIGNALS — MIGRATION 2
-- Add client_id foreign key to existing tables
--
-- Run AFTER migration 1 (organisations & clients must exist).
-- Adds nullable client_id columns so existing rows are unaffected.
-- ============================================================

-- planning_sessions
ALTER TABLE planning_sessions
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- journeys
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- audits
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- Indexes for FK lookups
CREATE INDEX IF NOT EXISTS idx_planning_sessions_client ON planning_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_journeys_client           ON journeys(client_id);
CREATE INDEX IF NOT EXISTS idx_audits_client             ON audits(client_id);
