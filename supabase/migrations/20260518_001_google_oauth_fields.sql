-- Sprint 4: Google OAuth lifecycle + adapter name
--
-- access_token_expires_at: top-level column (not in encrypted credentials blob)
--   so the OAuth refresh job can check token expiry without decrypting.
--   Populated by the google-oauth-refresh Bull job after each successful refresh.
--
-- adapter_name: records which of the three Google sub-adapters the user configured.
--   Values: 'google_ec_web' | 'google_ec_leads' | 'google_offline'
--   NULL for Meta, TikTok, LinkedIn providers.

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adapter_name             TEXT;

COMMENT ON COLUMN capi_providers.access_token_expires_at
  IS 'Google only — when the stored OAuth access token expires. Used by the refresh job to schedule proactive renewal.';

COMMENT ON COLUMN capi_providers.adapter_name
  IS 'Google sub-adapter: google_ec_web (real-time EC), google_ec_leads (lead matching), google_offline (CSV batch). NULL for non-Google providers.';
