-- PRD-001: Set Up Tracking Hub
-- Adds: primary_conversion_objective to clients, shareable_deliverable_links,
--       client_deliverable_exports, signal_library sync columns on journey_stages.

-- ── clients: add primary_conversion_objective ──────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS primary_conversion_objective TEXT;
  END IF;
END $$;

-- ── journey_stages: Signal Library sync markers ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journey_stages') THEN
    ALTER TABLE journey_stages
      ADD COLUMN IF NOT EXISTS signal_library_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signal_library_signal_id UUID REFERENCES signals(id);
  END IF;
END $$;

-- ── shareable_deliverable_links ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shareable_deliverable_links (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  share_token       TEXT        UNIQUE NOT NULL,
  deliverable_type  TEXT        NOT NULL CHECK (deliverable_type IN ('datalayer_spec','gtm_container','combined')),
  content           JSONB       NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_by        UUID        REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  view_count        INT         DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ
);

ALTER TABLE shareable_deliverable_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage shareable links"
  ON shareable_deliverable_links
  USING (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

CREATE POLICY "public read by token"
  ON shareable_deliverable_links FOR SELECT
  USING (expires_at > NOW());

CREATE INDEX IF NOT EXISTS idx_shareable_links_token
  ON shareable_deliverable_links(share_token);

-- ── client_deliverable_exports ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_deliverable_exports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  export_type       TEXT        NOT NULL CHECK (export_type IN ('gtm_container','datalayer_spec','combined')),
  exported_by       UUID        REFERENCES profiles(id),
  storage_path      TEXT,
  shareable_url     TEXT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_deliverable_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members access deliverable exports"
  ON client_deliverable_exports
  USING (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));
