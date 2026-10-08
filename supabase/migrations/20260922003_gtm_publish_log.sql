-- GA4 Admin / L11 / Junk Gate PRD §A.6: every programmatic GTM publish and
-- rollback is logged, so a rollback target always exists and the live container
-- is never changed without a record of who did it and what it replaced.
-- Writes go through the service role; members of the owning organisation read.

CREATE TABLE IF NOT EXISTS gtm_publish_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  client_id            uuid        NULL REFERENCES clients(id) ON DELETE SET NULL,
  connection_id        uuid        NOT NULL REFERENCES gtm_container_connections(id) ON DELETE CASCADE,
  account_id           text        NOT NULL,
  container_id         text        NOT NULL,
  workspace_id         text        NULL,
  action               text        NOT NULL DEFAULT 'publish' CHECK (action IN ('publish', 'rollback')),
  published_version_id text        NOT NULL,
  -- The version that was live immediately before this action; NULL when the container had never been published.
  previous_version_id  text        NULL,
  -- For a rollback row: the publish row it reverted.
  rollback_of          uuid        NULL REFERENCES gtm_publish_log(id) ON DELETE SET NULL,
  -- For a publish row: set once it has been rolled back (a publish is rolled back at most once).
  rolled_back_at       timestamptz NULL,
  user_id              uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gtm_publish_log_connection ON gtm_publish_log (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtm_publish_log_org ON gtm_publish_log (organization_id, created_at DESC);

ALTER TABLE gtm_publish_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY gtm_publish_log_org_read ON gtm_publish_log
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );

CREATE POLICY gtm_publish_log_service ON gtm_publish_log
  USING (auth.role() = 'service_role');
