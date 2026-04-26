-- Sprint 2.0a: Deduplication Engine — database foundation
-- Adds dedup tracking to capi_events, creates capi_browser_events table,
-- and adds provider_token to capi_providers for beacon authentication.

-- ── capi_events: dedup tracking columns ──────────────────────────────────────

ALTER TABLE capi_events
  ADD COLUMN IF NOT EXISTS event_id         TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key        TEXT,
  ADD COLUMN IF NOT EXISTS dedup_status     TEXT CHECK (dedup_status IN ('hit', 'miss', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS dedup_matched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_capi_events_dedup_status
  ON capi_events (organization_id, provider_config_id, dedup_status, processed_at);

-- ── capi_browser_events: Atlas Signal Tag beacon store ────────────────────────
-- Receives browser-side event_id beacons from GTM before server-side CAPI fires.
-- Redis is the hot lookup path; this table provides a durable audit trail.

CREATE TABLE IF NOT EXISTS capi_browser_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id      UUID        REFERENCES capi_providers(id) ON DELETE SET NULL,
  event_id         TEXT        NOT NULL,
  event_name       TEXT        NOT NULL,
  fbclid           TEXT,
  gclid            TEXT,
  session_id       TEXT,
  event_data       JSONB,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

ALTER TABLE capi_browser_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON capi_browser_events
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_capi_browser_events_lookup
  ON capi_browser_events (organization_id, event_name, fbclid, received_at DESC);

-- ── capi_providers: provider_token for beacon authentication ─────────────────
-- Included in the generated GTM container as a constant variable.
-- The browser-event beacon authenticates via X-Atlas-Provider-Token header
-- without requiring a Supabase session.

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS provider_token UUID DEFAULT gen_random_uuid();

-- Back-fill any existing rows that got a NULL (DEFAULT only applies to new rows
-- when the column already existed with IF NOT EXISTS on a populated table).
UPDATE capi_providers
  SET provider_token = gen_random_uuid()
  WHERE provider_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_providers_token
  ON capi_providers (provider_token);
