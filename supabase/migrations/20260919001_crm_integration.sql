-- CRM Outcome Integration (Value-Calibrated Signal Ladder) — schema.
-- docs/prd/crm-outcome-integration.md §5. All four new tables ship in this
-- one migration per the PRD; the sync/delivery/derived-value/alerting code
-- that reads and writes them lands incrementally across Sprints 1-9.
--
-- RLS pattern: organization_id = auth.uid() (user isolation), matching the
-- convention from 20260317_001_consent_and_capi_tables.sql,
-- 20260406_001_offline_conversion_tables.sql and 20260831001_refund_events.sql.

-- ── 5.1 platform_connections.platform widened ────────────────────────────────
-- Current live CHECK (confirmed by reading supabase/migrations history, not
-- from memory, per Key Technical Decision §5.6's own instruction): widened by
-- 20260828005 (+linkedin), 20260901001 (+shopify), 20260906001 (+klaviyo).
-- The CRM connection reuses this table wholesale — AES-256-GCM encrypted
-- oauth_tokens, status, last_synced_at, metadata, client_id — no parallel
-- crm_connections table.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
    ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
      CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations', 'linkedin', 'shopify', 'klaviyo', 'hubspot', 'salesforce'));
  END IF;
END $$;

-- ── 5.2 crm_sync_configs ──────────────────────────────────────────────────────
-- One per client. Holds mapping and sync behaviour.

CREATE TABLE IF NOT EXISTS crm_sync_configs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id           UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,

  provider                TEXT NOT NULL CHECK (provider IN ('hubspot','salesforce')),

  -- Which pipeline's stages drive the ladder. NULL = the provider's default pipeline.
  pipeline_id             TEXT,
  tracked_object          TEXT NOT NULL DEFAULT 'deal' CHECK (tracked_object IN ('contact','deal')),

  -- Identity join: names of the CRM properties holding Atlas-captured click IDs.
  -- Defaults match the property names the readiness check provisions (§6.2, Sprint 2).
  identity_property_map   JSONB NOT NULL DEFAULT '{}',

  value_mode              TEXT NOT NULL DEFAULT 'DECLARED'
                          CHECK (value_mode IN ('DECLARED','DERIVED')),
  default_currency        TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(default_currency) = 3),

  -- How far back the first sync reaches. Bounded by platform ingest windows
  -- (see backend/src/services/crm/ingestWindows.ts).
  backfill_days           INTEGER NOT NULL DEFAULT 30 CHECK (backfill_days BETWEEN 0 AND 90),

  sync_enabled            BOOLEAN NOT NULL DEFAULT false,
  sync_interval_minutes   INTEGER NOT NULL DEFAULT 360 CHECK (sync_interval_minutes >= 60),
  write_back_enabled      BOOLEAN NOT NULL DEFAULT false,   -- D3, opt-in (Sprint 9)

  last_synced_at          TIMESTAMPTZ,
  last_sync_status        TEXT CHECK (last_sync_status IN ('ok','partial','failed')),
  last_sync_error         TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sync_configs_org
  ON crm_sync_configs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sync_configs_connection
  ON crm_sync_configs(connection_id);

ALTER TABLE crm_sync_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_isolation" ON crm_sync_configs;
CREATE POLICY "user_isolation" ON crm_sync_configs
  FOR ALL USING (organization_id = auth.uid());

DROP TRIGGER IF EXISTS trg_crm_sync_configs_updated ON crm_sync_configs;
CREATE TRIGGER trg_crm_sync_configs_updated
  BEFORE UPDATE ON crm_sync_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5.3 crm_stage_mappings ────────────────────────────────────────────────────
-- The ladder itself. One row per CRM stage that should produce a conversion.

CREATE TABLE IF NOT EXISTS crm_stage_mappings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,

  crm_stage_id            TEXT NOT NULL,          -- provider's stage identifier
  crm_stage_label         TEXT NOT NULL DEFAULT '',
  stage_order             INTEGER NOT NULL,        -- ladder position, ascending

  atlas_event_name        TEXT NOT NULL,           -- e.g. 'crm_mql','crm_sql','crm_closed_won'
  is_terminal_won         BOOLEAN NOT NULL DEFAULT false,
  is_terminal_lost        BOOLEAN NOT NULL DEFAULT false,

  -- DECLARED mode value. NULL in DERIVED mode (computed at delivery time).
  declared_value          DECIMAL(12,2),
  currency                TEXT CHECK (currency IS NULL OR char_length(currency) = 3),

  -- Per-destination conversion identifiers. One conversion action per stage (§9.1).
  google_conversion_action_id  TEXT,
  meta_event_name              TEXT,
  linkedin_conversion_id       TEXT,

  enabled                 BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_stage_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_stage_mappings_config
  ON crm_stage_mappings(config_id, stage_order);

ALTER TABLE crm_stage_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_isolation" ON crm_stage_mappings;
CREATE POLICY "user_isolation" ON crm_stage_mappings
  FOR ALL USING (organization_id = auth.uid());

DROP TRIGGER IF EXISTS trg_crm_stage_mappings_updated ON crm_stage_mappings;
CREATE TRIGGER trg_crm_stage_mappings_updated
  BEFORE UPDATE ON crm_stage_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5.4 crm_outcome_events ────────────────────────────────────────────────────
-- The join between a CRM record's stage change and what Atlas delivered.
-- The audit trail and the dedup key store.
--
-- PII rule: identity_key_present stores property NAMES, never values. Per
-- Implementation Rule 3 and the offline_conversion_rows precedent (raw PII
-- nulled post-upload), no raw or hashed email, phone or click ID is
-- persisted on this table.

CREATE TABLE IF NOT EXISTS crm_outcome_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,
  mapping_id              UUID REFERENCES crm_stage_mappings(id) ON DELETE SET NULL,

  crm_record_id           TEXT NOT NULL,
  crm_object              TEXT NOT NULL CHECK (crm_object IN ('contact','deal')),
  crm_stage_id            TEXT NOT NULL,
  stage_changed_at        TIMESTAMPTZ NOT NULL,

  atlas_event_name        TEXT NOT NULL,
  event_id                TEXT NOT NULL,           -- deterministic, see §9.2

  -- Identity join outcome
  identity_method         TEXT NOT NULL CHECK (identity_method IN
                            ('click_id','hashed_email','hashed_phone','unresolved')),
  identity_key_present    TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {'gclid','email'} — NAMES ONLY

  conversion_value        DECIMAL(12,2),
  currency                TEXT CHECK (currency IS NULL OR char_length(currency) = 3),
  value_source            TEXT NOT NULL CHECK (value_source IN
                            ('DECLARED','DERIVED','CRM_AMOUNT','NONE')),
  derived_confidence      TEXT CHECK (derived_confidence IN ('high','low','withheld')),

  delivery_status         TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN
                            ('pending','delivered','partial','failed','skipped_unresolved',
                             'skipped_window','dedup_skipped')),
  delivery_detail         JSONB NOT NULL DEFAULT '{}',    -- per-destination outcome
  delivered_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_record_id, crm_stage_id)          -- idempotency, see §9.2
);

CREATE INDEX IF NOT EXISTS idx_crm_outcome_events_config_created
  ON crm_outcome_events(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_outcome_events_client
  ON crm_outcome_events(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_outcome_events_delivery_status
  ON crm_outcome_events(config_id, delivery_status);

ALTER TABLE crm_outcome_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_isolation" ON crm_outcome_events;
CREATE POLICY "user_isolation" ON crm_outcome_events
  FOR ALL USING (organization_id = auth.uid());

-- ── 5.5 crm_derived_value_snapshots ───────────────────────────────────────────
-- Populated by derivedValueCalculator.ts (Sprint 7) when value_mode = 'DERIVED'.
-- Recomputed on a schedule, not per event.

CREATE TABLE IF NOT EXISTS crm_derived_value_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,
  crm_stage_id            TEXT NOT NULL,

  sample_size             INTEGER NOT NULL,        -- records that reached this stage in window
  reached_won_count       INTEGER NOT NULL,
  stage_to_won_rate       DECIMAL(6,5) NOT NULL,
  avg_won_amount          DECIMAL(12,2) NOT NULL,
  currency                TEXT NOT NULL CHECK (char_length(currency) = 3),
  derived_value           DECIMAL(12,2) NOT NULL,  -- rate × avg amount

  confidence              TEXT NOT NULL CHECK (confidence IN ('high','low','withheld')),
  window_start            DATE NOT NULL,
  window_end              DATE NOT NULL,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_stage_id, window_end)
);

CREATE INDEX IF NOT EXISTS idx_crm_derived_value_snapshots_config
  ON crm_derived_value_snapshots(config_id, crm_stage_id, window_end DESC);

ALTER TABLE crm_derived_value_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_isolation" ON crm_derived_value_snapshots;
CREATE POLICY "user_isolation" ON crm_derived_value_snapshots
  FOR ALL USING (organization_id = auth.uid());

-- ── 5.6 health_alerts.alert_type widened ──────────────────────────────────────
-- Current live CHECK confirmed by reading 20260916001_google_delivery_confirmation.sql
-- (the most recent migration to touch this constraint) rather than reconstructed
-- from memory, per that same migration's own documented lesson: 20260710_001
-- widened this constraint for 'dqm_gtg'/'dqm_dma' only and silently omitted
-- 'dqm_sgtm', which had already been a live, actively-inserted AlertType —
-- every sGTM alert open threw a CHECK violation until that gap was found and
-- fixed. Adding 'dqm_crm_sync' now (Sprint 8 wires up the actual alert
-- evaluator/inserts) so this migration never becomes the next instance of
-- that same failure mode.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_alerts') THEN
    ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
    ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
      CHECK (alert_type IN (
        'capi_delivery', 'tag_firing', 'consent_missing',
        'no_recent_audit', 'capi_not_configured',
        'recon_critical_finding', 'recon_brief_misaligned',
        'connection_expired',
        'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery', 'dqm_crm_sync'
      ));
  END IF;
END $$;
