-- ============================================================
-- Atlas Phase 3: Channel Signal Behaviour Tables
-- ============================================================

-- ── channel_sessions ─────────────────────────────────────────────────────────
-- One row per visitor session, classified by acquisition channel.

CREATE TABLE IF NOT EXISTS channel_sessions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_ext_id          TEXT        NOT NULL,
  website_url             TEXT        NOT NULL,
  channel                 TEXT        NOT NULL,
  source                  TEXT,
  medium                  TEXT,
  campaign                TEXT,
  device_type             TEXT,
  browser                 TEXT,
  landing_page            TEXT        NOT NULL,
  started_at              TIMESTAMPTZ NOT NULL,
  event_count             INTEGER     NOT NULL DEFAULT 0,
  page_count              INTEGER     NOT NULL DEFAULT 0,
  conversion_reached      BOOLEAN     NOT NULL DEFAULT false,
  signal_completion_score NUMERIC(5,4),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, website_url, session_ext_id)
);

CREATE INDEX IF NOT EXISTS channel_sessions_user_id_idx          ON channel_sessions (user_id);
CREATE INDEX IF NOT EXISTS channel_sessions_website_url_idx      ON channel_sessions (website_url);
CREATE INDEX IF NOT EXISTS channel_sessions_started_at_idx       ON channel_sessions (started_at);
CREATE INDEX IF NOT EXISTS channel_sessions_channel_idx          ON channel_sessions (channel);

ALTER TABLE channel_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_sessions_owner"
  ON channel_sessions
  FOR ALL
  USING (user_id = auth.uid());

-- ── channel_session_events ───────────────────────────────────────────────────
-- Individual tracked events belonging to a session.

CREATE TABLE IF NOT EXISTS channel_session_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID        NOT NULL REFERENCES channel_sessions(id) ON DELETE CASCADE,
  event_name           TEXT        NOT NULL,
  event_category       TEXT        NOT NULL,
  page_url             TEXT,
  event_params         JSONB,
  signal_health_status TEXT,
  seq                  INTEGER     NOT NULL DEFAULT 0,
  fired_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_session_events_session_id_idx ON channel_session_events (session_id);
CREATE INDEX IF NOT EXISTS channel_session_events_seq_idx        ON channel_session_events (session_id, seq);

ALTER TABLE channel_session_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_session_events_owner"
  ON channel_session_events
  FOR ALL
  USING (
    session_id IN (
      SELECT id FROM channel_sessions WHERE user_id = auth.uid()
    )
  );

-- ── channel_journey_maps ─────────────────────────────────────────────────────
-- Aggregated journey funnel snapshots, computed periodically per channel.

CREATE TABLE IF NOT EXISTS channel_journey_maps (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url             TEXT        NOT NULL,
  channel                 TEXT        NOT NULL,
  period_start            DATE        NOT NULL,
  period_end              DATE        NOT NULL,
  total_sessions          INTEGER     NOT NULL DEFAULT 0,
  conversion_rate         NUMERIC(6,5) NOT NULL DEFAULT 0,
  avg_pages_per_session   NUMERIC(8,2) NOT NULL DEFAULT 0,
  avg_events_per_session  NUMERIC(8,2) NOT NULL DEFAULT 0,
  signal_completion_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  journey_steps           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, website_url, channel, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS channel_journey_maps_user_id_idx     ON channel_journey_maps (user_id);
CREATE INDEX IF NOT EXISTS channel_journey_maps_computed_at_idx ON channel_journey_maps (computed_at);

ALTER TABLE channel_journey_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_journey_maps_owner"
  ON channel_journey_maps
  FOR ALL
  USING (user_id = auth.uid());

-- ── channel_diagnostics ──────────────────────────────────────────────────────
-- Actionable diagnostics surfaced by the diagnostic engine.

CREATE TABLE IF NOT EXISTS channel_diagnostics (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url         TEXT        NOT NULL,
  channel             TEXT        NOT NULL,
  diagnostic_type     TEXT        NOT NULL
                        CHECK (diagnostic_type IN ('signal_gap','journey_divergence','engagement_anomaly','consent_impact')),
  severity            TEXT        NOT NULL
                        CHECK (severity IN ('critical','warning','info')),
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  affected_pages      TEXT[]      NOT NULL DEFAULT '{}',
  estimated_impact    TEXT,
  recommended_action  TEXT,
  is_resolved         BOOLEAN     NOT NULL DEFAULT false,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_diagnostics_user_id_idx     ON channel_diagnostics (user_id);
CREATE INDEX IF NOT EXISTS channel_diagnostics_is_resolved_idx ON channel_diagnostics (user_id, is_resolved);
CREATE INDEX IF NOT EXISTS channel_diagnostics_created_at_idx  ON channel_diagnostics (created_at);

ALTER TABLE channel_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_diagnostics_owner"
  ON channel_diagnostics
  FOR ALL
  USING (user_id = auth.uid());
