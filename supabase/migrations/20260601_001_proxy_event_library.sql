-- Sprint Signal-Timing-1 — Proxy Event Library table
-- System-owned reference data (is_system = true).
-- All authenticated users can read rows; only service role can insert/update/delete.
-- Extensible via additional seed runs or a future admin UI.

CREATE TABLE proxy_event_library (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  lag_class        text        NOT NULL CHECK (lag_class IN ('immediate', 'short_lag', 'long_lag', 'deep_lag')),
  platform_benefit text        NOT NULL CHECK (platform_benefit IN ('meta', 'google', 'both')),
  rationale        text        NOT NULL,
  event_type       text        NOT NULL,
  verticals        text[]      NOT NULL DEFAULT '{}',
  is_system        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Index for the primary query pattern: lag_class filter + optional vertical overlap
CREATE INDEX idx_proxy_event_library_lag_class ON proxy_event_library (lag_class);
CREATE INDEX idx_proxy_event_library_verticals ON proxy_event_library USING GIN (verticals);

-- RLS: read-only for all authenticated users; writes restricted to service role
ALTER TABLE proxy_event_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proxy_event_library_read"
  ON proxy_event_library
  FOR SELECT
  TO authenticated
  USING (true);
