-- GA4 Admin / L11 / Junk Gate PRD Part C (C1): junk conversion gate — config, per-event
-- verdict/hold records, and the two new capi_events statuses.
--
-- Live definition read from the connected project before writing this (CLAUDE.md §21 / the
-- dqm_sgtm silent-CHECK-violation lesson):
--   capi_events_status_check → received, consent_valid, consent_blocked, validated, prepared,
--                              delivered, delivery_failed, dead_letter
--
-- conversion_holds departs from the PRD's column list in four documented ways (PRD §12, C1):
--   * `status` also allows 'observed' — observe mode (the default) records the verdict a
--     conversion WOULD have received without holding anything; there is nothing to release.
--   * `verdict` also allows 'clean', so an observed-clean evaluation is a countable denominator
--     for the hit-rate metrics (C3). Clean rows carry no payload and no rule hits.
--   * `client_id` is nullable: a CAPI provider with no identity config has no client to scope to.
--   * `payload_encrypted` is nullable: an observed row has no payload to release (C2 fills it
--     for real holds only).
-- UNIQUE (organization_id, atlas_event_id) is what makes "one record per Atlas event, however
-- many provider configs it is bound for" hold even when two provider calls race.

CREATE TABLE IF NOT EXISTS junk_gate_configs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  client_id           uuid        NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- Default observe: record verdicts, never delay or block (PRD §C.8).
  mode                text        NOT NULL DEFAULT 'observe' CHECK (mode IN ('off', 'observe', 'enforce')),
  -- Empty = the default lead-type event set.
  event_names         text[]      NOT NULL DEFAULT '{}',
  rule_flags          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  thresholds          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  action_junk         text        NOT NULL DEFAULT 'hold' CHECK (action_junk IN ('hold', 'drop', 'send')),
  action_suspect      text        NOT NULL DEFAULT 'hold' CHECK (action_suspect IN ('hold', 'drop', 'send')),
  hold_timeout_hours  integer     NOT NULL DEFAULT 24 CHECK (hold_timeout_hours BETWEEN 1 AND 72),
  timeout_action      text        NOT NULL DEFAULT 'release' CHECK (timeout_action IN ('release', 'drop')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversion_holds (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  client_id             uuid        NULL REFERENCES clients(id) ON DELETE SET NULL,
  atlas_event_id        text        NOT NULL,
  event_name            text        NOT NULL,
  event_time            timestamptz NOT NULL,
  provider_config_ids   uuid[]      NOT NULL DEFAULT '{}',
  verdict               text        NOT NULL CHECK (verdict IN ('junk', 'suspect', 'clean')),
  -- Rule ids plus non-PII evidence only.
  rule_hits             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- AES-256-GCM (C2); NULL for observed rows. Nulled on every terminal status.
  payload_encrypted     text        NULL,
  delivery_class        text        NULL CHECK (delivery_class IN ('server_only', 'hybrid')),
  status                text        NOT NULL CHECK (status IN ('observed', 'held', 'released', 'rejected', 'auto_released', 'auto_dropped')),
  expires_at            timestamptz NULL,
  decided_by            uuid        NULL,
  decided_at            timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, atlas_event_id)
);

CREATE INDEX IF NOT EXISTS idx_conversion_holds_client ON conversion_holds (client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversion_holds_open ON conversion_holds (organization_id, expires_at) WHERE status = 'held';

ALTER TABLE junk_gate_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_holds ENABLE ROW LEVEL SECURITY;

-- Org members read; writes go through the service role (the same pattern as the other
-- operator-visible monitoring tables).
CREATE POLICY junk_gate_configs_org_read ON junk_gate_configs
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );
CREATE POLICY junk_gate_configs_service ON junk_gate_configs
  USING (auth.role() = 'service_role');

CREATE POLICY conversion_holds_org_read ON conversion_holds
  FOR SELECT USING (
    organization_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    OR organization_id = auth.uid()
  );
CREATE POLICY conversion_holds_service ON conversion_holds
  USING (auth.role() = 'service_role');

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capi_events') THEN
    ALTER TABLE capi_events DROP CONSTRAINT IF EXISTS capi_events_status_check;
    ALTER TABLE capi_events ADD CONSTRAINT capi_events_status_check CHECK (status IN (
      'received', 'consent_valid', 'consent_blocked', 'validated', 'prepared',
      'delivered', 'delivery_failed', 'dead_letter',
      'junk_held', 'junk_rejected'
    ));
  END IF;
END $$;
