-- ============================================================
-- Signal Enrichment Configs
-- Per-deployment, per-signal enrichment configuration:
-- value field mapping, dedup ID, currency, product content IDs.
-- ============================================================

CREATE TABLE IF NOT EXISTS signal_enrichment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  signal_key    TEXT NOT NULL,

  -- Value configuration
  value_field             TEXT,
  value_includes_tax      BOOLEAN NOT NULL DEFAULT false,
  value_includes_shipping BOOLEAN NOT NULL DEFAULT false,
  currency_field          TEXT,
  currency_static         TEXT,

  -- Deduplication
  dedup_id_field TEXT,

  -- Product / catalogue data
  content_ids_field     TEXT,
  content_ids_path_type TEXT NOT NULL DEFAULT 'array'
                        CHECK (content_ids_path_type IN ('array', 'string', 'nested')),
  num_items_field       TEXT,

  -- Platform enablement
  enabled_for_meta   BOOLEAN NOT NULL DEFAULT true,
  enabled_for_google BOOLEAN NOT NULL DEFAULT true,

  -- Validation state
  validated_at        TIMESTAMPTZ,
  validation_score    INTEGER,
  validation_warnings JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(deployment_id, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_deployment ON signal_enrichment_configs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_signal_key ON signal_enrichment_configs(signal_key);

ALTER TABLE signal_enrichment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members access enrichment configs"
  ON signal_enrichment_configs
  FOR ALL
  USING (
    deployment_id IN (
      SELECT d.id FROM deployments d
      JOIN clients c ON c.id = d.client_id
      JOIN organisation_members om ON om.organisation_id = c.organisation_id
      WHERE om.user_id = auth.uid()
    )
  );
