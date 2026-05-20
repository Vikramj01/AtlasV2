-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 1 (DMA Foundation) — Google Data Manager OAuth credentials
--
-- RUN MANUALLY on Supabase before Sprint 2 backend deploy.
-- This migration is safe to re-run: all statements are idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- google_dma_credentials: one row per org, links the DMA OAuth grant to the
-- existing platform_connections manager row that holds the encrypted tokens.
-- Token resolution goes: org_id → linked_connection_id → platform_connections.oauth_tokens
-- (decrypted by tokenManager). No tokens are stored redundantly here.

CREATE TABLE IF NOT EXISTS google_dma_credentials (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- Points to the Google Ads manager platform_connections row that holds OAuth tokens.
  -- SET NULL on connection deletion so the row persists and the UI can prompt reconnect.
  linked_connection_id  uuid        REFERENCES platform_connections(id) ON DELETE SET NULL,
  oauth_scope           text        NOT NULL DEFAULT 'https://www.googleapis.com/auth/datamanager',
  -- Populated from the access token expiry at upsert time; used for UI display only.
  -- Actual expiry is authoritative in platform_connections.oauth_tokens.
  expires_at            timestamptz,
  consent_metadata      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

ALTER TABLE google_dma_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_only" ON google_dma_credentials
  FOR ALL
  USING (
    org_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Extend usage_events with DMA-specific columns for ingest event tracking.
-- These are nullable: populated only for event_type = 'dma_ingest_event'.

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS dma_destination  text,    -- 'google_ads' | 'ga4' | 'dv360' | 'cm360'
  ADD COLUMN IF NOT EXISTS dma_record_count integer; -- members or events ingested per call

COMMENT ON COLUMN usage_events.dma_destination  IS 'Populated for dma_ingest_event rows; identifies the DMA write destination.';
COMMENT ON COLUMN usage_events.dma_record_count IS 'Populated for dma_ingest_event rows; count of events or audience members ingested.';
