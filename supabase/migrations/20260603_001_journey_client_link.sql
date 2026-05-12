-- Link journeys to clients (optional, for agency workflow where the wizard is
-- launched from a specific client's page). Null means the journey is standalone.
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journeys_client_id ON journeys (client_id)
  WHERE client_id IS NOT NULL;
