-- Google Tag Topology PRD §6.2 (Sprint 3).
--
-- Live constraints were read from the connected project before writing this
-- (detected_signals_signal_type_check lists the 11 original values) per the
-- dqm_sgtm silent-CHECK-violation lesson (CLAUDE.md Key Technical Decision §21).

CREATE TABLE IF NOT EXISTS google_tag_topology (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid        NOT NULL,
  client_id               uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  google_tag_id           text        NOT NULL,
  primary_destination_id  text        NULL,
  destination_ids         text[]      NOT NULL,
  source                  text        NOT NULL CHECK (source IN ('gtm_api', 'runtime_observed', 'operator_declared')),
  evidence_class          text        NOT NULL,
  -- Only for operator_declared rows (existing declaration_source semantics).
  declaration_source      text        NULL CHECK (declaration_source IN ('CLIENT_CONFIRMED', 'OPERATOR_ASSUMED')),
  -- True when a runtime row was built from co-occurrence, not self-attribution.
  inferred                boolean     NOT NULL DEFAULT false,
  crawl_run_id            uuid        NULL,
  audit_id                uuid        NULL,
  observed_at             timestamptz NOT NULL DEFAULT now(),
  is_current              boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_google_tag_topology_client_current
  ON google_tag_topology (client_id, is_current);

ALTER TABLE google_tag_topology ENABLE ROW LEVEL SECURITY;

-- organisation_members/clients pattern: a row is visible to members of the
-- owning organisation. Writes go through the service role.
CREATE POLICY google_tag_topology_org_read ON google_tag_topology
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );

CREATE POLICY google_tag_topology_service ON google_tag_topology
  USING (auth.role() = 'service_role');

-- CSE runtime capture: widen detected_signals.signal_type.
ALTER TABLE detected_signals DROP CONSTRAINT IF EXISTS detected_signals_signal_type_check;
ALTER TABLE detected_signals ADD CONSTRAINT detected_signals_signal_type_check CHECK (signal_type IN (
  'gtm_container',
  'ga4_base',
  'ga4_event',
  'meta_pixel',
  'meta_capi',
  'google_ads_conversion',
  'google_ads_remarketing',
  'tiktok_pixel',
  'linkedin_insight',
  'snapchat_pixel',
  'custom_event',
  'google_tag_destination_observed'
));
