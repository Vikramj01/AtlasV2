-- Phase 3: per-client volume reconciliation tolerance configuration

CREATE TABLE IF NOT EXISTS reconciliation_tolerance_configs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL,
  client_id             UUID        NOT NULL,
  event_name            TEXT,
  platform              TEXT,
  volume_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  dedup_warn_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.70,
  enabled               BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation_tolerance_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org tolerance" ON reconciliation_tolerance_configs
  FOR ALL USING (organization_id = auth.uid());

CREATE INDEX idx_tolerance_client ON reconciliation_tolerance_configs (client_id);

-- Unique constraint using COALESCE to handle nulls in composite unique key
CREATE UNIQUE INDEX idx_tolerance_unique
  ON reconciliation_tolerance_configs (
    organization_id,
    client_id,
    COALESCE(event_name, '*'),
    COALESCE(platform, '*')
  );
