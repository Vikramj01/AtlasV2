-- Google Tag Topology PRD §7.3 (Sprint 4): a split plan is the delta Atlas
-- generated for a client plus its lifecycle. Atlas never publishes — a plan
-- reaches 'verified' only after a fresh topology observation (§7.4).

CREATE TABLE IF NOT EXISTS google_tag_split_plans (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  client_id              uuid        NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id          uuid        NULL REFERENCES gtm_container_connections(id) ON DELETE SET NULL,
  topology_snapshot_ids  uuid[]      NOT NULL DEFAULT '{}',
  delta                  jsonb       NOT NULL,
  diff                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status                 text        NOT NULL DEFAULT 'planned'
                           CHECK (status IN ('planned', 'deployed_draft', 'verified', 'abandoned')),
  deployed_workspace_id  text        NULL,
  deployed_at            timestamptz NULL,
  verified_at            timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_tag_split_plans_client
  ON google_tag_split_plans (client_id, created_at DESC);

ALTER TABLE google_tag_split_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_tag_split_plans_org_read ON google_tag_split_plans
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );

CREATE POLICY google_tag_split_plans_service ON google_tag_split_plans
  USING (auth.role() = 'service_role');
