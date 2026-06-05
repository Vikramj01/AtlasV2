-- Slack Destinations
-- Stores per-org Slack Incoming Webhook URLs for sharing Atlas results.
-- Webhook URLs are encrypted at rest using AES-256-GCM (same key as CAPI credentials).

CREATE TABLE IF NOT EXISTS slack_destinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  webhook_url     TEXT NOT NULL,   -- AES-256-GCM encrypted envelope
  channel_hint    TEXT,            -- display-only, e.g. "#atlas-reports"
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE slack_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage own slack destinations"
  ON slack_destinations FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS slack_destinations_org_idx ON slack_destinations (organization_id);
