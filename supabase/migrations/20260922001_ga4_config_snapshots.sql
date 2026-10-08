-- GA4 Admin / L11 / Junk Gate PRD Part A1: GA4 property configuration snapshots.
--
-- A change log, not a poll log: a new row is written only when snapshot_hash
-- differs from the property's latest row. `snapshot` is normalised and carries
-- no PII (Google Ads link creator emails are deliberately excluded).
-- Writes go through the service role; members of the owning organisation can read.

CREATE TABLE IF NOT EXISTS ga4_config_snapshots (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  connection_id    uuid        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  client_id        uuid        NULL REFERENCES clients(id) ON DELETE SET NULL,
  property_id      text        NOT NULL,
  snapshot         jsonb       NOT NULL,
  snapshot_hash    text        NOT NULL,
  captured_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ga4_config_snapshots_property
  ON ga4_config_snapshots (organization_id, property_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_config_snapshots_client
  ON ga4_config_snapshots (client_id, captured_at DESC) WHERE client_id IS NOT NULL;

ALTER TABLE ga4_config_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY ga4_config_snapshots_org_read ON ga4_config_snapshots
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );

CREATE POLICY ga4_config_snapshots_service ON ga4_config_snapshots
  USING (auth.role() = 'service_role');
