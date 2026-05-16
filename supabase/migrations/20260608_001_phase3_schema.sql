-- Phase 3: daily event stats cache + volume reconciliation tolerance config

-- Add stats sync timestamp to platform_connections
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections
      ADD COLUMN IF NOT EXISTS last_stats_synced_at TIMESTAMPTZ;
  END IF;
END $$;

-- Daily event counts cache
CREATE TABLE IF NOT EXISTS platform_event_stats_daily (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id   UUID        NOT NULL,
  client_id         UUID        NOT NULL,
  date              DATE        NOT NULL,
  event_name        TEXT        NOT NULL,
  platform_count    INTEGER     NOT NULL DEFAULT 0,
  atlas_count       INTEGER,
  delta_pct         NUMERIC(6,2),
  quality_signals   JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, date, event_name)
);

ALTER TABLE platform_event_stats_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org stats" ON platform_event_stats_daily
  FOR ALL USING (organization_id = auth.uid());

CREATE INDEX idx_stats_connection_date
  ON platform_event_stats_daily (connection_id, date DESC);

CREATE INDEX idx_stats_client_event
  ON platform_event_stats_daily (client_id, event_name, date DESC);

-- Per-client volume reconciliation tolerance configuration
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
