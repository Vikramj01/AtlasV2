-- Platform Reconciliation Phase 2 — Platform State Cache
-- Stores a periodic snapshot of conversion actions and campaign goals
-- pulled from connected ad platform accounts.

-- ── platform_conversion_actions ───────────────────────────────────────────────
-- One row per conversion action / custom conversion / key event observed on a
-- connected account. Upserted on every config sync.

CREATE TABLE IF NOT EXISTS platform_conversion_actions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id           UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id         UUID        NOT NULL,
  external_id             TEXT        NOT NULL,        -- platform's own ID for this conversion
  name                    TEXT        NOT NULL,
  status                  TEXT,                         -- ENABLED | REMOVED | HIDDEN (Google Ads); ACTIVE (Meta)
  category                TEXT,                         -- PURCHASE | LEAD | SIGNUP | … (Google Ads)
  primary_for_goal        BOOLEAN,
  attribution_model       TEXT,                         -- LAST_CLICK | DATA_DRIVEN | LINEAR | … (Google Ads)
  counting_type           TEXT,                         -- ONE_PER_CLICK | MANY_PER_CLICK (Google Ads)
  click_lookback_days     INTEGER,
  view_lookback_days      INTEGER,
  value_settings          JSONB,                        -- { default_value, default_currency, always_use_default }
  include_in_conversions  BOOLEAN,
  aem_priority            INTEGER,                      -- Meta only: position in AEM ranking (1-indexed); ≥9 = not optimised
  raw                     JSONB,                        -- full platform response preserved for debugging
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, external_id)
);

ALTER TABLE platform_conversion_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org pca"
  ON platform_conversion_actions
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pca_connection
  ON platform_conversion_actions (connection_id);

-- ── platform_campaign_goals ───────────────────────────────────────────────────
-- One row per campaign observed on a connected account. Upserted on every
-- config sync. Captures what the campaign is currently optimising for.

CREATE TABLE IF NOT EXISTS platform_campaign_goals (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id                   UUID        NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id                 UUID        NOT NULL,
  external_campaign_id            TEXT        NOT NULL,
  campaign_name                   TEXT        NOT NULL,
  campaign_type                   TEXT,                 -- SEARCH | PMAX | DISPLAY | SHOPPING (Google Ads) / campaign objective (Meta)
  status                          TEXT,                 -- ENABLED | PAUSED | REMOVED / ACTIVE | PAUSED
  optimization_goal               TEXT,                 -- Meta: OFFSITE_CONVERSIONS | LINK_CLICKS | …
  selective_optimization_actions  TEXT[],               -- Google Ads: list of conversion action external_ids this campaign optimises for
  custom_event_type               TEXT,                 -- Meta: PURCHASE | LEAD | …
  budget_micros                   BIGINT,               -- daily/lifetime budget in micros (Google) or cents (Meta)
  raw                             JSONB,
  observed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, external_campaign_id)
);

ALTER TABLE platform_campaign_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org pcg"
  ON platform_campaign_goals
  FOR ALL
  USING (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pcg_connection
  ON platform_campaign_goals (connection_id);
