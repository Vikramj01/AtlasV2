-- PRD-003: Multi-Client Agency Flow
-- Adds template tracking to clients and signal_packs,
-- and org_type to organisations for agency vs brand distinction.

-- clients: track which client or pack was used as a starting point
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS template_source_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_source_pack_id   UUID REFERENCES signal_packs(id) ON DELETE SET NULL;

-- signal_packs: support agency template packs saved from client configs
ALTER TABLE signal_packs
  ADD COLUMN IF NOT EXISTS source_client_id   UUID    REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_agency_template BOOLEAN NOT NULL DEFAULT FALSE;

-- organisations: agency vs brand org type
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS org_type TEXT NOT NULL DEFAULT 'agency'
    CHECK (org_type IN ('agency', 'brand'));

-- Index for fast agency template pack lookups
CREATE INDEX IF NOT EXISTS idx_signal_packs_agency_template
  ON signal_packs (organisation_id)
  WHERE is_agency_template = TRUE;
