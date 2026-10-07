-- GA4 Admin / L11 / Junk Gate PRD Part C (C2): enforce mode — real holds, per-provider held
-- payload targets, release / reject / timeout bookkeeping.
--
-- Live capi_events_status_check read from 20260922004 (the newest migration touching it) and
-- widened with 'junk_released' so a held capi_events row can be closed out honestly when the
-- hold is released (the delivery itself writes its own 'delivered'/'delivery_failed' row).
--
-- Departures from the PRD's column list (PRD §12, C2):
--   * The held payload lives in conversion_hold_targets, one row per provider config the Atlas
--     event was bound for, not in conversion_holds.payload_encrypted (left NULL, kept for shape).
--     /api/capi/process is called once per provider, each with its own identifier set and
--     provider-specific preparation, so a single payload per event cannot be released
--     per-destination.
--   * Payloads hold hashed identifiers only; raw email, phone and names never reach the row
--     (the blob is additionally AES-256-GCM encrypted and nulled on every terminal status).

ALTER TABLE conversion_holds ADD COLUMN IF NOT EXISTS timeout_hours_applied integer NULL;
ALTER TABLE conversion_holds ADD COLUMN IF NOT EXISTS timeout_clamped boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS conversion_hold_targets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id             uuid        NOT NULL REFERENCES conversion_holds(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL,
  provider_config_id  uuid        NOT NULL,
  provider            text        NOT NULL,
  -- The capi_events row written as 'junk_held' for this destination.
  capi_event_id       uuid        NULL,
  -- AES-256-GCM envelope; NULL once the hold is terminal.
  payload_encrypted   text        NULL,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'delivered', 'failed', 'dropped')),
  result_detail       jsonb       NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz NULL,
  UNIQUE (hold_id, provider_config_id)
);

CREATE INDEX IF NOT EXISTS idx_conversion_hold_targets_hold ON conversion_hold_targets (hold_id);
-- The sweeper's query: open holds ordered by expiry.
CREATE INDEX IF NOT EXISTS idx_conversion_holds_expiry ON conversion_holds (expires_at) WHERE status = 'held';

ALTER TABLE conversion_hold_targets ENABLE ROW LEVEL SECURITY;

-- Targets carry an encrypted payload and no operator-facing columns: service role only.
CREATE POLICY conversion_hold_targets_service ON conversion_hold_targets
  USING (auth.role() = 'service_role');

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'capi_events') THEN
    ALTER TABLE capi_events DROP CONSTRAINT IF EXISTS capi_events_status_check;
    ALTER TABLE capi_events ADD CONSTRAINT capi_events_status_check CHECK (status IN (
      'received', 'consent_valid', 'consent_blocked', 'validated', 'prepared',
      'delivered', 'delivery_failed', 'dead_letter',
      'junk_held', 'junk_rejected', 'junk_released'
    ));
  END IF;
END $$;
